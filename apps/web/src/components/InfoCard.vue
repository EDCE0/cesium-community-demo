<script setup>
/**
 * 信息卡片：楼栋 / 管段 / 测点 / 文本
 * 楼栋卡片内含"楼层分层"入口与楼层-户详情，是"楼层单体化交互"的主界面。
 */
import { computed, ref, watch } from 'vue'
import { fmt, hexToRgba } from '../lib/util.js'

const props = defineProps({
  card: { type: Object, required: true },
  activeFloor: { type: Number, default: null },
  expanded: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'expand', 'collapse', 'floor'])

const tab = ref('floors')
const b = computed(() => props.card.data || {})

watch(
  () => props.card.data,
  () => {
    tab.value = 'floors'
  },
)

const ledger = computed(() => b.value.ledger || null)
const floors = computed(() => ledger.value?.floorList || [])
const unitsOfActive = computed(() => {
  const f = floors.value.find((x) => x.floor === props.activeFloor)
  return f ? f.units : []
})

const typeLabel = {
  residential: '住宅',
  community: '社区服务',
  school: '教育配套',
  commercial: '商业配套',
  utility: '市政设施',
  parking: '车库',
}
const ownerTag = { 自住: 'tag-ok', 出租: 'tag-warn', 空置: 'tag-danger', 商户: 'tag' }

/** 用水趋势迷你柱 */
const trend = computed(() => b.value.trend?.water || [])
const trendMax = computed(() => Math.max(...trend.value, 1))
</script>

