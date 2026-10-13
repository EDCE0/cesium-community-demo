<script setup>
/**
 * 应用主组件：完成"数据 → 三维场景 → 命令分发 → 界面面板"的装配。
 */
import { onMounted, onBeforeUnmount, ref, computed, reactive, shallowRef } from 'vue'

import { CesiumViewerService } from './cesium/viewer.js'
import { createCommandDispatcher, BRIDGE_COMMANDS, DOMAIN_COMMAND_NAMES, TOTAL_COMMANDS } from './commands/registry.js'
import { createIotSimulator } from './lib/iot.js'
import { computeStats, buildChartOption } from '../../../shared/stats.mjs'
import { fmt } from './lib/util.js'

import { useSceneStore } from './stores/scene.js'
import { useUiStore } from './stores/ui.js'
import { useChatStore } from './stores/chat.js'

import CommunityDashboard from './components/CommunityDashboard.vue'
import SceneCanvas from './components/SceneCanvas.vue'
import SceneTooltip from './components/SceneTooltip.vue'
import LayerPanel from './components/LayerPanel.vue'
import StatsPanel from './components/StatsPanel.vue'
import ChatPanel from './components/ChatPanel.vue'
import InfoCard from './components/InfoCard.vue'
import AlarmPanel from './components/AlarmPanel.vue'
import LegendBar from './components/LegendBar.vue'
import ToastStack from './components/ToastStack.vue'
import HelpPanel from './components/HelpPanel.vue'

const scene = useSceneStore()
const ui = useUiStore()
const chat = useChatStore()

const canvasRef = ref(null)
const svc = new CesiumViewerService()
const iot = shallowRef(null)
const dispatcher = shallowRef(null)
const clock = ref(fmt.time())
const wsState = ref('connecting')
const remoteLog = reactive([])

let timer = null
let ws = null
let wsRetry = null

const bridgeUrl = computed(() => {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws?session=demo&role=browser`
})

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function fetchJSON(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} 加载失败：${res.status}`)
  return res.json()
}

onMounted(async () => {
  timer = setInterval(() => (clock.value = fmt.time()), 1000)
  try {
    const [site, buildings, roads, greens, pipes, sensors, timeseries, alarms, property] = await Promise.all([
      fetchJSON('/data/site.json'),
      fetchJSON('/data/buildings.geojson'),
      fetchJSON('/data/roads.geojson'),
      fetchJSON('/data/greens.geojson'),
      fetchJSON('/data/pipes.geojson'),
      fetchJSON('/data/sensors.geojson'),
      fetchJSON('/data/timeseries.json'),
      fetchJSON('/data/alarms.json'),
      fetchJSON('/data/property.json'),
    ])

    const data = { site, buildings, roads, greens, pipes, sensors, timeseries, alarms, property, index: { buildings: new Map() } }
    property.buildings.forEach((b) => {
      data.index.buildings.set(b.id, b)
      data.index.buildings.set(b.name.replace(/\s+/g, ''), b)
    })

    // 注意：store 内部按"要素数组"处理，这里要把 FeatureCollection.features 拆出来
    scene.setData({
      site,
      buildings: buildings.features,
      roads: roads.features,
      greens: greens.features,
      pipes: pipes.features,
      sensors: sensors.features,
      timeseries,
      alarms,
      property,
    })
    scene.setService(svc)

    // --- IoT 模拟器（2 s 一个采样周期） ---
    const sim = createIotSimulator(sensors)
    iot.value = sim
    sim.onTick(({ readings, changed }) => {
      readings.forEach((r) => svc.sensors?.updateStatus(r.id, r.status, r.value, r.unit))
      scene.iotReadings = readings
      scene.iotAbnormal = readings.filter((r) => r.status !== 'normal')
      changed
        .filter((c) => c.status === 'critical')
        .forEach((c) => ui.toast(`${c.name}：${c.value} ${c.unit} 严重告警`, 'error', 5000))
    })
    sim.start(2000)

    // --- 统计与图表构造 ---
    const stats = (metric, scope, days) => computeStats(metric, scope, days, data)
    const buildChart = (p) => {
      const s = stats(p.metric, p.scope || 'community', p.days ?? 8)
      const type = p.type || s.chartType || 'line'
      return {
        id: `chart-${p.metric}-${p.scope || 'community'}`,
        type,
        title: p.title || s.title,
        metric: p.metric,
        scope: p.scope || 'community',
        stats: s,
        option: buildChartOption(s, { type }),
      }
    }

    // --- 命令分发上下文 ---
    const ctx = {
      svc,
      data,
      iot: sim,
      stats,
      buildChart,
      ui: {
        openCard: (d) => ui.openCard(d),
        openPipeCard: (p) => ui.openPipeCard(p),
        openSensorCard: (s) => ui.openSensorCard(s),
        openTextCard: (t, c) => ui.openTextCard(t, c),
        pushChart: (c) => ui.pushChart(c),
        showTooltip: (p) => ui.showTooltip(p),
        setPanel: (p, o) => ui.setPanel(p, o),
        setLayer: (id, v) => scene.setLayer(id, v),
        setUnderground: (v) => (scene.underground = v),
        setPipeFilter: (t) => (scene.pipeFilter = t),
        setDepthScale: (s) => (scene.depthScale = s),
        setActiveFloor: (f) => ui.setActiveFloor(f),
        resetLayers: () => Object.keys(scene.layers).forEach((k) => scene.setLayer(k, k !== 'pipes')),
      },
    }
    dispatcher.value = createCommandDispatcher(ctx)

    // --- 初始化三维场景 ---
    svc.setData(data)
    await svc.init(canvasRef.value.getContainer(), site, data)
    wireSceneEvents()
    scene.ready = true
    scene.loading = false
    ui.toast(
      `场景已就绪：${site.residentialBuildings} 栋住宅楼 · ${site.households} 户 · ${TOTAL_COMMANDS} 个 Agent 命令`,
      'success',
      5200,
    )

    await chat.probe()
    connectBridge()
  } catch (e) {
    console.error(e)
    scene.error = String(e.message || e)
    scene.loading = false
  }
})

