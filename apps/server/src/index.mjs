/**
 * 单端口服务：前端页面 + REST API + WebSocket(Agent/MCP) 全部走 PORT
 * ---------------------------------------------------------------------------
 * 为什么单端口：远程演示时只需要暴露一个地址（http://<服务器IP>:8787），
 * 前端静态资源、/api 接口、/ws 通道同源，没有跨域与多端口映射问题。
 *
 * WebSocket 协议与 cesium-mcp-runtime 完全一致：
 *   → { jsonrpc:'2.0', id, method, params }        （服务端下发命令）
 *   ← { id, result } | { id, error:{message} }      （浏览器回传执行结果）
 * 因此既支持前端对话面板，也支持外部 MCP 客户端（Claude Desktop / Cursor）。
 * ---------------------------------------------------------------------------
 */
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'

import { config, resolveLlm } from './config.mjs'
import { loadSceneData, resolveBuildingId } from './data.mjs'
import { createKnowledgeBase } from './knowledge.mjs'
import { createAgent, TOOLS } from './agent.mjs'
import { computeStats, buildChartOption } from '../../../shared/stats.mjs'

/* ========================================================================== */
/* 启动装配                                                                    */
/* ========================================================================== */

console.log('▶ 正在启动「阳光新城」市政工程数字化 Demo 服务 …')

let data
try {
  data = loadSceneData()
} catch (e) {
  console.error(`✗ 场景数据加载失败：${e.message}`)
  console.error('  请先执行：npm run data:build')
  process.exit(1)
}

const knowledge = await createKnowledgeBase()
const agent = createAgent({ data, knowledge })

console.log(`  · 场景数据：${data.site.name} / ${data.property.buildings.length} 栋建筑 / ${data.households ?? data.site.households} 户`)
console.log(`  · 知识库：${knowledge.size.documents} 篇文档 → ${knowledge.size.chunks} 个片段（检索模式：${knowledge.mode}）`)
const llm = resolveLlm()
console.log(`  · 大模型：${llm.provider}${llm.model ? ` / ${llm.model}` : ''}${llm.provider === 'offline' ? '（未配置 Key，使用离线规则引擎）' : ''}`)

/* ========================================================================== */
/* WebSocket：默认端口 + 独立端口 双向支持                                      */
/* ========================================================================== */

/** session -> ws（浏览器端） */
const browserClients = new Map()
/** reqId -> {resolve, reject, timer} */
const pendingRequests = new Map()
let reqCounter = 0
const WS_TIMEOUT = 20000

function getDefaultBrowser() {
  for (const ws of browserClients.values()) {
    if (ws.readyState === 1) return ws
  }
  return null
}

function sendToBrowser(sessionId, action, params, expectReply = true) {
  const ws = browserClients.get(sessionId) || getDefaultBrowser()
  if (!ws || ws.readyState !== 1) return null
  const id = `srv_${++reqCounter}`
  const payload = { jsonrpc: '2.0', id, method: action, params: params || {} }
  ws.send(JSON.stringify(payload))
  if (!expectReply) return { pushed: true, id }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id)
      reject(new Error(`浏览器响应超时（${WS_TIMEOUT}ms），请确认页面已打开且 WebSocket 已连接`))
    }, WS_TIMEOUT)
    pendingRequests.set(id, { resolve, reject, timer })
  })
}

function attachWsHandlers(wss, label) {
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const session = url.searchParams.get('session') || 'default'
    const role = url.searchParams.get('role') || 'browser'

    if (role === 'browser') {
      browserClients.set(session, ws)
      console.log(`[ws:${label}] 浏览器已连接 session=${session}`)
    }

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      // 浏览器回传执行结果
      if (msg.id && pendingRequests.has(msg.id)) {
        const p = pendingRequests.get(msg.id)
        clearTimeout(p.timer)
        pendingRequests.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message || '执行失败'))
        else p.resolve(msg.result)
        return
      }
      // 外部 MCP 客户端通过 WS 请求执行命令
      if (role !== 'browser' && msg.method) {
        sendToBrowser(session, msg.method, msg.params)
          .then((result) => ws.send(JSON.stringify({ id: msg.id, result })))
          .catch((e) => ws.send(JSON.stringify({ id: msg.id, error: { message: String(e.message || e) } })))
      }
    })

    ws.on('close', () => {
      if (browserClients.get(session) === ws) browserClients.delete(session)
      if (role === 'browser') console.log(`[ws:${label}] 浏览器断开 session=${session}`)
    })
  })
}

/* ========================================================================== */
/* HTTP 接口                                                                   */
/* ========================================================================== */

