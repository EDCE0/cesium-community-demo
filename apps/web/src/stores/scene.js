/**
 * 场景状态：数据、图层开关、选中对象、三维服务实例
 *
 * 说明：Cesium 的 Viewer / Entity 对象一律用 markRaw 存原始引用，
 * 避免 Vue 深度代理造成性能问题与 Cesium 内部断言失败。
 */
import { defineStore } from 'pinia'
import { markRaw } from 'vue'

export const useSceneStore = defineStore('scene', {
  state: () => ({
    /** 是否完成初始化 */
    ready: false,
    loading: true,
    error: null,

    /** 三维服务（原始对象，不做响应式代理） */
    svc: null,

    /** 业务数据 */
    site: null,
    buildings: [],
    pipes: [],
    sensors: [],
    timeseries: null,
    alarms: [],
    property: null,

    /** 图层可见性（与 service 同步） */
    layers: {
      baseMap: true,
      buildings: true,
      roads: true,
      greens: true,
      pipes: false,
      sensors: true,
    },

    /** 选中状态 */
    selectedBuildingId: null,
    selectedBuilding: null,
    expandedBuildingId: null,
    activeFloor: null,
    selectedPipe: null,
    selectedSensor: null,

    /** 管线过滤与埋深放大 */
    pipeFilter: [],
    depthScale: 1,
    underground: false,

    /** 视图控制 */
    viewMode: 'orbit',
    showTooltips: true,

    /** IoT 实时读数快照（由模拟器每 2 s 刷新） */
    iotReadings: [],
    iotAbnormal: [],
  }),

  getters: {
    residentialBuildings: (s) => s.buildings.filter((b) => b.type === 'residential'),
    statistics: (s) => {
      const list = s.property?.buildings || []
      const units = list.reduce((a, b) => a + b.units, 0)
      const occupied = list.reduce((a, b) => a + b.occupiedUnits, 0)
      return {
        buildings: s.buildings.length,
        residential: s.buildings.filter((b) => b.type === 'residential').length,
        units,
        occupied,
        occupancyRate: units ? occupied / units : 0,
        pipeLength: s.pipes.reduce((a, p) => a + (p.length || 0), 0),
        sensors: s.sensors.length,
        area: s.site?.area || 0,
        greenRate: s.site?.greenRate || 0,
      }
    },
    criticalPipes: (s) => s.pipes.filter((p) => p.riskLevel === 'high'),
  },

  actions: {
    setService(svc) {
      this.svc = markRaw(svc)
    },
    setData(payload) {
      this.site = payload.site
      this.buildings = payload.buildings.map((f) => ({ ...f.properties, feature: f }))
      this.pipes = payload.pipes.map((f) => f.properties)
      this.sensors = payload.sensors.map((f) => f.properties)
      this.timeseries = payload.timeseries
      this.alarms = payload.alarms.alarms
      this.property = payload.property
    },
    /** 索引：名称 / 编号 -> 楼栋，供命令解析使用 */
    buildIndex() {
      const map = new Map()
      this.buildings.forEach((b) => {
        map.set(b.id, b)
        map.set(b.name.replace(/\s+/g, ''), b)
      })
      return { buildings: map }
    },
    selectBuilding(detail) {
      this.selectedBuildingId = detail?.id || null
      this.selectedBuilding = detail || null
      this.activeFloor = null
    },
    clearSelection() {
      this.selectedBuildingId = null
      this.selectedBuilding = null
      this.selectedPipe = null
      this.selectedSensor = null
      this.activeFloor = null
    },
    setLayer(id, visible) {
      this.layers[id] = visible
    },
  },
})
