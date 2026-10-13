/** Locally generated architectural details. No remote model or imagery credentials. */
import * as C from 'cesium'
export function addCommunityDetails(viewer, data) {
  const ds = new C.CustomDataSource('建筑立面与景观')
  viewer.dataSources.add(ds)
  const windows = []
  const material = C.Color.fromCssColorString('#435e6b')
  const point = (lon, lat, z) => C.Cartesian3.fromDegrees(lon, lat, z)
  for (const feature of data.buildings.features) {
    const p = feature.properties
    const ring = feature.geometry.coordinates[0]
    for (let edge = 0; edge < ring.length - 1; edge++) {
      const a = ring[edge], b = ring[edge + 1]
      const length = C.Cartesian3.distance(point(...a, 0), point(...b, 0))
      const count = Math.max(1, Math.floor(length / 5))
      for (let floor = 0; floor < p.floors; floor++) {
        for (let col = 0; col < count; col++) {
          const left = (col + .28) / count, right = (col + .72) / count
          const at = (t, z) => point(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z)
          const low = floor * 3 + .9, high = floor * 3 + 2.2
          // Tiny outward displacement avoids coplanar flicker on the building facade.
          const dx = b[0] - a[0], dy = b[1] - a[1], norm = Math.hypot(dx, dy)
          const positions = [at(left,low),at(right,low),at(right,high),at(left,high)].map(pos => {
            const cart = C.Cartographic.fromCartesian(pos)
            cart.longitude += C.Math.toRadians(dy / norm * .0000004)
            cart.latitude -= C.Math.toRadians(dx / norm * .0000004)
            return C.Cartesian3.fromRadians(cart.longitude, cart.latitude, cart.height)
          })
          windows.push(new C.GeometryInstance({ geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(positions), perPositionHeight: true, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(material) } }))
        }
      }
    }
  }
  const facade = viewer.scene.primitives.add(new C.Primitive({ geometryInstances: windows, appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: false, closed: false }), allowPicking: false }))
  const { lon, lat } = data.site.origin
  const mx = 111320 * Math.cos(lat * Math.PI / 180)
  const at = (x,y,z) => point(lon+x/mx,lat+y/111320,z)
  for(let i=0;i<76;i++) {
    const side=i%4, along=-205+Math.floor(i/4)*22
    const x=side<2?along:side===2?-235:235
    const y=side===0?220:side===1?-235:along
    const h=5+(i%4)*.6
    ds.entities.add({ position:at(x,y,h/2), cylinder:{length:h,topRadius:.3,bottomRadius:.4,material:C.Color.fromCssColorString('#6c5844')} })
    ds.entities.add({position:at(x,y,h+1.3),ellipsoid:{radii:new C.Cartesian3(3.7,3.7,4.3),material:C.Color.fromCssColorString(i%3?'#4c7255':'#648457')}})
  }
  for(let i=0;i<26;i++) {
    const x=-185+i*13
    ds.entities.add({polyline:{positions:[at(x,-220,1),at(x,-230,1),at(x+6,-230,1)],width:1,material:C.Color.WHITE.withAlpha(.65)}})
    if(i%3!==0) ds.entities.add({position:at(x+3,-225,1.7),box:{dimensions:new C.Cartesian3(2,4.6,1.5),material:C.Color.fromCssColorString(['#dce1e5','#405463','#8b4c43'][i%3])}})
  }
  return { setVisible(value) {ds.show=value;facade.show=value}, setBuildingsVisible(value) {facade.show=value} }
}
