/**
 * CesiumViewerService —— 三维场景总装
 * ---------------------------------------------------------------------------
 * 职责：
 *   1) 创建 Viewer（关闭所有联网依赖：无 Ion、无在线影像、无地形服务）
 *   2) 装配底图 / 建筑 / 道路 / 绿地 / 管线 / IoT 六层数据
 *   3) 接入 cesium-mcp-bridge（AI Agent 的浏览器端执行层）
 *   4) 负责拾取交互：点楼栋 → 楼层分层；点管线 → 属性；点 IoT → 实时值
 *   5) 对外抛出事件，供 Vue 面板与 Agent 使用
 * ---------------------------------------------------------------------------
 */
import * as Cesium from 'cesium'
import { addCommunityDetails } from './details.js'
import { CesiumBridge } from 'cesium-mcp-bridge'
import { addBaseMap, addSiteGround } from './baseMap.js'
import { createTunnelController } from './tunnel.js'
import {
  loadBuildings,
  loadRoads,
  loadGreens,
  loadPipes,
  loadSensors,
  createFloorViewer,
  pickBuildingByRay,
  BUILDING_COLORS,
} from './layers.js'
import { createBus } from '../lib/util.js'

export const SELECT_COLOR = '#ffd166'

export class CesiumViewerService {
  constructor() {
    this.bus = createBus()
    this.viewer = null
    this.bridge = null
    this.site = null
    this.buildings = null
    this.roads = null
    this.greens = null
    this.pipes = null
    this.sensors = null
    this.floorViewer = null
    this.tunnel = null
    this.baseMap = null
    this.selectedBuildingId = null
    this.expandedBuildingId = null
    this._layerVisibility = {
      baseMap: true,
      buildings: true,
      roads: true,
      greens: true,
      pipes: false,
      sensors: true,
    }
  }

  on(type, fn) {
    return this.bus.on(type, fn)
  }
  emit(type, payload) {
    this.bus.emit(type, payload)
  }

  /* ------------------------------------------------------------------ */
  /* 初始化                                                              */
  /* ------------------------------------------------------------------ */