const webDist = config.paths.webDist
const app = express()
app.use(cors())
app.use(express.json({ limit: '20mb' }))

const asyncRoute = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error('[api]', e)
    res.status(500).json({ error: String(e.message || e) })
  })
}

/* ---------- 健康检查与能力探测 ---------- */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    site: data.site.name,
    wsClients: browserClients.size,
    uptimeSec: Math.round(process.uptime()),
  })
})

app.post('/api/agent/info', (req, res) => res.json(agent.info()))
app.get('/api/agent/info', (req, res) => res.json(agent.info()))

/** 命令全集（供外部 MCP 客户端 / LangChain Agent 拉取） */
app.get('/api/agent/tools', (req, res) => {
  res.json({
    total: TOOLS.total,
    bridge: TOOLS.bridge.length,
    domain: TOOLS.domain.length,
    tools: [...TOOLS.bridge, ...TOOLS.domain],
  })
})

/* ---------- 对话主入口 ---------- */
app.post(
  '/api/agent/chat',
  asyncRoute(async (req, res) => {
    const body = req.body || {}
    const result = await agent.chat({
      message: body.message,
      history: body.history,
      context: body.context,
      toolResults: body.toolResults,
      followUp: body.followUp,
    })
    res.json(result)
  }),
)

/* ---------- 知识库 ---------- */
app.post(
  '/api/knowledge/search',
  asyncRoute(async (req, res) => {
    const { query, topK } = req.body || {}
    if (!query) return res.status(400).json({ error: '缺少 query' })
    const hits = await knowledge.search(query, { topK: topK || config.rag.topK })
    res.json({
      mode: knowledge.mode,
      query,
      count: hits.length,
      hits: hits.map((h) => ({
        docId: h.docId,
        title: h.title,
        section: h.section,
        score: Number((h.score ?? 0).toFixed(4)),
        excerpt: h.text.slice(0, 260),
      })),
    })
  }),
)

app.get('/api/knowledge/docs', (req, res) => {
  res.json({ mode: knowledge.mode, ...knowledge.size, documents: knowledge.docs })
})

app.get('/api/knowledge/doc/:docId', (req, res) => {
  const doc = knowledge.getDoc(req.params.docId)
  if (!doc) return res.status(404).json({ error: '文档不存在' })
  res.json(doc)
})

/* ---------- 统计（与前端图表同源） ---------- */
app.get(
  '/api/stats/:metric',
  asyncRoute(async (req, res) => {
    const metric = req.params.metric
    const scope = req.query.scope || 'community'
    const days = Number(req.query.days || 8)
    const stats = computeStats(metric, scope, days, data.statsInput)
    res.json({ ...stats, option: req.query.option === '1' ? buildChartOption(stats, {}) : undefined })
  }),
)

app.get('/api/scene/overview', (req, res) => {
  const residential = data.property.buildings.filter((b) => b.type === 'residential')
  res.json({
    site: data.site,
    buildings: data.property.buildings.length,
    residential: residential.length,
    households: residential.reduce((s, b) => s + b.units, 0),
    pipes: data.pipes.features.length,
    pipeLength: Math.round(data.pipes.features.reduce((s, f) => s + f.properties.length, 0)),
    sensors: data.sensors.features.length,
    alarms: data.alarms.alarms.length,
  })
})

/* ---------- 场景命令：HTTP 直推浏览器（兼容 runtime /api/command） ---------- */
app.post(
  '/api/scene/command',
  asyncRoute(async (req, res) => {
    const { sessionId = 'demo', command, commands, wait = true } = req.body || {}
    const list = commands || (command ? [command] : [])
    if (!list.length) return res.status(400).json({ error: '缺少 command 或 commands' })
    if (!wait) {
      const sent = list.map((c) => sendToBrowser(sessionId, c.action, c.params, false)).filter(Boolean)
      return res.json({ ok: true, pushed: sent.length, sessions: [...browserClients.keys()] })
    }
    const results = []
    for (const c of list) {
      try {
        const result = await sendToBrowser(sessionId, c.action, c.params, true)
        results.push({ action: c.action, ok: true, result })
      } catch (e) {
        results.push({ action: c.action, ok: false, error: String(e.message || e) })
      }
    }
    res.json({ ok: results.every((r) => r.ok), sessionId, results, sessions: [...browserClients.keys()] })
  }),
)

