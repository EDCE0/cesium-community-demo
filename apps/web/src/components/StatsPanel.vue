<script setup>
/**
 * 统计面板
 *   1) 侧栏：用水/用气/入住率/管网健康度/告警 五类指标速览（ECharts mini 图）
 *   2) 浮层：Agent 或用户"看图"时把图表以透明卡片形式叠加在三维场景上
 *   3) 图表点击 → 联动三维相机（emit drill）
 */
import { computed, onMounted, ref } from 'vue'
import EChartBox from './EChartBox.vue'
import { computeStats, buildChartOption, METRICS } from '../../../../shared/stats.mjs'
import { useSceneStore } from '../stores/scene.js'

const props = defineProps({
  charts: { type: Array, default: () => [] },
  service: { type: Object, default: null },
  scene: { type: Object, default: null },
})
const emit = defineEmits(['drill', 'close', 'remove'])

const store = useSceneStore()
const tab = ref('water')
const overlayPos = ref({ right: 18, top: 86 })

const TABS = [
  { id: 'water', label: '用水', ico: '💧' },
  { id: 'gas', label: '用气', ico: '🔥' },
  { id: 'power', label: '用电', ico: '⚡' },
  { id: 'occupancy', label: '入住率', ico: '🏠' },
  { id: 'pipeHealth', label: '管网健康', ico: '🧩' },
  { id: 'alarms', label: '告警', ico: '⚠' },
]

/** 侧栏速览：基于 store 中的原始数据实时计算 */
const quickStats = computed(() => {
  if (!store.timeseries) return null
  const data = {
    property: store.property,
    timeseries: store.timeseries,
    pipes: { features: store.pipes.map((p) => ({ properties: p })) },
    alarms: { alarms: store.alarms },
  }
  return data
})

function statsFor(t) {
  if (!quickStats.value) return null
  try {
    return computeStats(t, 'community', 8, quickStats.value)
  } catch {
    return null
  }
}

const active = computed(() => statsFor(tab.value))
const activeOption = computed(() => (active.value ? buildChartOption(active.value, { type: active.value.chartType }) : null))

function onQuickClick(p) {
  const store_ = active.value
  if (!store_) return
  if (store_.metric === 'occupancy' && store_.itemIds) {
    emit('drill', { metric: 'occupancy', itemName: p.name, itemId: store_.itemIds[p.dataIndex] })
  } else {
    emit('drill', { metric: store_.metric, scope: store_.scope, itemName: p.name })
  }
}

function onOverlayClick(chart, p) {
  emit('drill', { metric: chart.metric, scope: chart.scope, itemName: p.name })
}

/** 健康度仪表盘 */
const healthOption = computed(() => {
  const s = statsFor('pipeHealth')
  if (!s) return null
  return buildChartOption(s, { type: 'gauge' })
})

