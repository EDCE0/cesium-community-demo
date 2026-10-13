<script setup>
defineProps({ items: { type: Array, default: () => [] } })
</script>

<template>
  <div class="toasts">
    <TransitionGroup name="toast">
      <div v-for="t in items" :key="t.id" class="toast" :class="`toast-${t.type}`">
        <span class="bar"></span>
        <span>{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: absolute;
  top: 74px;
  right: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 90;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: stretch;
  gap: 9px;
  max-width: 400px;
  padding: 9px 13px 9px 0;
  border-radius: 9px;
  background: rgba(11, 18, 32, 0.94);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  color: var(--text-1);
  font-size: 12.5px;
  line-height: 1.5;
  backdrop-filter: blur(10px);
}
.bar {
  width: 3px;
  border-radius: 3px;
  background: var(--accent);
}
.toast-success .bar {
  background: var(--accent-2);
}
.toast-error .bar {
  background: var(--danger);
}
.toast-warn .bar {
  background: var(--warn);
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.26s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
