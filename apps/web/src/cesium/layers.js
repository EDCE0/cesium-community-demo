/**
 * 三维图层：建筑白模 / 楼层分层 / 地下管线 / IoT 点位 / 道路绿地
 * ---------------------------------------------------------------------------
 * 说明：
 *  - 建筑用 GeoJsonDataSource 加载（保证贴地与轮廓吻合），每栋楼一个 Entity，
 *    Entity.id = 楼栋编号（如 B07），并挂载完整业务属性供 Agent 查询。
 *  - 楼层分离展示不依赖 3D Tiles：本 Demo 用"楼层板 + 错位抽屉"的方式实现，
 *    既保留真实层高（3 m/层），又能一眼看清分层结构（见 README 的工程化演进说明）。
 *  - 管线按真实埋深渲染（1.0~3.4 m），支持"埋深放大"参数以便观察。
 * ---------------------------------------------------------------------------
 */
import * as Cesium from 'cesium'
import { fmt } from '../lib/util.js'

export const BUILDING_COLORS = {
  residential: '#8ab4f8',
  community: '#7ed0a8',
  school: '#ffd166',
  commercial: '#f4a261',
  utility: '#ef8354',
  parking: '#9aa5b1',
}

export const PIPE_COLORS = { water: '#2E86FF', gas: '#FF8C00', sewage: '#8B5A2B' }
export const PIPE_LABELS = { water: '给水', gas: '燃气', sewage: '污水' }

const SELECT_COLOR = '#ffd166'
const HIGHLIGHT_COLOR = '#ff6b6b'

/* ========================================================================== */
/* 建筑                                                                        */
/* ========================================================================== */

/**
 * @param {Cesium.Viewer} viewer
 * @param {object} geojson buildings.geojson
 * @returns {Promise<{dataSource, entityMap, footprintMap, setVisible, setMode}>}
 */
export async function loadBuildings(viewer, geojson) {
  const ds = await Cesium.GeoJsonDataSource.load(geojson, {
    clampToGround: true,
    fill: Cesium.Color.fromCssColorString(BUILDING_COLORS.residential).withAlpha(0.85),
    stroke: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.55),
    strokeWidth: 1.2,
  })
  ds.name = '建筑白模'
  viewer.dataSources.add(ds)

  const entityMap = new Map()
  const footprintMap = new Map()

  ds.entities.values.forEach((entity) => {
    const props = entity.properties
    const get = (k) => props[k]?.getValue()
    const id = get('id') || entity.id
    const type = get('type') || 'residential'
    const height = Number(get('height')) || 12
    const floors = Number(get('floors')) || 4
    const base = Cesium.Color.fromCssColorString(BUILDING_COLORS[type] || BUILDING_COLORS.residential).withAlpha(0.85)

    entity.name = get('name') || id
    entity.__domainId = id
    entity.__baseColor = base
    entity.__currentColor = base

    if (entity.polygon) {
      entity.polygon.height = 0
      entity.polygon.extrudedHeight = height
      entity.polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND
      entity.polygon.material = new Cesium.ColorMaterialProperty(base)
      entity.polygon.outline = true
      entity.polygon.outlineColor = Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.35)
      entity.polygon.outlineWidth = 1.0
    }

    // 记录轮廓，用于精确拾取（贴地多边形在部分显卡上 pick 不稳定）
    const ring = entity.polygon?.hierarchy?.getValue?.(Cesium.JulianDate.now())?.positions
    if (ring && ring.length > 2) {
      footprintMap.set(id, ring.map((p) => Cesium.Cartesian3.clone(p)))
    }
    entityMap.set(id, { entity, type, height, floors, baseColor: base })
  })

  return {
    dataSource: ds,
    entityMap,
    footprintMap,
    setVisible(v) {
      ds.show = v
    },
    /** 恢复全部默认外观 */
    resetColors() {
      entityMap.forEach(({ entity, baseColor }) => {
        entity.polygon.material = new Cesium.ColorMaterialProperty(baseColor)
      })
    },
  }
}

