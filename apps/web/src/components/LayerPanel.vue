<script setup>
/**
 * 图层面板：三维图层开关 + 管网过滤 + 埋深放大 + 楼栋速查
 */
import { ref, computed } from 'vue'

const props = defineProps({
  layers: { type: Object, required: true },
  buildings: { type: Array, default: () => [] },
  pipes: { type: Array, default: () => [] },
  underground: { type: Boolean, default: false },
  depthScale: { type: Number, default: 1 },
})
const emit = defineEmits(['toggle', 'select-building', 'quick', 'pipe-filter', 'depth-scale', 'focus-pipe'])

const LAYER_META = [
  { id: 'buildings', label: '建筑白模', ico: '🏢', hint: '24 栋（含 17 栋住宅）' },
  { id: 'roads', label: '小区道路', ico: '🛣', hint: '主环路 / 支路' },
  { id: 'greens', label: '绿地广场', ico: '🌳', hint: '绿化率 36%' },
  { id: 'pipes', label: '地下管线', ico: '🧩', hint: '给水 / 燃气 / 污水' },
  { id: 'sensors', label: 'IoT 测点', ico: '📡', hint: '41 个在线测点' },
  { id: 'baseMap', label: '城市底纹', ico: '🗺', hint: '程序化生成（无 Key）' },
]

const tab = ref('layers')
const filter = ref('all')
const sortedBuildings = computed(() => [...props.buildings].sort((a, b) => a.id.localeCompare(b.id)))

function setFilter(t) {
  filter.value = t
  emit('pipe-filter', t === 'all' ? ['all'] : [t])
}

const pipeStats = computed(() => {
  const byType = { water: 0, gas: 0, sewage: 0 }
  props.pipes.forEach((p) => (byType[p.pipe] = (byType[p.pipe] || 0) + p.length))
  return byType
})
</script>

