<script setup>
/**
 * 告警中心：历史告警事件 + 当前 IoT 越限测点 + 故障注入（演示用）
 */
import { computed } from 'vue'

const props = defineProps({
  alarms: { type: Array, default: () => [] },
  abnormal: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'inject', 'locate'])

const levelText = { critical: '严重', warning: '告警', info: '提示' }
const levelClass = { critical: 'tag-danger', warning: 'tag-warn', info: 'tag' }

const sorted = computed(() =>
  [...props.alarms].sort((a, b) => new Date(b.ts.replace(' ', 'T')) - new Date(a.ts.replace(' ', 'T'))),
)

function locate(a) {
  if (a.target && /^B/.test(a.target)) emit('locate', a)
}
</script>

<template>
  <aside class="panel alarm-panel">
    <div class="panel-head">
      <div class="panel-title"><span class="ico">⚠</span>告警中心</div>
      <button class="icon-btn" @click="emit('close')">✕</button>
    </div>

    <div class="section">
      <div class="section-head">
        <span>实时越限测点</span>
        <span class="tag" :class="abnormal.length ? 'tag-danger' : 'tag-ok'">{{ abnormal.length }} 个</span>
      </div>
      <div v-if="!abnormal.length" class="empty">当前所有 IoT 测点均在正常区间</div>
      <div v-else class="list scroll-y">
        <div v-for="r in abnormal" :key="r.id" class="row" :class="r.status">
          <span class="dot"></span>
          <div class="row-main">
            <div class="row-title">{{ r.name }}</div>
            <div class="row-sub mono">{{ r.id }} · {{ r.value }} {{ r.unit }}（阈值 {{ r.status === 'critical' ? r.crit : r.warn }}）</div>
          </div>
          <span class="tag" :class="r.status === 'critical' ? 'tag-danger' : 'tag-warn'">
            {{ r.status === 'critical' ? '严重' : '预警' }}
          </span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <span>历史告警事件</span>
        <span class="muted">{{ sorted.length }} 条</span>
      </div>
      <div class="list scroll-y">
        <div v-for="a in sorted" :key="a.id" class="row alarm" @click="locate(a)">
          <span class="dot" :class="a.level"></span>
          <div class="row-main">
            <div class="row-title">
              {{ a.message }}
            </div>
            <div class="row-sub mono">{{ a.ts }} · {{ a.targetName }} · 处理人 {{ a.handler }}</div>
          </div>
          <span class="tag" :class="levelClass[a.level]">{{ levelText[a.level] }}</span>
        </div>
      </div>
    </div>

    <div class="footer">
      <span class="muted">演示：注入人为故障触发告警联动</span>
      <div class="btns">
        <button class="chip" @click="emit('inject', 'gasLeak')">燃气泄漏</button>
        <button class="chip" @click="emit('inject', 'waterDrop')">供水压力骤降</button>
        <button class="chip" @click="emit('inject', 'powerOverload')">配电过载</button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.alarm-panel {
  position: absolute;
  top: 74px;
  right: 18px;
  width: 396px;
  max-height: calc(100vh - 220px);
  display: flex;
  flex-direction: column;
  z-index: 45;
}
.section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid var(--border);
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 13px 4px;
  font-size: 11.5px;
  color: var(--text-3);
  letter-spacing: 0.4px;
}
.list {
  max-height: 220px;
  padding: 4px 8px 10px;
}
.empty {
  padding: 10px 13px 14px;
  font-size: 12px;
  color: var(--text-3);
}
.row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 9px;
  border-radius: 8px;
  border: 1px solid transparent;
}
.row:hover {
  background: rgba(148, 163, 184, 0.07);
}
.row.alarm {
  cursor: pointer;
}
.row.critical {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}
.row.warning {
  background: rgba(245, 158, 11, 0.09);
  border-color: rgba(245, 158, 11, 0.26);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: var(--text-3);
}
.dot.critical {
  background: var(--danger);
  box-shadow: 0 0 8px var(--danger);
}
.dot.warning {
  background: var(--warn);
}
.dot.info {
  background: var(--accent);
}
.row-main {
  flex: 1;
  min-width: 0;
}
.row-title {
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-1);
}
.row-sub {
  font-size: 10.5px;
  color: var(--text-3);
  margin-top: 1px;
}
.footer {
  padding: 10px 13px 12px;
}
.btns {
  display: flex;
  gap: 6px;
  margin-top: 7px;
  flex-wrap: wrap;
}
</style>
