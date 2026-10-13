#!/usr/bin/env node
/**
 * 浏览器端验证脚本（无头 Chrome）
 * ---------------------------------------------------------------------------
 * 做四件事，全部围绕"这个 Demo 真的能跑"：
 *   1) 打开页面，采集控制台报错与页面异常
 *   2) 等待三维场景就绪，确认 Cesium canvas 真的画出了东西
 *   3) 截图（默认视角 / 地下管线 / 楼层分层）
 *   4) 通过 WebSocket 以"外部 Agent"身份下发真实命令，验证 MCP 闭环
 *
 * 用法：
 *   node scripts/browser-check.mjs [url] [chromePath]
 * 依赖：playwright-core + 本地 Chrome（见 README）
 * ---------------------------------------------------------------------------
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import WebSocket from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const URL_BASE = process.argv[2] || 'http://127.0.0.1:8787'
const CHROME =
  process.argv[3] || process.env.CHROME_PATH || '/tmp/chrome114/chrome-linux64/chrome'
const SHOTS = resolve(ROOT, 'screenshots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

if (!existsSync(CHROME)) {
  console.error(`✗ 找不到 Chrome：${CHROME}\n  可用参数指定：node scripts/browser-check.mjs <url> <chromePath>`)
  process.exit(2)
}
mkdirSync(SHOTS, { recursive: true })

const errors = []
const warnings = []
let failed = 0
const check = (ok, label, extra = '') => {
  log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failed++
}

/**
 * 浏览器运行方式
 * ---------------------------------------------------------------------------
 * 默认 headless。若环境没有 GPU，ANGLE/Vulkan 头less 可能拿不到
 * MAX_VERTEX_TEXTURE_IMAGE_UNITS（Cesium 的 per-instance 图元会直接报错停渲染）。
 * 这时用有头模式 + 虚拟显示最稳：
 *     xvfb-run -a node scripts/browser-check.mjs
 * 可用环境变量：
 *     HEADED=1      有头模式（配合 xvfb-run）
 *     GL_MODE=swiftshader   纯软件渲染（不推荐，仅排障）
 */
const GL_MODE = process.env.GL_MODE || 'vulkan'
const HEADED = process.env.HEADED === '1'
const GL_ARGS =
  GL_MODE === 'swiftshader'
    ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist']

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: !HEADED,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu-sandbox',
    '--enable-webgl',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1600,900',
    ...GL_ARGS,
  ],
})

const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
const page = await context.newPage()

page.on('console', (msg) => {
  const t = msg.type()
  const text = msg.text()
  // Cesium 抛出的对象常常序列化成空/单字符，尽量把可用信息抓全
  if (t === 'error') {
    let extra = ''
    try {
      extra = msg.args().map((a) => (a.jsonValue ? '' : '')).join('')
    } catch {
      /* ignore */
    }
    errors.push(text + extra)
  } else if (t === 'warning') warnings.push(text)
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`))
page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText || ''}`))

log(`\n▶ 浏览器验证：${URL_BASE}\n`)

