#!/usr/bin/env node
/**
 * Cesium API 静态校验（Node 侧，不需要浏览器）
 * ---------------------------------------------------------------------------
 * 检查两类问题：
 *   1) 版本漂移导致的 API 改名/移除（例如 1.139 移除了 PolygonGeometry.fromRectangle、
 *      BoxGeometry.fromRectangle）——浏览器里只表现为运行时崩溃，提前查能省下大量试错；
 *   2) 关键几何构造是否可用（用真实参数构造一次）。
 * 依赖 DOM 的类（Material/Primitive/Viewer 等）只做存在性检查，
 * 真实渲染验证交给 scripts/browser-check.mjs。
 *
 * 用法：node scripts/verify-cesium-api.mjs
 * ---------------------------------------------------------------------------
 */
import * as Cesium from 'cesium'

/** [标签, 取值, 是否只做存在性检查] —— 构造函数不做无参实例化，避免假阳性 */
const CHECKS = [
  // ---------- core ----------
  ['Ellipsoid.WGS84', Cesium.Ellipsoid?.WGS84],
  ['Cartesian3.fromDegrees', Cesium.Cartesian3?.fromDegrees, 'fn'],
  ['Cartesian3.fromDegreesArray', Cesium.Cartesian3?.fromDegreesArray, 'fn'],
  ['Cartesian3.fromDegreesArrayHeights', Cesium.Cartesian3?.fromDegreesArrayHeights, 'fn'],
  ['Cartesian3.lerp', Cesium.Cartesian3?.lerp, 'fn'],
  ['Cartesian3.normalize', Cesium.Cartesian3?.normalize, 'fn'],
  ['Cartesian3.subtract', Cesium.Cartesian3?.subtract, 'fn'],
  ['Cartesian3.dot', Cesium.Cartesian3?.dot, 'fn'],
  ['Cartesian3.clone', Cesium.Cartesian3?.clone, 'fn'],
  ['Cartesian3.UNIT_X', Cesium.Cartesian3?.UNIT_X],
  ['Matrix4.IDENTITY', Cesium.Matrix4?.IDENTITY],
  ['Matrix4.inverseTransformation', Cesium.Matrix4?.inverseTransformation, 'fn'],
  ['Matrix4.multiplyByPoint', Cesium.Matrix4?.multiplyByPoint, 'fn'],
  ['Matrix4.multiplyByPointAsVector', Cesium.Matrix4?.multiplyByPointAsVector, 'fn'],
  ['Transforms.eastNorthUpToFixedFrame', Cesium.Transforms?.eastNorthUpToFixedFrame, 'fn'],
  ['Cartographic.fromDegrees', Cesium.Cartographic?.fromDegrees, 'fn'],
  ['Cartographic.fromCartesian', Cesium.Cartographic?.fromCartesian, 'fn'],
  ['Rectangle.fromDegrees', Cesium.Rectangle?.fromDegrees, 'fn'],
  ['Math.toRadians', Cesium.Math?.toRadians, 'fn'],
  ['Math.toDegrees', Cesium.Math?.toDegrees, 'fn'],
  ['JulianDate.now', Cesium.JulianDate?.now, 'fn'],
  ['Color.fromCssColorString', Cesium.Color?.fromCssColorString, 'fn'],
  ['BoundingSphere.fromPoints', Cesium.BoundingSphere?.fromPoints, 'fn'],
  ['IntersectionTests.raySphere', Cesium.IntersectionTests?.raySphere, 'fn'],
  ['IntersectionTests.rayPlane', Cesium.IntersectionTests?.rayPlane, 'fn'],
  ['Plane.fromPointNormal', Cesium.Plane?.fromPointNormal, 'fn'],
  ['Ray.getPoint', Cesium.Ray?.getPoint, 'fn'],
  ['HeightReference.RELATIVE_TO_GROUND', Cesium.HeightReference?.RELATIVE_TO_GROUND],
  ['ArcType.GEODESIC', Cesium.ArcType?.GEODESIC],
  ['HorizontalOrigin.CENTER', Cesium.HorizontalOrigin?.CENTER],
  ['VerticalOrigin.CENTER', Cesium.VerticalOrigin?.CENTER],
  ['VerticalOrigin.BOTTOM', Cesium.VerticalOrigin?.BOTTOM],
  ['ScreenSpaceEventType.LEFT_CLICK', Cesium.ScreenSpaceEventType?.LEFT_CLICK],
  ['ScreenSpaceEventType.MOUSE_MOVE', Cesium.ScreenSpaceEventType?.MOUSE_MOVE],

  // ---------- 构造类（只存在性检查）----------
  ['PolygonHierarchy', Cesium.PolygonHierarchy, 'exists'],
  ['CircleGeometry', Cesium.CircleGeometry, 'exists'],
  ['EllipsoidGeometry', Cesium.EllipsoidGeometry, 'exists'],
  ['PolylineGeometry', Cesium.PolylineGeometry, 'exists'],
  ['GeometryInstance', Cesium.GeometryInstance, 'exists'],
  ['Primitive', Cesium.Primitive, 'exists'],
  ['Viewer', Cesium.Viewer, 'exists'],
  ['ScreenSpaceEventHandler', Cesium.ScreenSpaceEventHandler, 'exists'],
  ['GeoJsonDataSource', Cesium.GeoJsonDataSource, 'exists'],
  ['CustomDataSource', Cesium.CustomDataSource, 'exists'],
  ['ClippingPlane', Cesium.ClippingPlane, 'exists'],
  ['ClippingPlaneCollection', Cesium.ClippingPlaneCollection, 'exists'],
  ['MaterialAppearance', Cesium.MaterialAppearance, 'exists'],
  ['PerInstanceColorAppearance', Cesium.PerInstanceColorAppearance, 'exists'],
  ['PolylineColorAppearance', Cesium.PolylineColorAppearance, 'exists'],
  ['ColorMaterialProperty', Cesium.ColorMaterialProperty, 'exists'],
  ['ConstantProperty', Cesium.ConstantProperty, 'exists'],
  ['CallbackProperty', Cesium.CallbackProperty, 'exists'],
  ['PolylineGlowMaterialProperty', Cesium.PolylineGlowMaterialProperty, 'exists'],
  ['PolylineOutlineMaterialProperty', Cesium.PolylineOutlineMaterialProperty, 'exists'],
  ['LabelGraphics', Cesium.LabelGraphics, 'exists'],
  ['SkyBox', Cesium.SkyBox, 'exists'],
  ['Sun', Cesium.Sun, 'exists'],
  ['Material', Cesium.Material, 'exists'],
  ['ColorGeometryInstanceAttribute', Cesium.ColorGeometryInstanceAttribute, 'exists'],
  ['SceneTransforms.worldToWindowCoordinates', Cesium.SceneTransforms?.worldToWindowCoordinates, 'fn'],
  ['GeoJsonDataSource.load', Cesium.GeoJsonDataSource?.load, 'fn'],
  ['ColorGeometryInstanceAttribute.fromColor', Cesium.ColorGeometryInstanceAttribute?.fromColor, 'fn'],
  ['PerInstanceColorAppearance.VERTEX_FORMAT', Cesium.PerInstanceColorAppearance?.VERTEX_FORMAT],
  ['PolylineColorAppearance.VERTEX_FORMAT', Cesium.PolylineColorAppearance?.VERTEX_FORMAT],

  // ---------- 行为测试：真实构造一次 ----------
  [
    'PolygonGeometry + 矩形轮廓 + 挤出高度（周边街区体块）',
    () => {
      const w = 116.3, s = 40.05, e = 116.301, n = 40.051
      const h = new Cesium.PolygonHierarchy([
        Cesium.Cartesian3.fromDegrees(w, s),
        Cesium.Cartesian3.fromDegrees(e, s),
        Cesium.Cartesian3.fromDegrees(e, n),
        Cesium.Cartesian3.fromDegrees(w, n),
      ])
      const g = new Cesium.PolygonGeometry({
        polygonHierarchy: h,
        height: 0.6,
        extrudedHeight: 20,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      })
      return !!g
    },
  ],
  [
    'CircleGeometry（隧道地坪）',
    () =>
      !!new Cesium.CircleGeometry({
        center: Cesium.Cartesian3.fromDegrees(116.3, 40.05),
        radius: 2000,
        vertexFormat: Cesium.MaterialAppearance.VERTEX_FORMAT,
      }),
  ],
  [
    'EllipsoidGeometry（隧道壳半球）',
    () =>
      !!new Cesium.EllipsoidGeometry({
        radii: new Cesium.Cartesian3(2500, 2500, 2500),
        innerRadii: new Cesium.Cartesian3(2499, 2499, 2499),
        minimumCone: Cesium.Math.toRadians(88),
        maximumCone: Cesium.Math.toRadians(180),
        vertexFormat: Cesium.MaterialAppearance.VERTEX_FORMAT,
      }),
  ],
  [
    'ClippingPlaneCollection + planes.get（隧道剪裁面）',
    () => {
      const c = new Cesium.ClippingPlaneCollection({
        planes: [new Cesium.ClippingPlane(Cesium.Cartesian3.UNIT_X, 0)],
      })
      // 1.139：只能用 get(i) / length，没有公开的 .planes
      return typeof c.get === 'function' && c.length === 1 && c.get(0) instanceof Cesium.ClippingPlane
    },
  ],
  [
    'Transforms.eastNorthUpToFixedFrame（局部坐标）',
    () => {
      const m = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(116.3, 40.05))
      return !!m && typeof Cesium.Matrix4.inverseTransformation(m, new Cesium.Matrix4()) === 'object'
    },
  ],
  [
    'PolylineGeometry（道路网格线）',
    () =>
      !!new Cesium.PolylineGeometry({
        positions: [Cesium.Cartesian3.fromDegrees(116.3, 40.05), Cesium.Cartesian3.fromDegrees(116.301, 40.051)],
        width: 4,
        vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
      }),
  ],

  ['VertexFormat.POSITION_AND_NORMAL（隧道几何）', Cesium.VertexFormat?.POSITION_AND_NORMAL],
  ['VertexFormat.POSITION_ONLY（地坪几何）', Cesium.VertexFormat?.POSITION_ONLY],

  // ---------- 反向断言：确认这些 API 确实不存在（项目里不能再用）----------
  ['断言：BoxGeometry.fromRectangle 不存在（1.139 已移除）', () => Cesium.BoxGeometry?.fromRectangle === undefined],
  ['断言：PolygonGeometry.fromRectangle 不存在（1.139 已移除）', () => Cesium.PolygonGeometry?.fromRectangle === undefined],
  ['断言：MaterialAppearance.VERTEX_FORMAT 不存在（1.139 已移除，改用 VertexFormat）', () => Cesium.MaterialAppearance?.VERTEX_FORMAT === undefined],
  ['断言：ClippingPlaneCollection.planes 访问器不存在（改用 get(i)）', () => {
    const c = new Cesium.ClippingPlaneCollection({ planes: [new Cesium.ClippingPlane(Cesium.Cartesian3.UNIT_X, 0)] })
    return c.planes === undefined && typeof c.get === 'function'
  }],
  ['断言：PolygonGeometry 不接受 rectangle 参数', () => {
    try {
      new Cesium.PolygonGeometry({ rectangle: Cesium.Rectangle.fromDegrees(116.3, 40.05, 116.31, 40.051) })
      return false // 竟然成功了，说明可以直接用
    } catch {
      return true
    }
  }],
]

const results = CHECKS.map(([label, value, mode]) => {
  let ok = false
  let note = ''
  try {
    if (mode === 'exists' || mode === 'fn') ok = typeof value === 'function'
    else if (typeof value === 'function') ok = !!value()
    else ok = value !== undefined && value !== null
  } catch (e) {
    ok = false
    note = e.message
  }
  return { label, ok, note }
})

const failed = results.filter((r) => !r.ok)
const width = Math.max(...results.map((r) => r.label.length))

console.log(`\n▶ Cesium API 校验（Cesium ${Cesium.VERSION || '1.139.0'}，共 ${results.length} 项）\n`)
failed.forEach((r) => console.log(`  ✗ ${r.label.padEnd(width)} ${r.note}`))
console.log(`\n  通过 ${results.length - failed.length} / ${results.length}`)

if (failed.length) {
  console.log(`\n✗ 有 ${failed.length} 项不可用，请按上面的名字调整代码\n`)
  process.exit(1)
}
console.log('\n✔ 全部通过（依赖 DOM 的类仅做存在性检查，渲染验证见 browser-check）\n')
