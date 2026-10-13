<script setup>
/**
 * ECharts 封装：透明背景 + 自适应尺寸 + 点击下钻事件
 * 通过 CSS 叠加在 Cesium Canvas 之上，实现"图表与三维场景融合"。
 */
import { ref, onMounted, onBeforeUnmount, watch, shallowRef } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  option: { type: Object, required: true },
  height: { type: String, default: '100%' },
})
const emit = defineEmits(['chart-click'])

const el = ref(null)
const chart = shallowRef(null)
let ro = null

function render() {
  if (!chart.value) return
  chart.value.setOption(props.option, true)
}

onMounted(() => {
  chart.value = echarts.init(el.value, null, { renderer: 'canvas' })
  render()
  chart.value.on('click', (params) => {
    emit('chart-click', {
      name: params.name,
      value: params.value,
      seriesName: params.seriesName,
      dataIndex: params.dataIndex,
    })
  })
  ro = new ResizeObserver(() => chart.value?.resize())
  ro.observe(el.value)
  window.addEventListener('resize', () => chart.value?.resize())
})

onBeforeUnmount(() => {
  ro?.disconnect()
  chart.value?.dispose()
  chart.value = null
})

watch(() => props.option, render, { deep: true })
</script>

<template>
  <div ref="el" class="chart" :style="{ height }"></div>
</template>

<style scoped>
.chart {
  width: 100%;
  min-height: 120px;
}
</style>