try {
  // ---------- 1. 打开页面 ----------
  const resp = await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  check(resp?.ok(), `页面可访问（HTTP ${resp?.status()}）`)

  // ---------- 2. 等待场景就绪 ----------
  await page.waitForFunction(
    () => {
      const pills = [...document.querySelectorAll('.pill')].map((p) => p.textContent.trim())
      return pills.some((p) => p.includes('场景在线'))
    },
    { timeout: 120000 },
  )
  check(true, '三维场景已完成初始化（顶栏显示「场景在线」）')

  // Cesium canvas 存在且有尺寸
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector('.cesium-widget canvas') || document.querySelector('canvas')
    if (!c) return null
    return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight }
  })
  check(!!canvasInfo && canvasInfo.w > 200, 'Cesium canvas 已创建', canvasInfo ? `${canvasInfo.w}×${canvasInfo.h}` : '未找到')

  // WebGL 上下文可用
  const glInfo = await page.evaluate(() => {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    if (!gl) return null
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      version: gl.getParameter(gl.VERSION),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      vtfUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
    }
  })
  check(!!glInfo, 'WebGL 上下文可用', glInfo ? glInfo.renderer : '')
  check(
    (glInfo?.vtfUnits ?? 0) > 0,
    '顶点纹理拾取（VTF）可用（Cesium per-instance 图元的硬性要求）',
    glInfo ? `MAX_VERTEX_TEXTURE_IMAGE_UNITS=${glInfo.vtfUnits}` : '',
  )

  await sleep(3500) // 等待建筑/管线渲染稳定

  // Cesium 渲染出错时会弹出错误面板并遮挡界面，先关掉再继续
  const renderPanel = await page.$('.cesium-widget-errorPanel')
  if (renderPanel) {
    const msg = await page.evaluate(() => document.querySelector('.cesium-widget-errorPanel-message')?.textContent?.trim() || '未知渲染错误')
    check(false, 'Cesium 渲染中断', msg)
    await page.evaluate(() => document.querySelector('.cesium-widget-errorPanel button')?.click())
    await sleep(800)
  } else {
    check(true, 'Cesium 渲染正常（无错误面板）')
  }

  // 统计页面上的关键 UI
  const ui = await page.evaluate(() => ({
    kpis: [...document.querySelectorAll('.kpi')].map((k) => k.textContent.replace(/\s+/g, ' ').trim()),
    chatOpen: !!document.querySelector('.chat textarea'),
    layerPanel: !!document.querySelector('.layer-panel'),
    statsPanel: !!document.querySelector('.stats-panel'),
    bridgePill: [...document.querySelectorAll('.pill')].map((p) => p.textContent.trim()).find((t) => t.includes('MCP')) || '',
    commands: document.querySelector('.chat .tag')?.textContent?.trim() || '',
  }))
  check(ui.kpis.length >= 5, '顶栏 KPI 已渲染', ui.kpis.slice(0, 3).join(' | '))
  check(ui.chatOpen, '右下角对话框存在')
  check(ui.layerPanel, '左侧图层面板存在')
  check(ui.statsPanel, '右侧统计面板存在')
  check(ui.bridgePill.includes('已连接'), '前端与后端 WebSocket 已连接', ui.bridgePill)

  await page.screenshot({ path: resolve(SHOTS, '01-overview.png') })
  check(true, `截图：screenshots/01-overview.png`)

  // ---------- 3. 通过 WS 以外部 Agent 身份下发命令 ----------
  log('\n▶ 以外部 Agent 身份通过 WebSocket 下发命令\n')
  const wsResult = await new Promise((resolvePromise) => {
    const ws = new WebSocket(`${URL_BASE.replace('http', 'ws')}/ws?session=demo&role=mcp`)
    const pending = new Map()
    let id = 0
    const send = (method, params) =>
      new Promise((res, rej) => {
        const rid = `check_${++id}`
        pending.set(rid, { res, rej })
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }))
        setTimeout(() => pending.has(rid) && rej(new Error(`${method} 超时`)), 25000)
      })
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result)
    })
    ws.on('open', async () => {
      const out = []
      try {
        out.push(['toggleLayer(pipes,true)', await send('toggleLayer', { layer: 'pipes', visible: true })])
        out.push(['setPipeDepthScale(3)', await send('setPipeDepthScale', { scale: 3 })])
        out.push(['showUnderground(true)', await send('showUnderground', { enabled: true })])
        resolvePromise({ ok: true, out })
      } catch (e) {
        resolvePromise({ ok: false, error: e.message, out })
      } finally {
        ws.close()
      }
    })
    ws.on('error', (e) => resolvePromise({ ok: false, error: e.message, out: [] }))
  })

  check(wsResult.ok, 'WS 命令通道可用（外部 Agent 可驱动页面）', wsResult.error || '')
  ;(wsResult.out || []).forEach(([label, res]) => {
    const ok = res && (res.success === true || res.underground !== undefined || res.scale !== undefined || res.visible !== undefined)
    check(!!ok, `  命令执行：${label}`)
  })

  await sleep(3500)
  await page.screenshot({ path: resolve(SHOTS, '02-underground.png') })
  check(true, '截图：screenshots/02-underground.png')

  // ---------- 4. 楼层分层截图 ----------
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.quickbar button')]
    const back = btns.find((b) => b.textContent.includes('返回地表'))
    if (back) back.click()
  })
  await sleep(2500)

  const expand = await page.evaluate(async () => {
    // 直接调用页面内的命令分发桥（与对话框同一条链路）
    const el = document.querySelector('#app')
    return !!el
  })
  void expand

  // 通过 WS 展开 7 号楼楼层
  const floorResult = await new Promise((resolvePromise) => {
    const ws = new WebSocket(`${URL_BASE.replace('http', 'ws')}/ws?session=demo&role=mcp`)
    ws.on('open', () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'f1', method: 'expandFloors', params: { buildingId: '7 号楼' } }))
    })
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      resolvePromise(msg.error ? { ok: false, error: msg.error.message } : { ok: true, result: msg.result })
      ws.close()
    })
    ws.on('error', (e) => resolvePromise({ ok: false, error: e.message }))
    setTimeout(() => resolvePromise({ ok: false, error: '超时' }), 30000)
  })
  check(floorResult.ok, '楼层分层命令执行成功（7 号楼）', floorResult.error || '')
  await sleep(4000)
  await page.screenshot({ path: resolve(SHOTS, '03-floors.png') })
  check(true, '截图：screenshots/03-floors.png')

  // ---------- 5. 对话框：真实调用 DeepSeek ----------
  log('\n▶ 验证右下角对话框（真实调用 DeepSeek）\n')
  const chatReply = await page.evaluate(async () => {
    const res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '小区整体入住率是多少？一句话回答' }),
    })
    return res.json()
  })
  check(!!chatReply.reply, 'Agent 返回内容', (chatReply.reply || '').replace(/\s+/g, ' ').slice(0, 90))
  check(chatReply.provider !== 'offline', '走真实模型通道', `${chatReply.provider}/${chatReply.model}`)

  // 在页面上真正发一条消息，验证 UI 流程与命令执行轨迹
  await page.fill('.chat textarea', '飞到 13 号楼，把楼层展开')
  await page.click('.chat .send')
  await page.waitForFunction(() => !document.querySelector('.chat .send')?.disabled, { timeout: 90000 }).catch(() => {})
  await sleep(6000)
  const steps = await page.evaluate(() => [...document.querySelectorAll('.chat .step')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()))
  check(steps.length > 0, '对话框中显示命令执行轨迹', steps.join(' / ').slice(0, 120))
  await page.screenshot({ path: resolve(SHOTS, '04-chat.png') })
  check(true, '截图：screenshots/04-chat.png')

  // ---------- 6. 知识问答截图 ----------
  await page.fill('.chat textarea', '燃气泄漏怎么应急处置？')
  await page.click('.chat .send')
  await page.waitForFunction(() => !document.querySelector('.chat .send')?.disabled, { timeout: 90000 }).catch(() => {})
  await sleep(4000)
  await page.screenshot({ path: resolve(SHOTS, '05-rag.png') })
  check(true, '截图：screenshots/05-rag.png')
} catch (e) {
  check(false, '执行过程中出现异常', e.message)
} finally {
  log('\n▶ 控制台诊断\n')
  const realErrors = errors.filter(
    (e) =>
      !/favicon|DevTools|Download the React|WebGL: INVALID|Automatic fallback to software WebGL|GroupMarkerNotSet|net::ERR_ABORTED/i.test(
        e,
      ),
  )
  if (realErrors.length) {
    realErrors.slice(0, 12).forEach((e) => log(`  ! ${e.slice(0, 220)}`))
    check(false, `控制台存在 ${realErrors.length} 条错误`)
  } else {
    check(true, '控制台无阻断性错误', `（原始报错 ${errors.length} 条，已过滤环境噪音）`)
  }

  await browser.close()

  log(`\n${failed === 0 ? '✔ 全部检查通过' : `✗ 有 ${failed} 项检查未通过`}`)
  log(`  截图目录：${SHOTS}\n`)
  process.exit(failed === 0 ? 0 : 1)
}