function dragStart(e) {
  const startX = e.clientX
  const startY = e.clientY
  const orig = { ...overlayPos.value }
  const move = (ev) => {
    overlayPos.value = {
      right: Math.max(0, orig.right - (ev.clientX - startX)),
      top: Math.max(64, orig.top + (ev.clientY - startY)),
    }
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

onMounted(() => {})
</script>

<template>
  <aside class="panel stats-panel">
    <div class="panel-head">
      <div class="panel-title"><span class="ico">📊</span>运行统计</div>
      <button class="icon-btn" @click="emit('close')">✕</button>
    </div>

    <div class="tabs">
      <button v-for="t in TABS" :key="t.id" :class="{ active: tab === t.id }" @click="tab = t.id">
        <span>{{ t.ico }}</span>{{ t.label }}
      </button>
    </div>

    <div class="body scroll-y">
      <template v-if="active">
        <div class="summary">
          <span class="s-title">{{ active.title }}</span>
          <span class="tag" :class="active.metric === 'pipeHealth' && active.summary?.high ? 'tag-warn' : 'tag-ok'">
            {{ active.summary?.unit ? `${active.summary.total ?? ''} ${active.summary.unit}` : `均 ${active.summary?.avgHealth ?? '—'}` }}
          </span>
        </div>

        <EChartBox v-if="active.metric !== 'pipeHealth'" :option="activeOption" height="182px" @chart-click="onQuickClick" />
        <div v-else class="health-wrap">
          <EChartBox :option="healthOption" height="150px" />
          <div class="health-list">
            <div v-for="l in active.pie" :key="l.name" class="health-row">
              <span class="sw" :style="{ background: l.color }"></span>
              <span class="health-name">{{ l.name }}</span>
              <span class="mono">{{ l.value }} 段</span>
            </div>
          </div>
        </div>

        <div class="hints">
          <template v-if="active.metric === 'water' || active.metric === 'gas'">
            <span>8 日累计 <b class="mono">{{ active.summary.total }}</b> {{ active.unit }}</span>
            <span>日均 <b class="mono">{{ active.summary.avg }}</b></span>
            <span>峰值 <b class="mono">{{ active.summary.peak }}</b>（{{ active.summary.peakDay }}）</span>
          </template>
          <template v-else-if="active.metric === 'occupancy'">
            <span>整体入住率 <b class="mono">{{ (active.summary.communityRate * 100).toFixed(1) }}%</b></span>
            <span>最低 <b>{{ active.summary.lowest?.name }}</b>（{{ (active.summary.lowest?.value * 100).toFixed(0) }}%）</span>
          </template>
          <template v-else-if="active.metric === 'pipeHealth'">
            <span>平均健康度 <b class="mono">{{ active.summary.avgHealth }}</b></span>
            <span>风险管段 <b class="mono">{{ active.summary.high }}</b> 段</span>
          </template>
          <template v-else-if="active.metric === 'alarms'">
            <span>严重 <b class="mono">{{ active.summary.critical }}</b></span>
            <span>告警 <b class="mono">{{ active.summary.warning }}</b></span>
            <span>提示 <b class="mono">{{ active.summary.info }}</b></span>
          </template>
        </div>
        <p class="tip muted">提示：点击图表元素可联动三维场景定位（楼栋 / 管网）。</p>
      </template>
      <div v-else class="empty">统计数据加载中…</div>
    </div>
  </aside>

  <!-- 叠加在三维场景上的图表卡片 -->
  <div
    v-for="c in charts"
    :key="c.id"
    class="panel chart-overlay"
    :style="{ right: `${overlayPos.right}px`, top: `${overlayPos.top}px` }"
  >
    <div class="overlay-head" @mousedown="dragStart">
      <span class="panel-title"><span class="ico">📈</span>{{ c.title }}</span>
      <button class="icon-btn" @click="emit('remove', c.id)">✕</button>
    </div>
    <EChartBox :option="c.option" height="176px" @chart-click="(p) => onOverlayClick(c, p)" />
    <div class="overlay-foot muted">
      <span class="tag">{{ c.type }}</span>
      <span>{{ c.scope === 'community' ? '全小区' : c.scope }}</span>
      <span v-if="c.stats?.summary?.total !== undefined">累计 {{ c.stats.summary.total }} {{ c.stats.unit }}</span>
      <span>可拖动</span>
    </div>
  </div>
</template>

<style scoped>
.stats-panel {
  position: absolute;
  top: 74px;
  right: 16px;
  width: 330px;
  max-height: calc(100vh - 170px);
  display: flex;
  flex-direction: column;
  z-index: 43;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 9px 11px 4px;
}
.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: rgba(148, 163, 184, 0.08);
  color: var(--text-3);
  font-size: 11.5px;
  cursor: pointer;
}
.tabs button.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.5);
  color: #e0f2fe;
}
.body {
  padding: 8px 11px 14px;
  max-height: calc(100vh - 300px);
}
.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.s-title {
  font-size: 12.5px;
  color: var(--text-1);
}
.health-wrap {
  display: flex;
  flex-direction: column;
}
.health-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: -6px;
}
.health-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-2);
}
.health-row .sw {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.health-name {
  flex: 1;
}
.hints {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 8px;
  padding-top: 9px;
  border-top: 1px dashed var(--border);
  font-size: 11.5px;
  color: var(--text-3);
}
.hints b {
  color: var(--text-1);
}
.tip {
  margin: 9px 0 0;
  font-size: 10.5px;
}
.empty {
  padding: 20px 0;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}

/* ---------- 场景叠加图表 ---------- */
.chart-overlay {
  position: absolute;
  width: 344px;
  z-index: 26;
  overflow: hidden;
}
.overlay-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 11px;
  border-bottom: 1px solid var(--border);
  cursor: move;
  user-select: none;
}
.overlay-foot {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 11px 9px;
  font-size: 10.5px;
}
</style>