<template>
  <section class="panel card" :class="card.kind">
    <div class="card-head">
      <div class="title">
        <span v-if="card.kind === 'building'" class="id mono">{{ b.id }}</span>
        <span v-else class="id ico">{{ card.kind === 'pipe' ? '🧩' : card.kind === 'sensor' ? '📡' : 'ℹ' }}</span>
        <div class="title-main">
          <strong>{{ card.title }}</strong>
          <span class="muted">
            <template v-if="card.kind === 'building'">
              {{ typeLabel[b.type] || b.type }} · {{ b.group }} · 建成年份 {{ b.builtYear }} · {{ b.structure }}
            </template>
            <template v-else-if="card.kind === 'pipe'">{{ b.pipeLabel }}管网 · {{ b.material }}</template>
            <template v-else-if="card.kind === 'sensor'">{{ b.typeLabel }} · {{ b.id }}</template>
          </span>
        </div>
      </div>
      <button class="icon-btn" @click="emit('close')">✕</button>
    </div>

    <!-- ================= 楼栋 ================= -->
    <template v-if="card.kind === 'building'">
      <div class="metric-grid">
        <div class="metric"><span>总层数</span><b class="mono">{{ b.floors }}</b></div>
        <div class="metric"><span>总户数</span><b class="mono">{{ b.units }}</b></div>
        <div class="metric"><span>入住率</span><b class="mono">{{ ((b.occupancyRate || 0) * 100).toFixed(1) }}%</b></div>
        <div class="metric"><span>建筑面积</span><b class="mono">{{ fmt.num(b.buildingArea / 10000, 2) }} 万㎡</b></div>
      </div>

      <div class="trend-row">
        <span class="muted">近 8 日用水</span>
        <div class="bars">
          <i v-for="(v, i) in trend" :key="i" :style="{ height: `${Math.max(8, (v / trendMax) * 100)}%` }" :title="`${v} m³`"></i>
        </div>
        <span class="mono muted">{{ trend.length ? trend[trend.length - 1] : '—' }} m³</span>
      </div>

      <div class="tabs">
        <button :class="{ active: tab === 'floors' }" @click="tab = 'floors'">楼层与户</button>
        <button :class="{ active: tab === 'info' }" @click="tab = 'info'">设备与配套</button>
      </div>

      <div v-if="tab === 'floors'" class="card-body">
        <div class="floor-actions">
          <button v-if="!expanded" class="primary" @click="emit('expand', b.id)">🧩 楼层分层展开</button>
          <button v-else class="primary ghost" @click="emit('collapse', b.id)">⇱ 收起分层</button>
          <span class="muted">点击楼层高亮该层</span>
        </div>

        <div class="floor-strip scroll-y">
          <button
            v-for="f in floors"
            :key="f.floor"
            class="floor-chip"
            :class="{ active: activeFloor === f.floor }"
            @click="emit('floor', f.floor)"
          >
            <b>{{ f.floor }}F</b>
            <span>{{ f.units.length }} 户</span>
          </button>
        </div>

        <div v-if="activeFloor" class="unit-block">
          <div class="unit-head">
            <span>{{ activeFloor }} 层 · {{ unitsOfActive.length }} 户</span>
            <span class="muted">面积 / 户型 / 业主类型</span>
          </div>
          <div class="unit-list scroll-y">
            <div v-for="u in unitsOfActive" :key="u.unitId" class="unit-row">
              <span class="unit-no mono">{{ u.room }}</span>
              <span class="unit-area mono">{{ u.area }} ㎡</span>
              <span class="unit-layout">{{ u.layout }}</span>
              <span class="tag" :class="ownerTag[u.ownerType] || 'tag'">{{ u.ownerType }}</span>
              <span class="unit-owner muted">{{ u.ownerName }}</span>
            </div>
          </div>
        </div>
        <div v-else class="hint muted">选择上方任一楼层，查看该层户型与业主信息。</div>
      </div>

      <div v-else class="card-body info-grid">
        <div><span class="muted">电梯配置</span><b>{{ b.hasElevator ? '有（2 台）' : '无' }}</b></div>
        <div><span class="muted">结构形式</span><b>{{ b.structure }}</b></div>
        <div><span class="muted">层高</span><b class="mono">{{ b.floorHeight }} m</b></div>
        <div><span class="muted">建筑高度</span><b class="mono">{{ b.height }} m</b></div>
        <div><span class="muted">占地轮廓</span><b class="mono">{{ b.footprintArea }} ㎡</b></div>
        <div><span class="muted">所属组团</span><b>{{ b.group }}</b></div>
      </div>
    </template>

    <!-- ================= 管段 ================= -->
    <template v-else-if="card.kind === 'pipe'">
      <div class="metric-grid">
        <div class="metric"><span>管径</span><b class="mono">DN{{ b.diameter }}</b></div>
        <div class="metric"><span>埋深</span><b class="mono">{{ b.depth }} m</b></div>
        <div class="metric"><span>管龄</span><b class="mono">{{ b.age }} 年</b></div>
        <div class="metric"><span>长度</span><b class="mono">{{ b.length }} m</b></div>
      </div>
      <div class="card-body">
        <div class="kv"><span class="muted">材质</span><b>{{ b.material }}</b></div>
        <div class="kv"><span class="muted">建设年份</span><b class="mono">{{ b.builtYear }}</b></div>
        <div class="kv">
          <span class="muted">运行压力</span><b class="mono">{{ b.pipe === 'sewage' ? '重力流' : `${b.pressure} MPa` }}</b>
        </div>
        <div class="kv">
          <span class="muted">健康度</span>
          <b>
            <span class="health-bar"><i :style="{ width: `${b.health * 100}%`, background: b.riskLevel === 'high' ? '#ef4444' : b.riskLevel === 'medium' ? '#f59e0b' : '#22c55e' }"></i></span>
            <span class="mono">{{ b.health.toFixed(2) }}</span>
          </b>
        </div>
        <div class="kv">
          <span class="muted">风险等级</span>
          <span class="tag" :class="b.riskLevel === 'high' ? 'tag-danger' : b.riskLevel === 'medium' ? 'tag-warn' : 'tag-ok'">
            {{ b.healthLevel }}
          </span>
        </div>
      </div>
    </template>

    <!-- ================= 测点 ================= -->
    <template v-else-if="card.kind === 'sensor'">
      <div class="metric-grid">
        <div class="metric"><span>实时值</span><b class="mono">{{ b.value }} {{ b.unit }}</b></div>
        <div class="metric"><span>预警阈值</span><b class="mono">{{ b.warn }}</b></div>
        <div class="metric"><span>报警阈值</span><b class="mono">{{ b.crit }}</b></div>
        <div class="metric">
          <span>状态</span>
          <b>
            <span class="tag" :class="b.status === 'critical' ? 'tag-danger' : b.status === 'warning' ? 'tag-warn' : 'tag-ok'">
              {{ b.status === 'critical' ? '严重' : b.status === 'warning' ? '预警' : '正常' }}
            </span>
          </b>
        </div>
      </div>
      <div class="card-body">
        <div class="kv"><span class="muted">测点编号</span><b class="mono">{{ b.id }}</b></div>
        <div class="kv"><span class="muted">所属位置</span><b>{{ b.buildingId || '室外管网' }}</b></div>
        <div class="kv"><span class="muted">采样时间</span><b class="mono">{{ (b.at || '').replace('T', ' ').slice(0, 19) }}</b></div>
      </div>
    </template>

    <!-- ================= 文本 ================= -->
    <div v-else class="card-body text-body">{{ card.content }}</div>
  </section>
