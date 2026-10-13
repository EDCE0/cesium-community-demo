#!/usr/bin/env node
/**
 * 后端冒烟测试（不需要浏览器）
 * ---------------------------------------------------------------------------
 * 覆盖：健康检查 / Agent 能力探测 / 知识库检索 / 统计接口 / 命令清单 /
 *       MCP over HTTP 协议 / 对话链路（真实调用模型，失败则检查是否优雅降级）
 *
 * 用法：node scripts/smoke-test.mjs [baseUrl]
 * ---------------------------------------------------------------------------
 */
const BASE = process.argv[2] || process.env.DEMO_API || 'http://127.0.0.1:8787'

let pass = 0
let fail = 0
const results = []

async function check(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    pass++
    results.push({ ok: true, name, detail, ms: Date.now() - t0 })
  } catch (e) {
    fail++
    results.push({ ok: false, name, detail: String(e.message || e), ms: Date.now() - t0 })
  }
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`)
  return r.json()
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`POST ${path} → ${r.status} ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

console.log(`\n▶ 后端冒烟测试：${BASE}\n`)

/* ---------- 基础接口 ---------- */
await check('健康检查 /api/health', async () => {
  const d = await get('/api/health')
  assert(d.ok === true, 'ok 字段不为 true')
  return `小区=${d.site} 已连接浏览器=${d.wsClients}`
})

await check('Agent 能力 /api/agent/info', async () => {
  const d = await post('/api/agent/info', {})
  assert(d.commands?.total === 43, `命令总数应为 43，实际 ${d.commands?.total}`)
  assert(d.commands.bridge === 19 && d.commands.domain === 24, '命令分组数量不对')
  return `模型=${d.provider}/${d.model} 命令=${d.commands.total} 检索=${d.rag?.mode}`
})

await check('命令清单 /api/agent/tools', async () => {
  const d = await get('/api/agent/tools')
  assert(d.tools?.length === 43, `应返回 43 个工具，实际 ${d.tools?.length}`)
  const names = d.tools.map((t) => t.name)
  assert(names.includes('flyTo') && names.includes('expandFloors') && names.includes('showUnderground'), '缺少关键命令')
  return `${d.tools.length} 个工具，含 flyTo / expandFloors / showUnderground`
})

await check('场景概览 /api/scene/overview', async () => {
  const d = await get('/api/scene/overview')
  assert(d.residential === 17, `住宅楼应为 17，实际 ${d.residential}`)
  assert(d.pipes === 13, `管线应为 13 段，实际 ${d.pipes}`)
  return `${d.buildings} 栋建筑 / ${d.households} 户 / ${d.pipes} 段管线 / ${d.sensors} 个测点`
})

/* ---------- 知识库 ---------- */
await check('知识库清单 /api/knowledge/docs', async () => {
  const d = await get('/api/knowledge/docs')
  assert(d.documents?.length === 9, `文档应为 9 篇，实际 ${d.documents?.length}`)
  return `${d.documents.length} 篇 → ${d.chunks} 片段，模式=${d.mode}`
})

await check('知识检索 /api/knowledge/search（燃气泄漏）', async () => {
  const d = await post('/api/knowledge/search', { query: '燃气泄漏怎么应急处置' })
  assert(d.hits?.length > 0, '未检索到任何片段')
  const top = d.hits[0]
  assert(/燃气/.test(top.title), `命中文档不对：${top.title}`)
  return `命中 ${d.hits.length} 段，首位=${top.title} · ${top.section}（score=${top.score}）`
})

await check('知识检索 /api/knowledge/search（报修时限）', async () => {
  const d = await post('/api/knowledge/search', { query: '报修多久能到场 收费标准' })
  const titles = d.hits.map((h) => h.title).join(' ')
  assert(/报修|收费/.test(titles), `命中主题不对：${titles}`)
  return `命中 ${d.hits.length} 段：${d.hits[0].title}`
})

await check('知识库原文 /api/knowledge/doc/KB-06', async () => {
  const d = await get('/api/knowledge/doc/KB-06')
  assert(d.text?.length > 500, '原文过短')
  return `${d.title}（${d.text.length} 字）`
})