/** 射线与一组建筑轮廓求交（返回最近的楼栋 id） */
export function pickBuildingByRay(viewer, footprintMap, windowPosition) {
  const scene = viewer.scene
  const ray = scene.camera.getPickRay(windowPosition)
  if (!ray) return null
  let best = null
  let bestT = Number.POSITIVE_INFINITY

  footprintMap.forEach((positions, id) => {
    // 先用包围球快速排除
    const bs = Cesium.BoundingSphere.fromPoints(positions)
    if (!Cesium.IntersectionTests.raySphere(ray, bs)) return

    // 再与楼栋顶面所在的水平面求交，判断交点是否落在轮廓内
    const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(positions[0], new Cesium.Cartesian3())
    const plane = Cesium.Plane.fromPointNormal(positions[0], normal)
    const t = Cesium.IntersectionTests.rayPlane(ray, plane)
    if (t === undefined || t < 0 || t >= bestT) return

    const point = Cesium.Ray.getPoint(ray, t, new Cesium.Cartesian3())
    if (pointInRing(point, positions)) {
      bestT = t
      best = id
    }
  })

  return best
}

/** 判断空间点是否落在（近似水平的）多边形轮廓内 */
export function pointInRing(point, ring) {
  // 投影到以 ring[0] 为原点的 ENU 平面，退化为二维问题
  const origin = ring[0]
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin)
  const inv = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4())
  const local = Cesium.Matrix4.multiplyByPoint(inv, point, new Cesium.Cartesian3())
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = Cesium.Matrix4.multiplyByPoint(inv, ring[i], new Cesium.Cartesian3())
    const b = Cesium.Matrix4.multiplyByPoint(inv, ring[j], new Cesium.Cartesian3())
    const intersects = a.y > local.y !== b.y > local.y && local.x < ((b.x - a.x) * (local.y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

/* ========================================================================== */
/* 楼层分层展示（抽屉式）                                                       */
/* ========================================================================== */

/**
 * 楼层分离视图：隐藏原楼栋，逐层生成楼层板并横向错位，形成"抽屉拉开"效果
 */
export function createFloorViewer(viewer) {
  const ds = new Cesium.CustomDataSource('楼层分层')
  viewer.dataSources.add(ds)
  let currentBuilding = null
  const slabMap = new Map()

  const SLAB_THICKNESS = 3.0
  const GAP = 2.2
  const SHIFT = 7.0
  const ANIM_MS = 900
  const STAGGER_MS = 70

  /** 每帧冻结一次时钟，避免同一帧内多个 CallbackProperty 取值不一致 */
  let frameTime = Date.now()
  viewer.scene.preRender.addEventListener(() => {
    frameTime = Date.now()
  })

  function clear() {
    ds.entities.removeAll()
    slabMap.clear()
    currentBuilding = null
  }

  /**
   * @param {object} info { id, name, center:[lon,lat], height, floors, footprint }
   * @returns {Promise<{slabs: Array, release: Function}>}
   */
  async function expand(info) {
    clear()
    const { id, name, center, floors, footprint } = info
    currentBuilding = id
    const lon = center[0]
    const lat = center[1]
    const startedAt = Date.now()

    const created = []
    for (let f = 0; f < floors; f++) {
      const target = f * (SLAB_THICKNESS + GAP)
      const shift = f * SHIFT
      // 逐层延迟升起：楼层越高，延后越多，形成"抽屉依次拉开"的观感
      const delay = f * STAGGER_MS
      const heightCb = () => {
        const t = Math.min(1, Math.max(0, (frameTime - startedAt - delay) / ANIM_MS))
        const eased = 1 - Math.pow(1 - t, 3)
        return target * eased
      }
      // 轮廓用静态值：Cesium 的 PolygonGraphics 对 CallbackProperty 形式的
      // hierarchy 支持不稳定（会出现实体存在但完全不渲染）。
      // 动画只放在高度上，且水平错位固定在最终位置。
      const hierarchy = footprint
        ? new Cesium.PolygonHierarchy(footprint.map((p) => shiftLocal(p, shift, 0)))
        : new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ringFromCenter(lon, lat, 16, 9).flat()))

      const slab = ds.entities.add({
        id: `SLAB-${id}-${f + 1}`,
        name: `${name} ${f + 1} 层`,
        polygon: {
          hierarchy,
          // 逐层升起动画：只用高度做动画（轮廓保持静态，避免 Cesium 不渲染）
          height: new Cesium.CallbackProperty(heightCb, false),
          extrudedHeight: new Cesium.CallbackProperty(() => heightCb() + SLAB_THICKNESS, false),
          material: new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString('#8ab4f8').withAlpha(0.9),
          ),
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.75),
          outlineWidth: 1.0,
        },
        properties: { buildingId: id, floor: f + 1, kind: 'floor' },
      })
      slabMap.set(f + 1, slab)
      created.push(slab)
    }

    return {
      slabs: created,
      release() {
        clear()
      },
    }
  }

  /** 高亮某一层 */
  function highlightFloor(floor) {
    slabMap.forEach((slab, f) => {
      const isTarget = f === floor
      slab.polygon.material = new Cesium.ColorMaterialProperty(
        isTarget
          ? Cesium.Color.fromCssColorString('#ff8c42').withAlpha(0.98)
          : Cesium.Color.fromCssColorString('#8ab4f8').withAlpha(0.45),
      )
    })
  }

  return { expand, clear, highlightFloor, get current() { return currentBuilding }, dataSource: ds }
}