</template>

<style scoped>
.card {
  position: absolute;
  top: 74px;
  left: 336px;
  width: 356px;
  max-height: calc(100vh - 170px);
  display: flex;
  flex-direction: column;
  z-index: 46;
}
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--border);
}
.title {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.title .id {
  display: grid;
  place-items: center;
  min-width: 40px;
  height: 26px;
  padding: 0 6px;
  border-radius: 7px;
  background: rgba(56, 189, 248, 0.16);
  border: 1px solid rgba(56, 189, 248, 0.4);
  color: #bae6fd;
  font-size: 12px;
}
.title .ico {
  font-size: 17px;
  background: transparent;
  border: none;
  min-width: auto;
}
.title-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.title-main strong {
  font-size: 14px;
}
.title-main span {
  font-size: 10.5px;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--border);
  border-bottom: 1px solid var(--border);
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 8px;
  background: rgba(16, 26, 44, 0.86);
}
.metric span {
  font-size: 10px;
  color: var(--text-3);
}
.metric b {
  font-size: 13px;
}
.trend-row {
  display: flex;
  align-items: flex-end;
  gap: 9px;
  padding: 10px 13px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}
.bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 30px;
}
.bars i {
  flex: 1;
  min-width: 4px;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(180deg, #38bdf8, rgba(56, 189, 248, 0.25));
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 9px 11px 0;
}
.tabs button {
  padding: 4px 9px;
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
.card-body {
  padding: 10px 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  overflow: hidden;
}
.floor-actions {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 11px;
}
.primary {
  padding: 7px 11px;
  border-radius: 8px;
  border: 1px solid rgba(56, 189, 248, 0.5);
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.3), rgba(56, 189, 248, 0.16));
  color: #e0f2fe;
  font-size: 12px;
  cursor: pointer;
}
.primary:hover {
  border-color: var(--accent);
}
.primary.ghost {
  background: rgba(148, 163, 184, 0.14);
  border-color: var(--border-strong);
  color: var(--text-1);
}
.floor-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  max-height: 116px;
  padding: 2px 0;
}
.floor-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 46px;
  padding: 5px 7px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: rgba(148, 163, 184, 0.08);
  color: var(--text-2);
  font-size: 10px;
  cursor: pointer;
}
.floor-chip b {
  font-size: 12px;
}
.floor-chip:hover {
  border-color: var(--border-strong);
}
.floor-chip.active {
  background: rgba(255, 140, 66, 0.24);
  border-color: rgba(255, 140, 66, 0.7);
  color: #ffedd5;
}
.unit-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}
.unit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
}
.unit-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 190px;
}
.unit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  background: rgba(148, 163, 184, 0.07);
  font-size: 11.5px;
}
.unit-no {
  min-width: 34px;
  color: var(--accent);
}
.unit-area {
  min-width: 52px;
}
.unit-layout {
  flex: 1;
}
.unit-owner {
  font-size: 10.5px;
}
.hint {
  font-size: 11px;
  padding: 6px 0;
}
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px 12px;
}
.info-grid > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.health-bar {
  display: inline-block;
  width: 96px;
  height: 6px;
  margin-right: 7px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.22);
  overflow: hidden;
  vertical-align: middle;
}
.health-bar i {
  display: block;
  height: 100%;
}
.text-body {
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-2);
  white-space: pre-wrap;
  max-height: 50vh;
  overflow-y: auto;
}
</style>
