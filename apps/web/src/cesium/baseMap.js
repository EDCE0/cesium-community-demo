/**
 * 程序化底图与场地
 * ---------------------------------------------------------------------------
 * Demo 不依赖任何在线瓦片服务（天地图 / OSM / Cesium Ion 均不需要 Key），
 * 用「城市底纹 + 小区地面 + 周边街区」程序化生成一层本地底图：
 *   1) 场外底纹：大范围浅灰地面 + 细网格，模拟城市肌理（可关闭）
 *   2) 场内地坪：小区用地范围多边形
 *   3) 周边街区：小区外围示意建筑，提供空间上下文
 * 需要真实影像时，可通过 Agent 命令 `loadImageryService` / `setBasemap`
 * 挂载天地图或 OSM 的 XYZ/WMTS 服务，见 README。
 * ---------------------------------------------------------------------------
 */
import * as Cesium from 'cesium'
import { DEG2RAD } from '../lib/util.js'

const ELLIPSOID = Cesium.Ellipsoid.WGS84

/** 经纬度 + 高度(米) -> Cartesian3 */
export function toCarto(lon, lat, height = 0) {
  return Cesium.Cartesian3.fromDegrees(lon, lat, height)
}

/** 以中心点做局部米制偏移 -> Cartesian3（用于画规则几何体） */
export function offsetCarto(lon, lat, dx, dy, height = 0) {
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos(lat * DEG2RAD)
  return toCarto(lon + dx / mPerDegLon, lat + dy / mPerDegLat, height)
}

/** 用地范围（矩形，米制相对中心） */
export function siteRectangle(center, halfW = 260, halfD = 245, height = 0) {
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos(center.lat * DEG2RAD)
  const west = center.lon - halfW / mPerDegLon
  const east = center.lon + halfW / mPerDegLon
  const south = center.lat - halfD / mPerDegLat
  const north = center.lat + halfD / mPerDegLat
  return Cesium.Rectangle.fromDegrees(west, south, east, north, height)
}

/**
 * 生成"市区底纹"：用地范围外的浅色地面 + 街道网格
 * 目的只是让地球不是一片虚空，同时暗示城市路网。
 */
export function buildCityContext(center, opts = {}) {
  const { span = 2600, grid = 260, depth = 0.6 } = opts
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos(center.lat * DEG2RAD)

  const half = span / 2
  // 大面积地面：用规范的四顶点矩形环（抬高 depth 米以覆盖椭球表面）
  // ⚠️ 不要用「两个三角形」的 6 顶点数组当多边形：PolygonGeometry 内部会按
  //    earcut 三角化后的边表索引读顶点，非法环会读到 undefined 并抛
  //    "left is required"（Cartesian3.equalsEpsilon）。
  const c = (dx, dy) => offsetCarto(center.lon, center.lat, dx, dy, depth)
  const ground = new Cesium.GeometryInstance({
    geometry: new Cesium.PolygonGeometry({
      polygonHierarchy: new Cesium.PolygonHierarchy([c(-half, -half), c(half, -half), c(half, half), c(-half, half)]),
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
    }),
    attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#e8ecef')) },
  })

  // 街道网格线
  const lines = []
  for (let g = -half; g <= half; g += grid) {
    lines.push({ from: c(g, -half), to: c(g, half), w: g % (grid * 2) === 0 ? 7 : 3 })
    lines.push({ from: c(-half, g), to: c(half, g), w: g % (grid * 2) === 0 ? 7 : 3 })
  }
  const lineInstances = lines.map(({ from, to, w }) => {
    // ⚠️ PolylineGeometry 的 positions 必须是 Cartesian3 数组；
    //    传扁平数字数组（push(v.x, v.y, v.z)）会在 createGeometry 里抛
    //    "left is required"（Cartesian3.equalsEpsilon 收到 undefined）。
    const positions = []
    for (let i = 0; i <= 24; i++) {
      positions.push(Cesium.Cartesian3.lerp(from, to, i / 24, new Cesium.Cartesian3()))
    }
    return new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({ positions, width: w, vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT }),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#d5dade')) },
    })
  })

  return { ground, lineInstances, mPerDegLat, mPerDegLon }
}