onBeforeUnmount(() => {
  clearInterval(timer)
  clearTimeout(wsRetry)
  try {
    ws?.close()
  } catch {}
  iot.value?.stop()
})

/* ------------------------------------------------------------------ */
/* 场景事件 → 状态                                                     */
/* ------------------------------------------------------------------ */

function wireSceneEvents() {
  svc.on('buildingSelected', (detail) => scene.selectBuilding(detail))
  svc.on('floorsExpanded', ({ id }) => (scene.expandedBuildingId = id))
  svc.on('floorsCollapsed', () => (scene.expandedBuildingId = null))
  svc.on('floorSelected', ({ floor }) => {
    scene.activeFloor = floor
    ui.setActiveFloor(floor)
  })
  svc.on('pipeSelected', (pipe) => {
    scene.selectedPipe = pipe
    ui.openPipeCard(pipe)
  })
  svc.on('sensorSelected', (sensor) => {
    scene.selectedSensor = sensor
    const row = iot.value?.snapshot({ sensorId: sensor.id })[0]
    ui.openSensorCard(row || sensor)
  })
  svc.on('clearSelection', () => {
    scene.selectedBuilding = null
    scene.selectedBuildingId = null
  })
  svc.on('layerVisibility', ({ id, visible }) => scene.setLayer(id, visible))
  svc.on('underground', ({ enabled }) => (scene.underground = enabled))
}

/* ------------------------------------------------------------------ */
/* 命令执行桥                                                          */
/* ------------------------------------------------------------------ */

async function dispatch(cmd) {
  if (!dispatcher.value) throw new Error('场景尚未就绪')
  return dispatcher.value.dispatch(cmd)
}

/* ------------------------------------------------------------------ */
/* WebSocket：外部 Agent / MCP runtime 也能驱动本页面                   */
/* ------------------------------------------------------------------ */