/* ---------- 统计 ---------- */
for (const [metric, key] of [
  ['water', 'total'],
  ['gas', 'total'],
  ['occupancy', 'communityRate'],
  ['pipeHealth', 'avgHealth'],
  ['alarms', 'total'],
]) {
  await check(`统计接口 /api/stats/${metric}`, async () => {
    const d = await get(`/api/stats/${metric}`)
    assert(d.metric === metric, 'metric 回显不对')
    assert(d.summary && d.summary[key] !== undefined, `summary.${key} 缺失`)
    return `${d.title} → ${key}=${d.summary[key]}`
  })
}

/* ---------- MCP over HTTP ---------- */
await check('MCP initialize', async () => {
  const d = await post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' })
  assert(d.result?.serverInfo?.name, '缺少 serverInfo')
  return `${d.result.serverInfo.name} v${d.result.serverInfo.version}`
})

await check('MCP tools/list', async () => {
  const d = await post('/api/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert(d.result?.tools?.length === 43, `工具数应为 43，实际 ${d.result?.tools?.length}`)
  return `${d.result.tools.length} 个工具`
})

await check('MCP resources/list', async () => {
  const d = await post('/api/mcp', { jsonrpc: '2.0', id: 3, method: 'resources/list' })
  assert(d.result?.resources?.length >= 3, '资源数量不足')
  return d.result.resources.map((r) => r.uri).join(', ')
})

await check('MCP tools/call（无浏览器时应优雅报错）', async () => {
  const d = await post('/api/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'getView', arguments: {} } })
  // 页面打开时会返回 result；未打开时应返回 error（说明超时保护生效），两者都算通过
  assert(d.result || d.error, '既没有 result 也没有 error')
  return d.result ? '已转发到浏览器并取得执行结果' : `无浏览器连接 → 返回错误：${d.error.message.slice(0, 60)}`
})

/* ---------- 对话链路 ---------- */
await check('对话：操控意图 → 生成场景命令', async () => {
  const d = await post('/api/agent/chat', { message: '飞到7号楼，把它的楼层展开' })
  assert(d.route === 'action' || d.route === 'mixed', `route 应为 action/mixed，实际 ${d.route}`)
  assert(d.sceneCommands?.length > 0, '未生成任何场景命令')
  const actions = d.sceneCommands.map((c) => c.action)
  assert(actions.some((a) => /Building|expandFloors/.test(a)), `命令不对：${actions.join(',')}`)
  return `${d.provider}/${d.model} → ${actions.join(' + ')}`
})

await check('对话：知识意图 → RAG 回答 + 引用来源', async () => {
  const d = await post('/api/agent/chat', { message: '燃气泄漏怎么应急处置？' })
  assert(d.reply?.length > 30, '回答过短')
  assert(d.sources?.length > 0, '缺少引用来源')
  return `${d.provider}/${d.model} 命中 ${d.retrieved} 段，引用《${d.sources[0].title}》`
})

await check('对话：统计意图 → 查询 + 出图', async () => {
  const d = await post('/api/agent/chat', { message: '统计小区近7天用水量，用图表显示' })
  const actions = (d.sceneCommands || []).map((c) => c.action)
  assert(actions.includes('queryStats') || actions.includes('showChart'), `命令不对：${actions.join(',')}`)
  return actions.join(' + ')
})

/* ---------- 输出 ---------- */
const width = Math.max(...results.map((r) => r.name.length))
results.forEach((r) => {
  const mark = r.ok ? '✓' : '✗'
  const ms = `${r.ms}ms`.padStart(7)
  console.log(`  ${mark} ${r.name.padEnd(width)} ${ms}  ${r.detail}`)
})

console.log(`\n  通过 ${pass} / ${pass + fail}`)
if (fail) {
  console.log(`\n✗ 有 ${fail} 项未通过\n`)
  process.exit(1)
}
console.log('\n✔ 后端全部通过\n')