/** 把笛卡尔点沿"东"方向平移（用于抽屉错位） */
function shiftLocal(cartesian, dx, dy) {
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(cartesian)
  const offset = Cesium.Matrix4.multiplyByPointAsVector(
    enu,
    new Cesium.Cartesian3(dx, dy, 0),
    new Cesium.Cartesian3(),
  )
  return Cesium.Cartesian3.add(cartesian, offset, new Cesium.Cartesian3())
}

/** 生成一个矩形轮廓的经纬度数组 */
function ringFromCenter(lon, lat, halfW, halfD) {
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180)
  const dLon = halfW / mPerDegLon
  const dLat = halfD / mPerDegLat
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
  ]
}

/* ========================================================================== */
/* 地下管线                                                                     */
/* ========================================================================== */

export function loadPipes(viewer, geojson) {
  const ds = new Cesium.CustomDataSource('地下管线')
  viewer.dataSources.add(ds)
  const entityMap = new Map()
  let depthScale = 1.0

  function render() {
    ds.entities.removeAll()
    entityMap.clear()
    geojson.features.forEach((f) => {
      const p = f.properties
      const color = Cesium.Color.fromCssColorString(p.color || PIPE_COLORS[p.pipe] || '#2E86FF')
      const degreeArray = []
      f.geometry.coordinates.forEach(([lon, lat]) => {
        degreeArray.push(lon, lat, p.depth * depthScale)
      })

      const entity = ds.entities.add({
        id: p.id,
        name: p.name,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights(degreeArray),
          width: Math.max(2.5, Math.min(9, p.diameter / 45)),
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.16,
            taperPower: 1.0,
            color: color.withAlpha(0.95),
          }),
          clampToGround: false,
          arcType: Cesium.ArcType.GEODESIC,
        },
        properties: { ...p, kind: 'pipe' },
      })
      entityMap.set(p.id, entity)
    })
  }
  render()

  return {
    dataSource: ds,
    entityMap,
    setVisible(v) {
      ds.show = v
    },
    /** 埋深放大系数（1 = 真实埋深，数值越大管线抬得越高，便于观察） */
    setDepthScale(scale) {
      depthScale = Math.max(1, Math.min(12, Number(scale) || 1))
      render()
      return depthScale
    },
    get depthScale() {
      return depthScale
    },
    /** 按管网类型过滤（water/gas/sewage），空数组表示全部显示 */
    filter(types) {
      const set = new Set(types || [])
      geojson.features.forEach((f) => {
        const e = entityMap.get(f.properties.id)
        if (e) e.show = set.size === 0 || set.has(f.properties.pipe)
      })
    },
    /** 高亮某一段管线 */
    highlight(ids, on = true) {
      const list = Array.isArray(ids) ? ids : [ids]
      list.forEach((id) => {
        const e = entityMap.get(id)
        if (!e) return
        const p = geojson.features.find((f) => f.properties.id === id)?.properties
        e.polyline.material = new Cesium.PolylineGlowMaterialProperty({
          glowPower: on ? 0.42 : 0.16,
          color: Cesium.Color.fromCssColorString(on ? HIGHLIGHT_COLOR : p?.color || '#2E86FF'),
          taperPower: 1.0,
        })
        e.polyline.width = on ? 12 : Math.max(2.5, Math.min(9, (p?.diameter || 200) / 45))
      })
    },
    get features() {
      return geojson.features
    },
  }
}