/* ---------- MCP over HTTP（JSON-RPC 2.0 简化版） ---------- */
app.post(
  '/api/mcp',
  asyncRoute(async (req, res) => {
    const { jsonrpc = '2.0', id = null, method, params = {} } = req.body || {}
    const ok = (result) => res.json({ jsonrpc, id, result })
    const fail = (code, message) => res.json({ jsonrpc, id, error: { code, message } })

    if (method === 'initialize') {
      return ok({
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'community-digital-twin', version: '1.0.0' },
        capabilities: { tools: {}, resources: {} },
      })
    }
    if (method === 'tools/list') {
      return ok({
        tools: [...TOOLS.bridge, ...TOOLS.domain].map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.parameters || { type: 'object', properties: {} },
        })),
      })
    }
    if (method === 'tools/call') {
      const name = params.name
      const args = params.arguments || {}
      const sessionId = args.__session || 'demo'
      try {
        const result = await sendToBrowser(sessionId, name, args)
        return ok({ content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }) }] })
      } catch (e) {
        return fail(-32000, String(e.message || e))
      }
    }
    if (method === 'resources/list') {
      return ok({
        resources: [
          { uri: 'cesium://scene/camera', name: '当前相机状态', mimeType: 'application/json' },
          { uri: 'cesium://scene/layers', name: '图层清单', mimeType: 'application/json' },
          { uri: 'kb://documents', name: '物业知识库文档清单', mimeType: 'application/json' },
        ],
      })
    }
    if (method === 'resources/read') {
      const uri = params.uri
      if (uri === 'kb://documents') return ok({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(knowledge.docs) }] })
      if (uri === 'cesium://scene/layers') {
        try {
          const layers = await sendToBrowser(params.session || 'demo', 'listLayers', {})
          return ok({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(layers) }] })
        } catch (e) {
          return fail(-32000, String(e.message || e))
        }
      }
      if (uri === 'cesium://scene/camera') {
        try {
          const view = await sendToBrowser(params.session || 'demo', 'getView', {})
          return ok({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(view) }] })
        } catch (e) {
          return fail(-32000, String(e.message || e))
        }
      }
      return fail(-32602, `未知资源：${uri}`)
    }
    return fail(-32601, `未实现的方法：${method}`)
  }),
)

/** SSE：把 Agent 事件（命令下发、执行结果）推给外部订阅者 */
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  res.write(`event: hello\ndata: ${JSON.stringify({ site: data.site.name, time: new Date().toISOString() })}\n\n`)
  const ping = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 15000)
  req.on('close', () => clearInterval(ping))
})

/* ========================================================================== */
/* 前端静态资源（单端口对外）                                                   */
/* ========================================================================== */

if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }))
  app.get(/^\/(?!api|ws|data).*/, (req, res, next) => {
    const indexFile = join(webDist, 'index.html')
    if (!existsSync(indexFile)) return next()
    res.type('html').send(readFileSync(indexFile, 'utf8'))
  })
  console.log(`  · 前端静态资源：${webDist}`)
} else {
  app.get('/', (req, res) => {
    res
      .status(503)
      .type('html')
      .send(
        `<h2>前端尚未构建</h2><p>请先在项目根目录执行 <code>npm run build</code>，或开发模式下访问 Vite 的 5173 端口。</p>`,
      )
  })
}

/* ========================================================================== */
/* 启动监听                                                                    */
/* ========================================================================== */

const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
attachWsHandlers(wss, 'main')

server.listen(config.port, config.host, () => {
  const addrs = []
  const nets = networkInterfaces()
  Object.values(nets).forEach((list) =>
    (list || []).forEach((n) => {
      if (n.family === 'IPv4' && !n.internal) addrs.push(n.address)
    }),
  )
  console.log('\n✔ 服务已启动')
  console.log(`   本机访问：   http://127.0.0.1:${config.port}`)
  addrs.forEach((a) => console.log(`   局域网/远程：http://${a}:${config.port}`))
  console.log(`   WebSocket：  ws://<host>:${config.port}/ws?session=demo&role=browser`)
  console.log(`   MCP over HTTP：POST http://<host>:${config.port}/api/mcp`)
  console.log(`   Agent 能力：${JSON.stringify(agent.info().rag)}\n`)
})

// 独立端口：兼容 cesium-mcp-runtime 的 9100 约定（可选，不影响主端口）
if (config.wsPort && config.wsPort !== config.port) {
  try {
    const wsOnly = new WebSocketServer({ port: config.wsPort })
    attachWsHandlers(wsOnly, `runtime:${config.wsPort}`)
    console.log(`✔ 兼容端口已开启：ws://<host>:${config.wsPort}?session=demo（与 cesium-mcp-runtime 协议一致）`)
  } catch (e) {
    console.warn(`! 独立 WebSocket 端口 ${config.wsPort} 启动失败（可忽略）：${e.message}`)
  }
}

process.on('SIGINT', () => {
  console.log('\n正在关闭服务 …')
  wss.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500)
})