<template>
  <aside class="panel layer-panel">
    <div class="panel-head">
      <div class="panel-title"><span class="ico">🗂</span>图层与资源</div>
      <div class="tabs">
        <button :class="{ active: tab === 'layers' }" @click="tab = 'layers'">图层</button>
        <button :class="{ active: tab === 'buildings' }" @click="tab = 'buildings'">楼栋</button>
        <button :class="{ active: tab === 'pipes' }" @click="tab = 'pipes'">管网</button>
      </div>
    </div>

    <!-- ---------- 图层 ---------- -->
    <div v-if="tab === 'layers'" class="panel-body scroll-y">
      <label v-for="l in LAYER_META" :key="l.id" class="layer-row">
        <span class="ico">{{ l.ico }}</span>
        <span class="meta">
          <span class="label">{{ l.label }}</span>
          <span class="hint">{{ l.hint }}</span>
        </span>
        <span class="switch" :class="{ on: layers[l.id] }" @click.prevent="emit('toggle', l.id, !layers[l.id])">
          <i></i>
        </span>
      </label>

      <div class="divider"></div>
      <div class="quick-grid">
        <button class="quick" @click="emit('quick', 'overview')">🔭 小区全景</button>
        <button class="quick" :class="{ active: underground }" @click="emit('quick', 'underground')">
          {{ underground ? '⬆ 返回地表' : '⬇ 地下管线' }}
        </button>
        <button class="quick" @click="emit('quick', 'gas')">🔥 燃气高亮</button>
        <button class="quick" @click="emit('quick', 'stats')">📈 用水统计</button>
        <button class="quick" @click="emit('quick', 'faults')">🧪 注入故障</button>
        <button class="quick" @click="emit('quick', 'reset')">↺ 复位视角</button>
      </div>
    </div>

    <!-- ---------- 楼栋 ---------- -->
    <div v-else-if="tab === 'buildings'" class="panel-body scroll-y">
      <div class="list-head muted">共 {{ buildings.length }} 栋 · 点击定位</div>
      <button v-for="b in sortedBuildings" :key="b.id" class="bld-row" @click="emit('select-building', b.id)">
        <span class="bld-id mono">{{ b.id }}</span>
        <span class="bld-name">{{ b.name }}</span>
        <span class="bld-meta muted">{{ b.floors }}F · {{ b.units }}户 · {{ (b.occupancyRate * 100).toFixed(0) }}%</span>
      </button>
    </div>

    <!-- ---------- 管网 ---------- -->
    <div v-else class="panel-body scroll-y">
      <div class="list-head muted">管网总长 {{ ((pipeStats.water + pipeStats.gas + pipeStats.sewage) / 1000).toFixed(2) }} km</div>
      <div class="filter-row">
        <button class="chip" :class="{ active: filter === 'all' }" @click="setFilter('all')">全部</button>
        <button class="chip" :class="{ active: filter === 'water' }" @click="setFilter('water')">给水 {{ (pipeStats.water / 1000).toFixed(2) }}km</button>
        <button class="chip" :class="{ active: filter === 'gas' }" @click="setFilter('gas')">燃气 {{ (pipeStats.gas / 1000).toFixed(2) }}km</button>
        <button class="chip" :class="{ active: filter === 'sewage' }" @click="setFilter('sewage')">污水 {{ (pipeStats.sewage / 1000).toFixed(2) }}km</button>
      </div>

      <div class="slider-row">
        <span class="muted">埋深放大 ×{{ depthScale.toFixed(1) }}</span>
        <input
          type="range"
          min="1"
          max="8"
          step="0.5"
          :value="depthScale"
          @input="(e) => emit('depth-scale', Number(e.target.value))"
        />
      </div>

      <div class="divider"></div>
      <button v-for="p in pipes" :key="p.id" class="pipe-row" @click="emit('focus-pipe', p.id)">
        <span class="swatch" :style="{ background: p.color }"></span>
        <span class="pipe-main">
          <span class="pipe-name">{{ p.name }}</span>
          <span class="pipe-sub muted mono">DN{{ p.diameter }} · {{ p.material }} · 埋深 {{ p.depth }}m · {{ p.age }}年</span>
        </span>
        <span class="tag" :class="p.riskLevel === 'high' ? 'tag-danger' : p.riskLevel === 'medium' ? 'tag-warn' : 'tag-ok'">
          {{ p.health.toFixed(2) }}
        </span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.layer-panel {
  position: absolute;
  top: 74px;
  left: 16px;
  width: 306px;
  max-height: calc(100vh - 170px);
  display: flex;
  flex-direction: column;
  z-index: 44;
}
.panel-body {
  max-height: calc(100vh - 240px);
  padding: 10px 11px 14px;
}
.tabs {
  display: flex;
  gap: 3px;
  padding: 2px;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.1);
}
.tabs button {
  padding: 3px 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  font-size: 11.5px;
  cursor: pointer;
}
.tabs button.active {
  background: rgba(56, 189, 248, 0.22);
  color: #e0f2fe;
}
.layer-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.layer-row:hover {
  background: rgba(148, 163, 184, 0.07);
}
.layer-row .ico {
  font-size: 15px;
}
.layer-row .meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.layer-row .label {
  font-size: 12.5px;
}
.layer-row .hint {
  font-size: 10.5px;
  color: var(--text-3);
}
.switch {
  position: relative;
  width: 34px;
  height: 19px;
  border-radius: 10px;
  background: rgba(148, 163, 184, 0.22);
  flex: none;
  transition: 0.2s;
}
.switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #cbd5e1;
  transition: 0.2s;
}
.switch.on {
  background: rgba(56, 189, 248, 0.55);
}
.switch.on i {
  left: 17px;
  background: #fff;
}
.divider {
  height: 1px;
  margin: 10px 0;
  background: var(--border);
}
.quick-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.quick {
  padding: 8px 6px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: rgba(148, 163, 184, 0.08);
  color: var(--text-2);
  font-size: 11.5px;
  cursor: pointer;
  text-align: left;
}
.quick:hover {
  border-color: var(--border-strong);
  color: var(--text-1);
}
.quick.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.55);
  color: #e0f2fe;
}
.list-head {
  font-size: 11px;
  margin-bottom: 7px;
}
.bld-row,
.pipe-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  text-align: left;
}
.bld-row:hover,
.pipe-row:hover {
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.3);
}
.bld-id {
  font-size: 11px;
  color: var(--accent);
  min-width: 34px;
}
.bld-name {
  flex: 1;
  font-size: 12.5px;
}
.bld-meta {
  font-size: 10px;
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 12px;
}
.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
}
.slider-row input {
  flex: 1;
  accent-color: var(--accent);
}
.pipe-row .swatch {
  width: 4px;
  height: 26px;
  border-radius: 2px;
  flex: none;
}
.pipe-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.pipe-name {
  font-size: 12px;
}
.pipe-sub {
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