/* ========================================================================== */
/* IoT 点位                                                                     */
/* ========================================================================== */

export function loadSensors(viewer, geojson) {
  const ds = new Cesium.CustomDataSource('IoT 点位')
  viewer.dataSources.add(ds)
  const entityMap = new Map()

  geojson.features.forEach((f) => {
    const p = f.properties
    const [lon, lat] = f.geometry.coordinates
    const entity = ds.entities.add({
      id: p.id,
      name: p.name,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 2.0),
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString('#22d3ee'),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
        outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.NONE,
        disableDepthTestDistance: 500,
      },
      properties: { ...p, kind: 'sensor' },
    })
    entityMap.set(p.id, entity)
  })

  return {
    dataSource: ds,
    entityMap,
    setVisible(v) {
      ds.show = v
    },
    /** 依据实时值刷新点位颜色（normal/warning/critical） */
    updateStatus(id, status, value, unit) {
      const entity = entityMap.get(id)
      if (!entity) return
      const color =
        status === 'critical' ? '#ef4444' : status === 'warning' ? '#f59e0b' : '#22d3ee'
      entity.point.color = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(color))
      entity.point.pixelSize = new Cesium.ConstantProperty(status === 'normal' ? 9 : 13)
      entity.description = new Cesium.ConstantProperty(
        `${entity.name}<br/>实时值：${fmt.num(value, 3)} ${unit}<br/>状态：${status}`,
      )
    },
    /** 全部点位是否显示标签 */
    setLabels(show) {
      entityMap.forEach((entity) => {
        entity.label = show
          ? new Cesium.LabelGraphics({
              text: entity.name,
              font: '11px Inter, system-ui, sans-serif',
              fillColor: Cesium.Color.fromCssColorString('#1e293b'),
              showBackground: true,
              backgroundColor: Cesium.Color.WHITE.withAlpha(0.7),
              backgroundPadding: new Cesium.Cartesian2(4, 2),
              pixelOffset: new Cesium.Cartesian2(0, -18),
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              disableDepthTestDistance: 300,
            })
          : undefined
      })
    },
  }
}

/* ========================================================================== */
/* 道路 / 绿地                                                                  */
/* ========================================================================== */

export async function loadRoads(viewer, geojson) {
  const ds = await Cesium.GeoJsonDataSource.load(geojson, {
    clampToGround: true,
    stroke: Cesium.Color.fromCssColorString('#94a3b8'),
    strokeWidth: 4,
  })
  ds.name = '小区道路'
  ds.entities.values.forEach((e) => {
    if (!e.polyline) return
    const level = e.properties.level?.getValue()
    e.polyline.width = level === 'main' ? 6 : 3.5
    e.polyline.material = new Cesium.PolylineOutlineMaterialProperty({
      color: Cesium.Color.fromCssColorString(level === 'main' ? '#8f9bab' : '#aab3bd'),
      outlineWidth: 1,
      outlineColor: Cesium.Color.WHITE.withAlpha(0.5),
    })
    e.polyline.clampToGround = true
  })
  viewer.dataSources.add(ds)
  return {
    dataSource: ds,
    setVisible(v) {
      ds.show = v
    },
  }
}

export async function loadGreens(viewer, geojson) {
  const ds = await Cesium.GeoJsonDataSource.load(geojson, {
    clampToGround: true,
    fill: Cesium.Color.fromCssColorString('#86c48f').withAlpha(0.75),
    stroke: Cesium.Color.fromCssColorString('#5b9e66').withAlpha(0.8),
    strokeWidth: 1,
  })
  ds.name = '绿地广场'
  viewer.dataSources.add(ds)
  return {
    dataSource: ds,
    setVisible(v) {
      ds.show = v
    },
  }
}
