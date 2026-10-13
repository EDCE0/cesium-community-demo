/**
 * 界面状态：面板开关、图表卡片、悬浮提示、Toast
 * Agent 命令通过这里有副作用地驱动界面（setPanel / showChart / showTooltip …）
 */
import { defineStore } from 'pinia'

let seq = 0
const uid = (p = 'id') => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`

export const useUiStore = defineStore('ui', {
  state: () => ({
    panels: {
      layers: true,
      stats: true,
      chat: true,
      alarms: false,
      legend: true,
      help: false,
    },
    /** 叠加在 Cesium 之上的图表卡片 */
    charts: [],
    /** 场景悬浮提示 */
    tooltips: [],
    /** 右下角轻提示 */
    toasts: [],
    card: { open: false, kind: null, data: null, title: '', content: '' },
    activeFloor: null,
  }),

  actions: {
    setPanel(panel, open) {
      if (!(panel in this.panels)) return false
      this.panels[panel] = open === undefined ? !this.panels[panel] : !!open
      return this.panels[panel]
    },
    resetPanels() {
      this.panels = { layers: true, stats: true, chat: true, alarms: false, legend: true, help: false }
    },

    /* ---------------- 信息卡片 ---------------- */
    openCard(detail) {
      this.card = { open: true, kind: 'building', data: detail, title: detail?.name || '', content: '' }
      this.activeFloor = null
    },
    openPipeCard(pipe) {
      this.card = { open: true, kind: 'pipe', data: pipe, title: pipe.name, content: '' }
    },
    openSensorCard(sensor) {
      this.card = { open: true, kind: 'sensor', data: sensor, title: sensor.name, content: '' }
    },
    openTextCard(title, content) {
      this.card = { open: true, kind: 'text', data: null, title, content }
    },
    closeCard() {
      this.card = { open: false, kind: null, data: null, title: '', content: '' }
    },
    setActiveFloor(floor) {
      this.activeFloor = floor
    },

    /* ---------------- 统计图表 ---------------- */
    pushChart(chart) {
      const item = { id: chart.id || uid('chart'), createdAt: Date.now(), ...chart }
      // 同一指标同一范围只保留最新一张，避免面板越堆越乱
      this.charts = this.charts.filter((c) => !(c.metric === item.metric && c.scope === item.scope)).concat(item)
      if (this.charts.length > 3) this.charts = this.charts.slice(-3)
      this.panels.stats = true
      return item
    },
    removeChart(id) {
      this.charts = this.charts.filter((c) => c.id !== id)
    },
    clearCharts() {
      this.charts = []
    },

    /* ---------------- 场景提示 ---------------- */
    showTooltip(payload) {
      const item = {
        id: uid('tip'),
        text: payload.text,
        longitude: payload.longitude,
        latitude: payload.latitude,
        height: payload.height ?? 60,
        duration: payload.duration ?? 8,
        createdAt: Date.now(),
      }
      this.tooltips = [...this.tooltips.filter((t) => Date.now() - t.createdAt < (t.duration || 8) * 1000), item]
      setTimeout(() => {
        this.tooltips = this.tooltips.filter((t) => t.id !== item.id)
      }, item.duration * 1000)
      return { shown: true, id: item.id }
    },
    removeTooltip(id) {
      this.tooltips = this.tooltips.filter((t) => t.id !== id)
    },

    /* ---------------- Toast ---------------- */
    toast(message, type = 'info', timeout = 3600) {
      const id = uid('toast')
      this.toasts.push({ id, message, type })
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id)
      }, timeout)
      return id
    },
  },
})