function connectBridge() {
  try {
    ws = new WebSocket(bridgeUrl.value)
  } catch {
    wsState.value = 'error'
    return
  }
  ws.onopen = () => {
    wsState.value = 'connected'
    ws.send(JSON.stringify({ type: 'hello', role: 'browser', session: 'demo', site: scene.site?.name }))
  }
  ws.onclose = () => {
    wsState.value = 'reconnecting'
    wsRetry = setTimeout(connectBridge, 3000)
  }
  ws.onerror = () => (wsState.value = 'error')
  ws.onmessage = async (event) => {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }
    if (msg.method) {
      const entry = { at: fmt.time(), action: msg.method, ok: true }
      try {
        const result = await dispatch({ action: msg.method, params: msg.params || {} })
        ws.send(JSON.stringify({ id: msg.id, result }))
      } catch (e) {
        ws.send(JSON.stringify({ id: msg.id, error: { message: String(e.message || e) } }))
        entry.ok = false
        entry.error = String(e.message || e)
      }
      remoteLog.unshift(entry)
      if (remoteLog.length > 8) remoteLog.pop()
      return
    }
    if (msg.type === 'command' && msg.command) {
      try {
        await dispatch(msg.command)
        remoteLog.unshift({ at: fmt.time(), action: msg.command.action, ok: true, error: 'HTTP 推送' })
      } catch (e) {
        remoteLog.unshift({ at: fmt.time(), action: msg.command.action, ok: false, error: String(e.message || e) })
        ui.toast(`远程命令失败：${e.message}`, 'error')
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Agent 场景快照                                                      */
/* ------------------------------------------------------------------ */

function chatCtx() {
  return {
    snapshot: () => {
      const v = svc.viewer ? svc.getView() : null
      return {
        site: scene.site?.name,
        view: v
          ? {
              longitude: Number(v.longitude.toFixed(6)),
              latitude: Number(v.latitude.toFixed(6)),
              height: Math.round(v.height),
              pitchDeg: Math.round((v.pitch * 180) / Math.PI),
            }
          : null,
        layers: { ...scene.layers },
        underground: scene.underground,
        selectedBuilding: scene.selectedBuilding
          ? { id: scene.selectedBuilding.id, name: scene.selectedBuilding.name, floors: scene.selectedBuilding.floors }
          : null,
        expandedBuilding: scene.expandedBuildingId,
        activeFloor: scene.activeFloor,
        pipeFilter: scene.pipeFilter,
        depthScale: scene.depthScale,
        abnormalSensors: (scene.iotAbnormal || [])
          .slice(0, 6)
          .map((r) => ({ id: r.id, name: r.name, value: r.value, unit: r.unit, status: r.status })),
        chartCount: ui.charts.length,
        buildingsSummary: {
          total: scene.buildings.length,
          residential: scene.statistics.residential,
          units: scene.statistics.units,
          occupancyRate: Number(scene.statistics.occupancyRate.toFixed(3)),
        },
      }
    },
    dispatch,
  }
}

const onSend = (text) => chat.send(text, chatCtx())

/* ------------------------------------------------------------------ */
/* 界面动作                                                            */
/* ------------------------------------------------------------------ */

const statsCards = computed(() => {
  const s = scene.statistics
  return [
    { label: '住宅楼栋', value: s.residential, unit: '栋', hint: `含公建共 ${s.buildings} 栋` },
    { label: '总户数', value: s.units, unit: '户', hint: `已入住 ${s.occupied} 户` },
    { label: '整体入住率', value: (s.occupancyRate * 100).toFixed(1), unit: '%', hint: '按户统计' },
    { label: '地下管线', value: fmt.dist(s.pipeLength), unit: '', hint: `${scene.pipes.length} 段给水/燃气/污水` },
    { label: 'IoT 测点', value: s.sensors, unit: '个', hint: `异常 ${(scene.iotAbnormal || []).length} 个` },
  ]
})

async function quickAction(name) {
  try {
    if (name === 'overview') await dispatch({ action: 'overviewSite', params: {} })
    else if (name === 'underground') {
      const next = !scene.underground
      await dispatch({ action: 'showUnderground', params: { enabled: next } })
      await dispatch({ action: 'setPipeDepthScale', params: { scale: next ? 3 : 1 } })
    } else if (name === 'gas') {
      await dispatch({ action: 'toggleLayer', params: { layer: 'pipes', visible: true } })
      await dispatch({ action: 'setPipeFilter', params: { types: ['gas'] } })
      await dispatch({ action: 'setPipeDepthScale', params: { scale: 3 } })
    } else if (name === 'stats') {
      await dispatch({ action: 'showChart', params: { metric: 'water', type: 'line' } })
    } else if (name === 'faults') {
      await dispatch({ action: 'setSimulate', params: { action: 'injectFault', fault: 'gasLeak' } })
      ui.setPanel('alarms', true)
    } else if (name === 'reset') {
      await dispatch({ action: 'resetView', params: {} })
    }
  } catch (e) {
    ui.toast(`操作失败：${e.message}`, 'error')
  }
}

async function onLayerToggle(id, visible) {
  scene.setLayer(id, visible)
  try {
    await dispatch({ action: 'toggleLayer', params: { layer: id, visible } })
  } catch (e) {
    ui.toast(`图层切换失败：${e.message}`, 'error')
  }
}

async function onSelectBuilding(id) {
  try {
    await dispatch({ action: 'selectBuilding', params: { buildingId: id } })
  } catch (e) {
    ui.toast(e.message, 'error')
  }
}

async function onExpandFloors(id) {
  try {
    await dispatch({ action: 'expandFloors', params: { buildingId: id } })
  } catch (e) {
    ui.toast(e.message, 'error')
  }
}

async function onCollapseFloors() {
  try {
    await dispatch({ action: 'collapseFloors', params: {} })
  } catch (e) {
    ui.toast(e.message, 'error')
  }
}

async function onHighlightFloor(floor) {
  try {
    await dispatch({ action: 'highlightFloor', params: { floor } })
  } catch (e) {
    ui.toast(e.message, 'error')
  }
}

async function onChartDrill({ metric, scope, itemName, itemId }) {
  try {
    if (metric === 'occupancy' && itemId) {
      await dispatch({ action: 'selectBuilding', params: { buildingId: itemId } })
    } else if (metric === 'pipeHealth') {
      const type = { 给水: 'water', 燃气: 'gas', 污水: 'sewage' }[itemName]
      if (type) {
        await dispatch({ action: 'toggleLayer', params: { layer: 'pipes', visible: true } })
        await dispatch({ action: 'setPipeFilter', params: { types: [type] } })
        await dispatch({ action: 'showUnderground', params: { enabled: true } })
      }
    } else if (metric === 'alarms') {
      ui.setPanel('alarms', true)
    } else if (scope && scope !== 'community') {
      await dispatch({ action: 'selectBuilding', params: { buildingId: scope } })
    }
  } catch (e) {
    ui.toast(e.message, 'error')
  }
}

async function onFocusPipe(id) {
  const feature = (svc.pipes?.features || []).find((f) => f.properties.id === id)
  if (!feature) return
  const coords = feature.geometry.coordinates
  const mid = coords[Math.floor(coords.length / 2)]
  await dispatch({ action: 'showUnderground', params: { enabled: true } })
  await svc.flyTo({ longitude: mid[0], latitude: mid[1], height: 80 }, 1.4)
  await dispatch({ action: 'showInfoCard', params: { kind: 'pipe', id } })
}

const statusDot = computed(() => (scene.error ? 'error' : scene.ready ? 'ok' : 'loading'))
</script>

<template>
  <div class="app">
    <!-- ============ 顶栏 ============ -->
    <header class="topbar">
      <div class="brand">
        <span class="logo">◈</span>
        <div class="brand-text">
          <strong>阳光新城 · 智慧社区数字孪生平台</strong>
          <span>SUNSHINE COMMUNITY · DIGITAL TWIN OPERATIONS CENTER</span>
        </div>
      </div>

      <div class="kpis">
        <div v-for="k in statsCards" :key="k.label" class="kpi">
          <span class="kpi-label">{{ k.label }}</span>
          <span class="kpi-value">{{ k.value }}<em>{{ k.unit }}</em></span>
          <span class="kpi-hint">{{ k.hint }}</span>
        </div>
      </div>

      <div class="topbar-right">
        <span class="pill" :class="`pill-${statusDot}`">
          <i class="dot"></i>
          {{ scene.error ? '初始化失败' : scene.ready ? '场景在线' : '加载中' }}
        </span>
        <span class="pill" :class="`pill-${wsState === 'connected' ? 'ok' : 'warn'}`" :title="bridgeUrl">
          <i class="dot"></i>
          MCP {{ wsState === 'connected' ? '已连接 9100' : wsState === 'connecting' ? '连接中' : '重连中' }}
        </span>
        <span class="pill pill-muted" :title="`模型：${chat.capability.provider} ${chat.capability.model || ''}`">
          <i class="dot"></i>
          {{ chat.capability.provider === 'offline' ? 'Agent 离线规则引擎' : `Agent ${chat.capability.model}` }}
        </span>
        <span class="clock">{{ clock }}</span>
      </div>
    </header>

    <!-- ============ 主体 ============ -->
    <main class="body">
      <CommunityDashboard :scene="scene" @quick="quickAction" @locate="onSelectBuilding" @panel="(p) => ui.setPanel(p)" />
      <LayerPanel
        v-if="ui.panels.layers"
        :layers="scene.layers"
        :buildings="scene.buildings"
        :pipes="scene.pipes"
        :underground="scene.underground"
        :depth-scale="scene.depthScale"
        @toggle="onLayerToggle"
        @select-building="onSelectBuilding"
        @quick="quickAction"
        @pipe-filter="(types) => dispatch({ action: 'setPipeFilter', params: { types } })"
        @depth-scale="(s) => dispatch({ action: 'setPipeDepthScale', params: { scale: s } })"
        @focus-pipe="onFocusPipe"
      />

      <section class="viewport">
        <SceneCanvas ref="canvasRef" />
        <LegendBar v-if="ui.panels.legend" :underground="scene.underground" :layers="scene.layers" />

        <div class="tooltip-layer">
          <SceneTooltip v-for="t in ui.tooltips" :key="t.id" :tip="t" :service="svc" @close="ui.removeTooltip(t.id)" />
        </div>

        <div v-if="scene.loading" class="overlay-center">
          <div class="spinner"></div>
          <p>正在装配三维小区数字底板…</p>
        </div>
        <div v-if="scene.error" class="overlay-center error">
          <p>场景初始化失败</p>
          <code>{{ scene.error }}</code>
        </div>

        <div class="quickbar">
          <button @click="quickAction('overview')">🔭 全景</button>
          <button :class="{ active: scene.underground }" @click="quickAction('underground')">
            {{ scene.underground ? '⬆ 返回地表' : '⬇ 地下管线' }}
          </button>
          <button @click="quickAction('gas')">🔥 燃气高亮</button>
          <button @click="quickAction('stats')">📈 用水统计</button>
          <button @click="quickAction('faults')">🧪 注入燃气泄漏</button>
          <button @click="quickAction('reset')">↺ 复位</button>
        </div>
      </section>

      <StatsPanel
        v-if="ui.panels.stats && ui.charts.length"
        :charts="ui.charts"
        :service="svc"
        :scene="scene"
        @drill="onChartDrill"
        @close="ui.setPanel('stats', false)"
        @remove="ui.removeChart"
      />
    </main>

    <!-- ============ 浮动面板 ============ -->
    <InfoCard
      v-if="ui.card.open"
      :card="ui.card"
      :active-floor="ui.activeFloor"
      :expanded="!!scene.expandedBuildingId && scene.expandedBuildingId === scene.selectedBuildingId"
      @close="ui.closeCard()"
      @expand="onExpandFloors"
      @collapse="onCollapseFloors"
      @floor="onHighlightFloor"
    />

    <ChatPanel
      :open="ui.panels.chat"
      :store="chat"
      :service="svc"
      :commands="{ bridge: BRIDGE_COMMANDS, domain: DOMAIN_COMMAND_NAMES, total: TOTAL_COMMANDS }"
      @send="onSend"
      @toggle="ui.setPanel('chat')"
    />

    <AlarmPanel
      v-if="ui.panels.alarms"
      :alarms="scene.alarms"
      :abnormal="scene.iotAbnormal || []"
      @close="ui.setPanel('alarms', false)"
      @inject="(fault) => dispatch({ action: 'setSimulate', params: { action: 'injectFault', fault } })"
      @locate="(a) => dispatch({ action: 'selectBuilding', params: { buildingId: a.target } })"
    />

    <HelpPanel v-if="ui.panels.help" @close="ui.setPanel('help', false)" />

    <ToastStack :items="ui.toasts" />

    <div class="fab-col">
      <button class="fab" title="图层面板" @click="ui.setPanel('layers')">🗂</button>
      <button class="fab" title="告警中心" @click="ui.setPanel('alarms')">
        ⚠<span v-if="(scene.iotAbnormal || []).length" class="badge">{{ (scene.iotAbnormal || []).length }}</span>
      </button>
      <button class="fab" title="帮助 / 命令清单" @click="ui.setPanel('help')">❔</button>
    </div>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.body {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;
}
.viewport {
  position: relative;
  flex: 1;
  min-width: 0;
}
.overlay-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: rgba(11, 18, 32, 0.72);
  color: var(--text-1);
  font-size: 14px;
  z-index: 30;
}
.overlay-center.error code {
  max-width: 70%;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  font-size: 12px;
  white-space: pre-wrap;
}
.spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid rgba(56, 189, 248, 0.25);
  border-top-color: #38bdf8;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.quickbar {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  padding: 8px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid var(--border);
  backdrop-filter: blur(10px);
  z-index: 20;
}
.quickbar button {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: rgba(148, 163, 184, 0.12);
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
  transition: 0.18s;
  white-space: nowrap;
}
.quickbar button:hover {
  background: rgba(56, 189, 248, 0.18);
  color: #e2e8f0;
}
.quickbar button.active {
  background: rgba(56, 189, 248, 0.28);
  border-color: rgba(56, 189, 248, 0.6);
  color: #e0f2fe;
}
.tooltip-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 15;
}
.fab-col {
  position: absolute;
  right: 18px;
  bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 40;
}
.fab {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(15, 23, 42, 0.82);
  color: var(--text-2);
  font-size: 16px;
  cursor: pointer;
  backdrop-filter: blur(10px);
}
.fab:hover {
  color: #e2e8f0;
  border-color: rgba(56, 189, 248, 0.5);
}
.badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
</style>
