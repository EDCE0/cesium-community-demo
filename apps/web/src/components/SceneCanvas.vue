<script setup>
import { ref, onMounted } from 'vue'

const el = ref(null)

/** 供父组件获取真实 DOM 容器 */
function getContainer() {
  return el.value
}

onMounted(() => {})

defineExpose({ getContainer })
</script>

<template>
  <div ref="el" class="cesium-host" id="cesiumContainer"></div>
</template>

<style scoped>
.cesium-host {
  position: absolute;
  inset: 0;
  background: #0b1220;
}
.cesium-host :deep(.cesium-viewer) {
  width: 100%;
  height: 100%;
}
</style>
