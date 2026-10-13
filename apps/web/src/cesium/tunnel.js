/**
 * 地下隧道模式（三维剖切）
 * ---------------------------------------------------------------------------
 * 目标：一键把小区"翻到地下"，直观看到埋深 1~3.4 m 的给水/燃气/污水管线。
 *
 * 实现要点（经典 Cesium 剖切套路）：
 *   1) 用一个 2.5 km 半径的白色凹面半球罩住场景，只渲染内表面
 *      → 剖切后看起来就是一条"白色隧道"；
 *   2) 在场景中心建一个白色地坪圆盘（z≈0.6 m），作为隧道的地板；
 *   3) 用一个"朝向相机"的水平 ClippingPlane 把靠近观察者的一半剪掉，
 *      每帧根据相机方位角更新法向；
 *   4) 场景背景切成与隧道一致的浅灰蓝，地球与天空盒隐藏。
 *
 * 关闭隧道后解除剪裁、恢复地球/天空盒，回到地表视角。
 * ---------------------------------------------------------------------------
 */
import * as Cesium from 'cesium'

const TUNNEL_RADIUS = 2500.0
const SPLIT_OFFSET = 25.0 // 剪裁面沿法向外扩（米），避免把地面切出毛边

export function createTunnelController(viewer) {
  let shell = null
  let disc = null
  let active = false

  function build(center) {
    const scene = viewer.scene
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 0),
    )

    // 1) 隧道壳：凹面半球，剔除正面后只剩内表面
    shell = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.EllipsoidGeometry({
          radii: new Cesium.Cartesian3(TUNNEL_RADIUS, TUNNEL_RADIUS, TUNNEL_RADIUS),
          innerRadii: new Cesium.Cartesian3(TUNNEL_RADIUS - 2.0, TUNNEL_RADIUS - 2.0, TUNNEL_RADIUS - 2.0),
          minimumCone: Cesium.Math.toRadians(88.0),
          maximumCone: Cesium.Math.toRadians(180.0),
          vertexFormat: Cesium.VertexFormat.POSITION_AND_NORMAL,
        }),
      }),
      appearance: new Cesium.MaterialAppearance({
        translucent: true,
        closed: false,
        material: Cesium.Material.fromType('Color', {
          color: Cesium.Color.fromCssColorString('#eef3f7'),
        }),
        renderState: {
          culling: { enabled: true },
          depthTest: { enabled: false },
          depthMask: false,
        },
      }),
      asynchronous: false,
      allowPicking: false,
      modelMatrix: enu,
    })

    // 2) 隧道地板
    disc = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.CircleGeometry({
          center: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 0),
          radius: 2200.0,
          vertexFormat: Cesium.VertexFormat.POSITION_AND_NORMAL,
        }),
      }),
      appearance: new Cesium.MaterialAppearance({
        translucent: true,
        closed: false,
        material: Cesium.Material.fromType('Color', {
          color: Cesium.Color.fromCssColorString('#f7fafc'),
        }),
        renderState: {
          depthTest: { enabled: false },
          depthMask: false,
        },
      }),
      asynchronous: false,
      allowPicking: false,
    })

    scene.primitives.add(shell)
    scene.primitives.add(disc)
  }

  const enuScratch = new Cesium.Matrix4()
  const inverseScratch = new Cesium.Matrix4()
  const camLocal = new Cesium.Cartesian3()
  const normalScratch = new Cesium.Cartesian3()
  const centerScratch = new Cesium.Cartesian3()

  return {
    get active() {
      return active
    },

    setEnabled(enabled, center) {
      const scene = viewer.scene
      active = !!enabled

      if (active) {
        if (!shell) build(center)
        shell.show = true
        disc.show = true

        scene.globe.show = false
        if (scene.skyBox) scene.skyBox.show = false
        if (scene.sun) scene.sun.show = false
        scene.backgroundColor = Cesium.Color.fromCssColorString('#eef3f7')

        if (!scene.clippingPlanes) {
          scene.clippingPlanes = new Cesium.ClippingPlaneCollection({
            planes: [new Cesium.ClippingPlane(Cesium.Cartesian3.UNIT_X, 0.0)],
            edgeWidth: 1.0,
            edgeColor: Cesium.Color.fromCssColorString('#8fa3b8').withAlpha(0.5),
            enabled: true,
          })
        }
        scene.clippingPlanes.enabled = true
      } else {
        if (shell) shell.show = false
        if (disc) disc.show = false
        scene.globe.show = true
        if (scene.skyBox) scene.skyBox.show = true
        if (scene.sun) scene.sun.show = true
        scene.backgroundColor = Cesium.Color.fromCssColorString('#0b1220')
        if (scene.clippingPlanes) scene.clippingPlanes.enabled = false
      }
      scene.requestRender()
      return active
    },

    /**
     * 每帧更新剪裁面：法向取"场景中心 → 相机"的水平分量，
     * 于是靠近观察者的一半被切掉，露出地下管线。
     */
    update(center) {
      if (!active || !center) return
      const scene = viewer.scene
      const centerCart = Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 0, undefined, centerScratch)
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(centerCart, Cesium.Ellipsoid.WGS84, enuScratch)
      Cesium.Matrix4.inverseTransformation(enu, inverseScratch)
      Cesium.Matrix4.multiplyByPoint(inverseScratch, scene.camera.positionWC, camLocal)

      const az = Math.atan2(camLocal.y, camLocal.x)
      const horizontal = Cesium.Cartesian3.normalize(
        new Cesium.Cartesian3(Math.cos(az), Math.sin(az), 0.0),
        normalScratch,
      )
      Cesium.Matrix4.multiplyByPointAsVector(enu, horizontal, horizontal)
      Cesium.Cartesian3.normalize(horizontal, horizontal)

      const dist = Cesium.Cartesian3.dot(horizontal, centerCart)
      // 注意：1.139 里 ClippingPlaneCollection 没有公开的 .planes 访问器，取面要用 get(i)
      const plane = scene.clippingPlanes.get(0)
      if (!plane) return
      Cesium.Cartesian3.clone(horizontal, plane.normal)
      plane.distance = -dist + SPLIT_OFFSET
    },
  }
}