  async init(container, site, injectedData) {
    this.site = site
    if (injectedData) this.data = injectedData
    const center = site.origin

    this.viewer = new Cesium.Viewer(container, {
      // 全部在线服务关闭：本 Demo 不依赖 Cesium Ion / 任何瓦片服务
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
      requestRenderMode: false,
      contextOptions: {
        webgl: {
          alpha: false,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance',
        },
      },
    })

    const scene = this.viewer.scene
    scene.backgroundColor = Cesium.Color.fromCssColorString('#0b1220')
    scene.skyAtmosphere.show = true
    scene.fog.enabled = false
    scene.globe.showGroundAtmosphere = false
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#cbd3da')
    scene.screenSpaceCameraController.enableCollisionDetection = false
    scene.screenSpaceCameraController.minimumZoomDistance = 8
    scene.screenSpaceCameraController.maximumZoomDistance = 12000
    scene.highDynamicRange = false
    scene.postProcessStages.fxaa.enabled = true
    // 初始视角：机位在小区正南、俯角 45°、高 780 m
    // 这样视线正好落在场地中心（高度 780 m ÷ tan45° ≈ 780 m 水平距离），
    // 约 520 m 见方的场地刚好填满视口，首屏即可看清全部楼栋肌理。
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(center.lon - 0.0038, center.lat - 0.0053, 540),
      orientation: { heading: Cesium.Math.toRadians(28), pitch: Cesium.Math.toRadians(-42), roll: 0 },
    })

    // --- 底图与场地 ---
    this.baseMap = addBaseMap(this.viewer, center, {
      mPerDegLat: 111320,
      mPerDegLon: 111320 * Math.cos((center.lat * Math.PI) / 180),
    })
    this.siteGround = addSiteGround(this.viewer, site, center)

    // --- 数据图层（逐个记录装配耗时，便于定位渲染问题来自哪一层）---
    const data = this.data
    const stage = (name, fn) => {
      try {
        const r = fn()
        console.info(`[scene] ${name} 装载完成`)
        return r
      } catch (e) {
        console.error(`[scene] ${name} 装载失败：${e.message}`)
        throw e
      }
    }
    this.buildings = await stage('建筑白模', () => loadBuildings(this.viewer, data.buildings))
    this.roads = await stage('道路', () => loadRoads(this.viewer, data.roads))
    this.greens = await stage('绿地', () => loadGreens(this.viewer, data.greens))
    this.pipes = stage('地下管线', () => loadPipes(this.viewer, data.pipes))
    this.sensors = stage('IoT 点位', () => loadSensors(this.viewer, data.sensors))
    this.details = addCommunityDetails(this.viewer, data)
    this.floorViewer = createFloorViewer(this.viewer)
    this.tunnel = createTunnelController(this.viewer)

    this.applyVisibility()

    // --- AI Agent 执行层 ---
    this.bridge = new CesiumBridge(this.viewer)

    // --- 交互 ---
    this._bindPicking()

    // 隧道剪裁面需要每帧更新
    scene.preRender.addEventListener(() => {
      if (this.tunnel?.active) this.tunnel.update(center)
    })

    this.emit('ready', { viewer: this.viewer, bridge: this.bridge, site })
    return this
  }

  /** 供 loadXxx 使用的数据（由外部注入，避免重复请求） */
  setData(data) {
    this.data = data
    return this
  }

  /* ------------------------------------------------------------------ */
  /* 图层开关                                                            */
  /* ------------------------------------------------------------------ */

  applyVisibility() {
    const v = this._layerVisibility
    this.baseMap?.setVisible(v.baseMap)
    if (this.siteGround) this.siteGround.show = v.baseMap
    this.buildings?.setVisible(v.buildings)
    this.details?.setVisible(v.baseMap)
    this.details?.setBuildingsVisible(v.baseMap && v.buildings && !this.expandedBuildingId)
    this.roads?.setVisible(v.roads)
    this.greens?.setVisible(v.greens)
    this.pipes?.setVisible(v.pipes)
    this.sensors?.setVisible(v.sensors)
  }

  setLayerVisibility(id, visible) {
    if (!(id in this._layerVisibility)) return false
    this._layerVisibility[id] = !!visible
    this.applyVisibility()
    this.emit('layerVisibility', { id, visible: !!visible })
    return true
  }

  getLayerVisibility() {
    return { ...this._layerVisibility }
  }

  /* ------------------------------------------------------------------ */
  /* 拾取与交互                                                          */
  /* ------------------------------------------------------------------ */

  _bindPicking() {
    const scene = this.viewer.scene

    // 左键点击
    this.viewer.screenSpaceEventHandler.setInputAction((movement) => {
      const picked = scene.pick(movement.position)
      const obj = picked?.id

      // 1) 楼层板
      if (obj && typeof obj === 'object' && obj.properties?.floor) {
        const floor = obj.properties.floor.getValue()
        const buildingId = obj.properties.buildingId?.getValue()
        this.floorViewer.highlightFloor(floor)
        this.emit('floorSelected', { buildingId, floor })
        return
      }

      // 2) 实体（管线 / IoT / 建筑）
      if (obj && obj.id) {
        const props = obj.properties
        const kind = props?.kind?.getValue?.()
        if (kind === 'pipe') {
          const p = {}
          props.propertyNames?.forEach((n) => (p[n] = props[n].getValue()))
          this.pipes.highlight(p.id, true)
          this.emit('pipeSelected', p)
          return
        }
        if (kind === 'sensor') {
          const p = {}
          props.propertyNames?.forEach((n) => (p[n] = props[n].getValue()))
          this.emit('sensorSelected', p)
          return
        }
        if (obj.__domainId) {
          this.selectBuilding(obj.__domainId)
          return
        }
      }

      // 3) 贴地多边形 pick 失败时，用射线与轮廓求交兜底
      const byRay = pickBuildingByRay(this.viewer, this.buildings.footprintMap, movement.position)
      if (byRay) {
        this.selectBuilding(byRay)
        return
      }

      // 4) 点空白：取消选中（保留楼层展开）
      this.emit('clearSelection')
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    // 悬停高亮
    this.viewer.screenSpaceEventHandler.setInputAction((movement) => {
      const picked = scene.pick(movement.endPosition)
      const obj = picked?.id
      if (obj && obj.__domainId) {
        scene.canvas.style.cursor = 'pointer'
        this.emit('hoverBuilding', obj.__domainId)
      } else {
        scene.canvas.style.cursor = 'default'
        this.emit('hoverBuilding', null)
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  }

  /** 选中楼栋：变色 + 相机聚焦 + 事件 */
  selectBuilding(id, options = {}) {
    const record = this.buildings?.entityMap.get(id)
    if (!record) return null

    if (this.selectedBuildingId && this.selectedBuildingId !== id) {
      const prev = this.buildings.entityMap.get(this.selectedBuildingId)
      if (prev) prev.entity.polygon.material = new Cesium.ColorMaterialProperty(prev.baseColor)
    }
    this.selectedBuildingId = id
    record.entity.polygon.material = new Cesium.ColorMaterialProperty(
      Cesium.Color.fromCssColorString(SELECT_COLOR).withAlpha(0.95),
    )

    if (options.fly !== false) {
      const center = record.entity.properties.center?.getValue()
      const lon = center ? center[0] : record.entity.properties.lon.getValue()
      const lat = center ? center[1] : record.entity.properties.lat.getValue()
      this.flyTo({ longitude: lon, latitude: lat, height: Math.max(90, record.height * 3.2) }, options.duration ?? 1.2)
    }

    const detail = this.getBuildingDetail(id)
    this.emit('buildingSelected', detail)
    return detail
  }

  /** 楼栋业务详情（台账 + 入住率 + 近 7 日用量） */
  getBuildingDetail(id) {
    const record = this.buildings?.entityMap.get(id)
    if (!record) return null
    const props = {}
    const p = record.entity.properties
    p.propertyNames?.forEach((n) => (props[n] = p[n].getValue()))
    const ledger = this.propertyData?.buildings?.find((b) => b.id === id) || null
    const trend = this.timeseries?.byBuilding?.[id] || null
    return {
      ...props,
      ledger,
      trend,
      layerId: id,
    }
  }

  /** 楼层分层展示（抽屉式） */
  async expandFloors(id) {
    const record = this.buildings?.entityMap.get(id)
    if (!record) return null
    if (this.expandedBuildingId === id) return { alreadyExpanded: true }

    if (this.expandedBuildingId) await this.collapseFloors()
    this.expandedBuildingId = id
    this.details?.setBuildingsVisible(false)

    record.entity.show = false
    const center = record.entity.properties.center.getValue()
    const footprint = this.buildings.footprintMap.get(id) || null
    const result = await this.floorViewer.expand({
      id,
      name: record.entity.name,
      center,
      floors: record.floors,
      footprint,
    })

    // 相机取景（按几何反算，勿凭感觉调）：
    //   · 抽屉沿「东」逐层错位、总高 stacked = 层数 × 5.2 m
    //   · 机位放在目标东南侧，heading 指向西北，视线正好回看错位展开体
    //   · 仰角 pitch 控制纵向压缩比，height/dist 保证 93 m 高的展开体不越界
    const stacked = record.floors * 5.2
    const midHeight = stacked / 2
    const pitchDeg = -24
    const dist = stacked * 2.6 + 180
    const groundDist = dist * Math.cos((pitchDeg * Math.PI) / 180)
    // 机位在目标的东南方向（与 heading=西北 相反）
    const heading = Cesium.Math.toRadians(320)
    const backBearing = heading + Math.PI
    const east = Math.sin(backBearing) * groundDist
    const north = Math.cos(backBearing) * groundDist
    const mPerDegLat = 111320
    const mPerDegLon = 111320 * Math.cos((center[1] * Math.PI) / 180)
    await this.flyTo(
      {
        longitude: center[0] + east / mPerDegLon,
        latitude: center[1] + north / mPerDegLat,
        height: midHeight + dist * Math.sin((-pitchDeg * Math.PI) / 180),
        heading,
        pitchDeg,
      },
      1.6,
    )
    this.emit('floorsExpanded', { id, floors: record.floors })
    return result
  }

  async collapseFloors() {
    if (!this.expandedBuildingId) return false
    const id = this.expandedBuildingId
    this.floorViewer.clear()
    const record = this.buildings?.entityMap.get(id)
    if (record) record.entity.show = true
    this.expandedBuildingId = null
    this.details?.setBuildingsVisible(this._layerVisibility.baseMap && this._layerVisibility.buildings)
    this.emit('floorsCollapsed', { id })
    return true
  }

  /** 高亮某一楼层（配合信息卡里的楼层列表点击） */
  highlightFloor(floor) {
    if (!this.expandedBuildingId) return false
    this.floorViewer.highlightFloor(floor)
    this.emit('floorSelected', { buildingId: this.expandedBuildingId, floor })
    return true
  }

  /** 高亮管线（支持多段） */
  highlightPipes(ids, on = true) {
    this.pipes.highlight(ids, on)
    return true
  }

  /* ------------------------------------------------------------------ */
  /* 相机                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * 相机飞行
   * @param {object} params
   *   longitude / latitude 必填；height 单位米；
   *   heading / pitch / roll 支持「弧度」或「角度(deprecated 用 xxxDeg)」两种写法
   */
  async flyTo(params, duration) {
    const { longitude, latitude, height = 400, heading, pitch, roll, headingDeg, pitchDeg, rollDeg } = params
    const d = duration ?? params.duration ?? 1.5
    if (longitude === undefined || latitude === undefined) throw new Error('flyTo 需要 longitude 与 latitude')
    const rad = (deg, fallback) => (deg === undefined ? fallback : Cesium.Math.toRadians(deg))
    return this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
      orientation: {
        heading: heading !== undefined ? heading : rad(headingDeg, this.viewer.camera.heading),
        pitch: pitch !== undefined ? pitch : rad(pitchDeg, Cesium.Math.toRadians(-35)),
        roll: roll !== undefined ? roll : rad(rollDeg, 0),
      },
      duration: d,
    })
  }

  zoomToExtent(bbox, duration = 1.5) {
    const [west, south, east, north] = bbox
    return this.viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(west, south, east, north),
      duration,
    })
  }

  getView() {
    const c = this.viewer.camera
    const carto = Cesium.Cartographic.fromCartesian(c.positionWC)
    return {
      longitude: Cesium.Math.toDegrees(carto.longitude),
      latitude: Cesium.Math.toDegrees(carto.latitude),
      height: carto.height,
      heading: c.heading,
      pitch: c.pitch,
      roll: c.roll,
    }
  }

  /** 俯视整个小区：与初始视角保持同一套取景逻辑，只是略有俯角差异 */
  overview(duration = 1.6) {
    const [lon, lat] = [this.site.origin.lon, this.site.origin.lat]
    return this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon - 0.0008, lat - 0.0070, 860),
      orientation: { heading: Cesium.Math.toRadians(-6), pitch: Cesium.Math.toRadians(-48), roll: 0 },
      duration,
    })
  }

  /* ------------------------------------------------------------------ */
  /* 地下隧道                                                            */
  /* ------------------------------------------------------------------ */

  setUnderground(enabled) {
    const on = this.tunnel.setEnabled(!!enabled, this.site.origin)
    if (on) {
      // 关闭自动贴地，允许相机下潜到地下
      this.viewer.scene.screenSpaceCameraController.enableCollisionDetection = false
      this.setLayerVisibility('pipes', true)
      this.pipes.setDepthScale(3.0)
    } else {
      this.pipes.setDepthScale(1.0)
    }
    this.emit('underground', { enabled: on })
    return on
  }

  get underground() {
    return !!this.tunnel?.active
  }
}
