<script setup>
/**
 * 场景内悬浮提示：把经纬度投影为屏幕坐标，跟随 Cesium 相机移动
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import * as Cesium from 'cesium'

const props = defineProps({
  tip: { type: Object, required: true },
  service: { type: Object, default: null },
})
const emit = defineEmits(['close'])

const pos = ref({ x: -999, y: -999, visible: false })
let removeListener = null

function update() {
  const viewer = props.service?.viewer
  if (!viewer || props.tip.longitude === undefined) {
    pos.value.visible = false
    return
  }
  const cartesian = Cesium.Cartesian3.fromDegrees(props.tip.longitude, props.tip.latitude, props.tip.height ?? 60)
  const win = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian)
  if (!win) {
    pos.value.visible = false
    return
  }
  pos.value = { x: win.x, y: win.y, visible: true }
}

onMounted(() => {
  update()
  const viewer = props.service?.viewer
  if (viewer) {
    viewer.scene.preRender.addEventListener(update)
    removeListener = () => viewer.scene.preRender.removeEventListener(update)
  }
})

onBeforeUnmount(() => removeListener?.())

const style = computed(() => ({
  left: `${pos.value.x}px`,
  top: `${pos.value.y}px`,
  opacity: pos.value.visible ? 1 : 0,
}))
</script>

<template>
  <div class="scene-tip" :style="style">
    <span class="dot"></span>
    <span class="text">{{ tip.text }}</span>
    <button class="x" @click="emit('close')">✕</button>
  </div>
</template>

<style scoped>
.scene-tip {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 320px;
  padding: 7px 10px;
  margin-top: -14px;
  border-radius: 9px;
  background: rgba(11, 18, 32, 0.92);
  border: 1px solid rgba(56, 189, 248, 0.5);
  box-shadow: 0 10px 26px rgba(2, 6, 16, 0.6);
  color: var(--text-1);
  font-size: 12.5px;
  transition: opacity 0.2s;
  pointer-events: auto;
}
.scene-tip::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -7px;
  width: 10px;
  height: 10px;
  transform: translateX(-50%) rotate(45deg);
  background: rgba(11, 18, 32, 0.92);
  border-right: 1px solid rgba(56, 189, 248, 0.5);
  border-bottom: 1px solid rgba(56, 189, 248, 0.5);
}
.dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent);
}
.x {
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: 11px;
}
.x:hover {
  color: var(--text-1);
}
</style>