/** 周边街区示意建筑（低矮、灰色、不参与交互） */
export function buildNeighborBlocks(center, site, opts = {}) {
  const instances = []
  const { mPerDegLon, mPerDegLat } = site
  // 用地范围：±300 m 之外开始布置，形成"围合感"
  const rings = [
    { r: 360, count: 14, w: 34, d: 22, h: 24 },
    { r: 470, count: 18, w: 40, d: 26, h: 34 },
    { r: 600, count: 22, w: 46, d: 30, h: 46 },
  ]
  rings.forEach((ring, ri) => {
    for (let i = 0; i < ring.count; i++) {
      const ang = (i / ring.count) * Math.PI * 2 + ri * 0.4
      const cx = Math.cos(ang) * ring.r
      const cy = Math.sin(ang) * ring.r * 0.85
      const h = ring.h * (0.7 + ((i * 37) % 60) / 100)
      const west = center.lon + (cx - ring.w / 2) / mPerDegLon
      const south = center.lat + (cy - ring.d / 2) / mPerDegLat
      const east = center.lon + (cx + ring.w / 2) / mPerDegLon
      const north = center.lat + (cy + ring.d / 2) / mPerDegLat
      // 用矩形的四个角构造轮廓（PolygonGeometry 既不支持 rectangle 参数，1.139 也没了 fromRectangle）
      const hierarchy = new Cesium.PolygonHierarchy([
        Cesium.Cartesian3.fromDegrees(west, south),
        Cesium.Cartesian3.fromDegrees(east, south),
        Cesium.Cartesian3.fromDegrees(east, north),
        Cesium.Cartesian3.fromDegrees(west, north),
      ])
      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: hierarchy,
            height: 0.6,
            extrudedHeight: h,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(ri === 0 ? '#c8ced4' : ri === 1 ? '#bcc4cb' : '#b1bac2').withAlpha(0.92),
            ),
          },
          id: { kind: 'context-building' },
        }),
      )
    }
  })
  return instances
}

/**
 * 一次性构建底图 Primitive 集合并加入场景
 * @returns {{ primitives: Cesium.Primitive[], setVisible: (v:boolean)=>void }}
 */
export function addBaseMap(viewer, center, site) {
  const ctx = buildCityContext(center)
  const blocks = buildNeighborBlocks(center, site)

  const groundPrimitive = viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: [ctx.ground],
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: false }),
      allowPicking: false,
      asynchronous: false,
    }),
  )
  const gridPrimitive = viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: ctx.lineInstances,
      appearance: new Cesium.PolylineColorAppearance(),
      allowPicking: false,
      asynchronous: false,
    }),
  )
  const blockPrimitive = viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: blocks,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
      allowPicking: true,
      asynchronous: false,
    }),
  )

  return {
    primitives: [groundPrimitive, gridPrimitive, blockPrimitive],
    setVisible(v) {
      groundPrimitive.show = v
      gridPrimitive.show = v
      blockPrimitive.show = v
    },
  }
}

/** 小区地坪：用地范围 + 铺装质感（略深的灰色面） */
export function addSiteGround(viewer, site, center) {
  const halfW = 300
  const halfD = 265
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos(center.lat * DEG2RAD)
  const c = (dx, dy) => offsetCarto(center.lon, center.lat, dx, dy, 0.8)
  // 规范四顶点矩形环（原因同上，不能用三角扇）
  const p = [c(-halfW, -halfD), c(halfW, -halfD), c(halfW, halfD), c(-halfW, halfD)]

  return viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: [
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(p),
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#d9dde1')) },
        }),
      ],
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true }),
      allowPicking: false,
      asynchronous: false,
    }),
  )
}
