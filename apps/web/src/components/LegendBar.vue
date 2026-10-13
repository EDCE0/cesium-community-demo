<script setup>
/**
 * 图例：随图层状态动态显示可见要素的配色说明
 */
import { computed } from 'vue'

const props = defineProps({
  underground: { type: Boolean, default: false },
  layers: { type: Object, default: () => ({}) },
})

const items = computed(() => {
  const list = []
  if (props.layers.buildings) {
    list.push({ c: '#8ab4f8', t: '住宅楼' }, { c: '#7ed0a8', t: '社区服务' }, { c: '#ffd166', t: '幼儿园' }, { c: '#f4a261', t: '商业' })
  }
  if (props.layers.greens) list.push({ c: '#86c48f', t: '绿地广场' })
  if (props.layers.pipes) {
    list.push({ c: '#2E86FF', t: '给水管' }, { c: '#FF8C00', t: '燃气管' }, { c: '#8B5A2B', t: '污水管' })
  }
  if (props.layers.sensors) list.push({ c: '#22d3ee', t: 'IoT 测点' })
  return list
})
</script>

<template>
  <div class="legend">
    <div class="row" v-if="underground">
      <span class="mode">地下隧道视图</span>
      <span class="hint">按真实埋深渲染（1.0 – 3.4 m）</span>
    </div>
    <div class="items">
      <span v-for="i in items" :key="i.t" class="item">
        <i :style="{ background: i.c }"></i>{{ i.t }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.legend {
  position: absolute;
  left: 16px;
  bottom: 18px;
  min-width: 180px;
  padding: 9px 11px;
  border-radius: 10px;
  background: rgba(11, 18, 32, 0.78);
  border: 1px solid var(--border);
  backdrop-filter: blur(10px);
  z-index: 18;
  pointer-events: none;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 7px;
  padding-bottom: 7px;
  border-bottom: 1px dashed var(--border);
}
.mode {
  font-size: 12px;
  color: var(--accent);
  font-weight: 600;
}
.hint {
  font-size: 10.5px;
  color: var(--text-3);
}
.items {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 12px;
  max-width: 260px;
}
.item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-2);
}
.item i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}
</style>
