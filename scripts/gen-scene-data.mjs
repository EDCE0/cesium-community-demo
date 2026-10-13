#!/usr/bin/env node
/**
 * gen-scene-data.mjs
 * ---------------------------------------------------------------------------
 * 生成「阳光新城」示范小区的场景数据（确定性、可复现）。
 *
 * 输出目录：public/data/
 *   site.json          小区元信息（中心点、范围、图层清单）
 *   buildings.geojson  建筑轮廓白模（含 floors / height / 户数）
 *   roads.geojson      道路中心线
 *   greens.geojson     绿地 / 广场
 *   pipes.geojson      地下管线（给水/燃气/污水），含埋深、材质、管龄
 *   sensors.geojson    IoT 点位（水压/燃气浓度/液位）
 *   property.json      楼层-单元-户 台账
 *   timeseries.json    近 8 天用水/用气/用电趋势（按楼栋）
 *   alarms.json        设备告警事件
 *
 * 坐标系：WGS84（经纬度）。内部用局部 ENU 米制坐标设计，再换算为经纬度，
 * 方便与 OSM / 天地图 底图对齐（本 Demo 底图为程序化生成，见 web 端）。
 *
 * 若需真实数据，运行：node scripts/fetch-osm-overpass.mjs
 * ---------------------------------------------------------------------------
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, 'public', 'data')

// ---------------------------------------------------------------------------
// 0. 坐标工具：局部 ENU(米) <-> WGS84
// ---------------------------------------------------------------------------
const ORIGIN = { lon: 116.30200, lat: 40.05100 }

const M_PER_DEG_LAT = 111320.0
const mPerDegLon = (lat) => 111320.0 * Math.cos((lat * Math.PI) / 180)

/** 局部米制坐标 -> [lon, lat] */
function ll(x, y) {
  const lon = ORIGIN.lon + x / mPerDegLon(ORIGIN.lat)
  const lat = ORIGIN.lat + y / M_PER_DEG_LAT
  return [round(lon, 7), round(lat, 7)]
}
const round = (v, n = 6) => Number(v.toFixed(n))

/** 矩形轮廓：中心 (cx,cy)，宽 w，深 d，旋转 rot（度） */
function rect(cx, cy, w, d, rot = 0) {
  const r = (rot * Math.PI) / 180
  const hw = w / 2
  const hd = d / 2
  const corners = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]
  const pts = corners.map(([x, y]) => {
    const rx = x * Math.cos(r) - y * Math.sin(r)
    const ry = x * Math.sin(r) + y * Math.cos(r)
    return ll(cx + rx, cy + ry)
  })
  pts.push(pts[0])
  return [pts]
}

/** L 形轮廓 */
function lShape(cx, cy, w, d, notchW, notchD, rot = 0) {
  const hw = w / 2
  const hd = d / 2
  const raw = [
    [-hw, -hd],
    [hw, -hd],
    [hw, -hd + notchD],
    [hw - notchW, -hd + notchD],
    [hw - notchW, hd],
    [-hw, hd],
    [-hw, -hd],
  ]
  const r = (rot * Math.PI) / 180
  return [
    raw.map(([x, y]) => {
      const rx = x * Math.cos(r) - y * Math.sin(r)
      const ry = x * Math.sin(r) + y * Math.cos(r)
      return ll(cx + rx, cy + ry)
    }),
  ]
}

// ---------------------------------------------------------------------------
// 1. 楼栋台账（手工设计，贴近真实居住区肌理）
// ---------------------------------------------------------------------------
const FLOOR_H = 3.0 // 标准层层高（米）

/**
 * 住宅楼：6 层板楼 / 11 层小高层 / 18 层高层，混合布局
 * 每层 2~4 户，按户型面积区分
 */
const RESIDENTIAL = [
  // --- 西组团（1~6 号楼）---
  { id: 'B01', name: '1 号楼', group: '西区', cx: -170, cy: 120, w: 12, d: 44, rot: 0, floors: 6 },
  { id: 'B02', name: '2 号楼', group: '西区', cx: -170, cy: 60, w: 12, d: 44, rot: 0, floors: 6 },
  { id: 'B03', name: '3 号楼', group: '西区', cx: -170, cy: 0, w: 12, d: 44, rot: 0, floors: 6 },
  { id: 'B04', name: '4 号楼', group: '西区', cx: -170, cy: -60, w: 12, d: 44, rot: 0, floors: 6 },
  { id: 'B05', name: '5 号楼', group: '西区', cx: -170, cy: -120, w: 12, d: 44, rot: 0, floors: 6 },
  { id: 'B06', name: '6 号楼', group: '西区', cx: -105, cy: -150, w: 32, d: 13, rot: 0, floors: 11 },
  // --- 北组团（7~11 号楼）---
  { id: 'B07', name: '7 号楼', group: '北区', cx: -80, cy: 150, w: 44, d: 13, rot: 0, floors: 18 },
  { id: 'B08', name: '8 号楼', group: '北区', cx: -25, cy: 150, w: 44, d: 13, rot: 0, floors: 18 },
  { id: 'B09', name: '9 号楼', group: '北区', cx: 30, cy: 150, w: 44, d: 13, rot: 0, floors: 18 },
  { id: 'B10', name: '10 号楼', group: '北区', cx: 85, cy: 150, w: 44, d: 13, rot: 0, floors: 11 },
  { id: 'B11', name: '11 号楼', group: '北区', cx: 140, cy: 150, w: 13, d: 44, rot: 0, floors: 11 },
  // --- 南组团（12~17 号楼）---
  { id: 'B12', name: '12 号楼', group: '南区', cx: -80, cy: -160, w: 44, d: 13, rot: 0, floors: 18 },
  { id: 'B13', name: '13 号楼', group: '南区', cx: -25, cy: -160, w: 44, d: 13, rot: 0, floors: 18 },
  { id: 'B14', name: '14 号楼', group: '南区', cx: 30, cy: -160, w: 44, d: 13, rot: 0, floors: 11 },
  { id: 'B15', name: '15 号楼', group: '南区', cx: 85, cy: -160, w: 44, d: 13, rot: 0, floors: 11 },
  { id: 'B16', name: '16 号楼', group: '南区', cx: 140, cy: -150, w: 13, d: 44, rot: 0, floors: 6 },
  { id: 'B17', name: '17 号楼', group: '南区', cx: 155, cy: -80, w: 13, d: 36, rot: 0, floors: 6 },
]

/** 公共建筑 */
const PUBLIC = [
  { id: 'B_C01', name: '社区服务中心', type: 'community', cx: -40, cy: 0, shape: 'rect', w: 70, d: 42, floors: 3 },
  { id: 'B_C02', name: '阳光幼儿园', type: 'school', cx: 60, cy: 40, w: 36, d: 24, floors: 3 },
  { id: 'B_C03', name: '商业配套楼', type: 'commercial', cx: 60, cy: -30, w: 40, d: 18, floors: 2 },
  { id: 'B_C04', name: '水泵房', type: 'utility', cx: -120, cy: 20, w: 14, d: 10, floors: 1 },
  { id: 'B_C05', name: '燃气调压站', type: 'utility', cx: 10, cy: 60, w: 12, d: 10, floors: 1 },
  { id: 'B_C06', name: '10kV 配电室', type: 'utility', cx: 30, cy: 60, w: 12, d: 10, floors: 1 },
  { id: 'B_C07', name: '地下车库出入口', type: 'parking', cx: -100, cy: -60, w: 10, d: 16, floors: 1 },
]

const OWNER_TYPES = ['自住', '出租', '空置', '商户']
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡林何郭高罗'
const GIVEN = ['伟', '芳', '娜', '敏', '静', '磊', '强', '军', '洋', '勇', '艳', '杰', '涛', '明', '超', '秀英', '建国', '志强']

/** 生成某栋楼某层的户型（确定性的伪随机，保证每次生成一致） */
function makeUnits(building, floor) {
  // 每层户数：18 层塔楼 4 户，11 层 3 户，6 层板楼 2 户，公建 1 户
  let perFloor = 2
  if (building.floors >= 18) perFloor = 4
  else if (building.floors >= 11) perFloor = 3
  else if (building.type && building.type !== 'residential') perFloor = 1

  const units = []
  for (let u = 1; u <= perFloor; u++) {
    const seed = hash(`${building.id}-${floor}-${u}`)
    const area = perFloor === 1 ? 120 + (seed % 80) : [78, 89, 105, 128][(seed + u) % 4]
    const r = seed % 100
    let ownerType = '自住'
    if (r < 18) ownerType = '出租'
    else if (r < 24) ownerType = '空置'
    const occupied = ownerType !== '空置'
    units.push({
      unitId: `${building.id}-${String(floor).padStart(2, '0')}${String(u).padStart(2, '0')}`,
      unitNo: `${floor}${String(u).padStart(2, '0')}`,
      room: `${floor}0${u}`,
      floor,
      no: u,
      area,
      layout: area > 120 ? '四室两厅' : area > 100 ? '三室两厅' : area > 85 ? '两室两厅' : '两室一厅',
      ownerType,
      ownerName: occupied ? SURNAMES[seed % SURNAMES.length] + GIVEN[(seed >> 3) % GIVEN.length] : '—',
      phone: occupied ? `138****${String(1000 + (seed % 9000))}` : '—',
      occupied,
      // 近 7 天日均用量（升 / 立方米）
      waterDaily: occupied ? round(0.28 + (seed % 40) / 100, 2) : 0,
      gasDaily: occupied ? round(0.35 + (seed % 55) / 100, 2) : 0,
    })
  }
  return units
}

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h >>> 0)
}

// ---------------------------------------------------------------------------
// 2. 组装 GeoJSON
// ---------------------------------------------------------------------------
const buildings = [...RESIDENTIAL.map((b) => ({ ...b, type: 'residential', shape: 'rect' })), ...PUBLIC]

const buildingFeatures = []
const property = { site: '阳光新城', generatedAt: new Date().toISOString(),
  dataSource: 'synthetic',
  disclaimer: '程序化生成的虚构示范小区，住户、能耗与事件均为模拟数据', buildings: [] }

for (const b of buildings) {
  const height = round(b.floors * FLOOR_H, 2)
  const geometry =
    b.shape === 'l'
      ? { type: 'Polygon', coordinates: lShape(b.cx, b.cy, b.w, b.d, b.notchW, b.notchD, b.rot || 0) }
      : { type: 'Polygon', coordinates: rect(b.cx, b.cy, b.w, b.d, b.rot || 0) }

  const floors = []
  let unitTotal = 0
  for (let f = 1; f <= b.floors; f++) {
    const units = makeUnits(b, f)
    unitTotal += units.length
    floors.push({ floor: f, name: `${f} 层`, units })
  }
  const occupiedCount = floors.reduce((s, f) => s + f.units.filter((u) => u.occupied).length, 0)

  buildingFeatures.push({
    type: 'Feature',
    id: b.id,
    properties: {
      id: b.id,
      name: b.name,
      type: b.type || 'residential',
      group: b.group || '公共配套',
      floors: b.floors,
      height,
      floorHeight: FLOOR_H,
      footprintArea: round(b.w * b.d, 1),
      buildingArea: round(b.w * b.d * b.floors, 1),
      units: unitTotal,
      occupiedUnits: occupiedCount,
      occupancyRate: round(occupiedCount / Math.max(unitTotal, 1), 3),
      builtYear: 2008 + (hash(b.id) % 12),
      structure: b.floors >= 18 ? '剪力墙' : '砖混',
      hasElevator: b.floors >= 11,
      lon: ll(b.cx, b.cy)[0],
      lat: ll(b.cx, b.cy)[1],
      center: ll(b.cx, b.cy),
      // 供「楼层抽屉式展开」使用
      baseHeight: 0,
    },
    geometry,
  })

  property.buildings.push({
    id: b.id,
    name: b.name,
    type: b.type || 'residential',
    group: b.group || '公共配套',
    floors: floors.length,
    units: unitTotal,
    occupiedUnits: occupiedCount,
    occupancyRate: round(occupiedCount / Math.max(unitTotal, 1), 3),
    center: ll(b.cx, b.cy),
    height,
    floorList: floors,
  })
}

// --- 道路（中心线 + 等级）---
const ROADS = [
  { id: 'R_MAIN_1', name: '小区主环路', level: 'main', width: 7, pts: [[-205, 190], [190, 190], [215, 165], [215, -185], [190, -210], [-205, -210], [-225, -185], [-225, 165], [-205, 190]] },
  { id: 'R_MAIN_2', name: '中央景观大道', level: 'main', width: 6, pts: [[-225, 30], [215, 30]] },
  { id: 'R_SUB_1', name: '西区支路', level: 'sub', width: 4, pts: [[-140, 190], [-140, -210]] },
  { id: 'R_SUB_2', name: '东区支路', level: 'sub', width: 4, pts: [[115, 190], [115, -210]] },
  { id: 'R_SUB_3', name: '北区支路', level: 'sub', width: 4, pts: [[-205, 100], [215, 100]] },
  { id: 'R_SUB_4', name: '南区支路', level: 'sub', width: 4, pts: [[-205, -100], [215, -100]] },
]
const roadFeatures = ROADS.map((r) => ({
  type: 'Feature',
  id: r.id,
  properties: { id: r.id, name: r.name, level: r.level, width: r.width, surface: '沥青' },
  geometry: { type: 'LineString', coordinates: r.pts.map(([x, y]) => ll(x, y)) },
}))

// --- 绿地 / 广场 ---
const GREENS = [
  { id: 'G01', name: '中央景观广场', kind: 'plaza', cx: 0, cy: 0, w: 66, d: 34 },
  { id: 'G02', name: '北区绿地', kind: 'green', cx: -60, cy: 78, w: 90, d: 32 },
  { id: 'G03', name: '南区绿地', kind: 'green', cx: -60, cy: -78, w: 90, d: 32 },
  { id: 'G04', name: '东侧儿童活动区', kind: 'green', cx: 70, cy: 80, w: 60, d: 30 },
  { id: 'G05', name: '西侧健身区', kind: 'green', cx: -130, cy: 150, w: 40, d: 30 },
]
const greenFeatures = GREENS.map((g) => ({
  type: 'Feature',
  id: g.id,
  properties: { id: g.id, name: g.name, kind: g.kind },
  geometry: { type: 'Polygon', coordinates: rect(g.cx, g.cy, g.w, g.d) },
}))

// ---------------------------------------------------------------------------
// 3. 地下管线（沿主/次干道敷设，含埋深、材质、管龄、健康度）
// ---------------------------------------------------------------------------
const PIPE_COLORS = { water: '#2E86FF', gas: '#FF8C00', sewage: '#8B5A2B' }

const PIPE_SPECS = [
  // 给水主干管：沿主环路 + 中央大道
  { id: 'W-001', name: '给水主干管 DN300', pipe: 'water', d: 300, mat: '球墨铸铁', from: [-225, 165], to: [190, 165], depth: 1.8, year: 2009, pr: 0.42 },
  { id: 'W-002', name: '给水主干管 DN300', pipe: 'water', d: 300, mat: '球墨铸铁', from: [190, 165], to: [190, -185], depth: 1.8, year: 2009, pr: 0.41 },
  { id: 'W-003', name: '给水次干管 DN200', pipe: 'water', d: 200, mat: 'PE100', from: [-225, 30], to: [190, 30], depth: 1.6, year: 2016, pr: 0.38 },
  { id: 'W-004', name: '给水支管 DN150', pipe: 'water', d: 150, mat: 'PE100', from: [-140, 165], to: [-140, -185], depth: 1.4, year: 2016, pr: 0.35 },
  { id: 'W-005', name: '给水支管 DN150', pipe: 'water', d: 150, mat: 'PE100', from: [115, 165], to: [115, -185], depth: 1.4, year: 2016, pr: 0.36 },
  // 燃气：中压 + 低压庭院管
  { id: 'G-001', name: '中压燃气管 DN200', pipe: 'gas', d: 200, mat: 'PE80', from: [10, 60], to: [10, 30], depth: 1.2, year: 2012, pr: 0.28 },
  { id: 'G-002', name: '中压燃气环管 DN200', pipe: 'gas', d: 200, mat: 'PE80', from: [10, 30], to: [-140, 30], depth: 1.2, year: 2012, pr: 0.27 },
  { id: 'G-003', name: '中压燃气环管 DN200', pipe: 'gas', d: 200, mat: 'PE80', from: [10, 30], to: [115, 30], depth: 1.2, year: 2012, pr: 0.27 },
  { id: 'G-004', name: '低压庭院管 DN100', pipe: 'gas', d: 100, mat: 'PE80', from: [-140, 30], to: [-140, 120], depth: 1.0, year: 2012, pr: 0.05 },
  { id: 'G-005', name: '低压庭院管 DN100', pipe: 'gas', d: 100, mat: 'PE80', from: [-140, 30], to: [-140, -120], depth: 1.0, year: 2012, pr: 0.05 },
  { id: 'G-006', name: '低压庭院管 DN100', pipe: 'gas', d: 100, mat: 'PE80', from: [115, 30], to: [115, 120], depth: 1.0, year: 2012, pr: 0.05 },
  // 污水（雨污分流，埋深较大）
  { id: 'S-001', name: '污水干管 DN400', pipe: 'sewage', d: 400, mat: 'HDPE 双壁波纹管', from: [-225, -60], to: [190, -60], depth: 3.2, year: 2008, pr: 0.0 },
  { id: 'S-002', name: '污水干管 DN400', pipe: 'sewage', d: 400, mat: 'HDPE 双壁波纹管', from: [190, -60], to: [190, -185], depth: 3.4, year: 2008, pr: 0.0 },
]
const pipeFeatures = PIPE_SPECS.map((p) => {
  const age = 2026 - p.year
  // 管龄越老、材质越差，健康度越低（确定性）
  const matFactor = /球墨/.test(p.mat) ? 0.95 : /PE/.test(p.mat) ? 0.9 : 0.82
  const health = round(Math.max(0.35, matFactor - age * 0.012 - (hash(p.id) % 10) / 200), 2)
  const length = round(Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1]), 1)
  return {
    type: 'Feature',
    id: p.id,
    properties: {
      id: p.id,
      name: p.name,
      pipe: p.pipe,
      pipeLabel: { water: '给水', gas: '燃气', sewage: '污水' }[p.pipe],
      color: PIPE_COLORS[p.pipe],
      diameter: p.d,
      material: p.mat,
      depth: p.depth,
      builtYear: p.year,
      age,
      length,
      pressure: p.pr,
      health,
      healthLevel: health > 0.8 ? '良好' : health > 0.6 ? '关注' : '较差',
      riskLevel: health > 0.8 ? 'low' : health > 0.6 ? 'medium' : 'high',
    },
    geometry: { type: 'LineString', coordinates: [ll(...p.from), ll(...p.to)] },
  }
})

// ---------------------------------------------------------------------------
// 4. IoT 点位
// ---------------------------------------------------------------------------
const sensorFeatures = []
const pushSensor = (id, name, type, pos, extra = {}) => {
  sensorFeatures.push({
    type: 'Feature',
    id,
    properties: {
      id,
      name,
      type,
      typeLabel: { pressure: '管网压力', gas: '燃气浓度', level: '水池液位', flow: '流量计', power: '配电监测' }[type] || type,
      unit: { pressure: 'MPa', gas: '%LEL', level: 'm', flow: 'm³/h', power: 'kW' }[type] || '',
      status: 'normal',
      ...extra,
    },
    geometry: { type: 'Point', coordinates: ll(...pos) },
  })
}

// 每栋住宅楼单元入口一个水压/燃气点
for (const b of RESIDENTIAL) {
  pushSensor(`IOT-${b.id}-W`, `${b.name}给水压力`, 'pressure', [b.cx - b.w / 2 - 4, b.cy], { buildingId: b.id })
  pushSensor(`IOT-${b.id}-G`, `${b.name}燃气浓度`, 'gas', [b.cx + b.w / 2 + 4, b.cy], { buildingId: b.id })
}
pushSensor('IOT-PUMP-01', '水泵房出水压力', 'pressure', [-113, 20], { buildingId: 'B_C04', warn: 0.25, crit: 0.2 })
pushSensor('IOT-PUMP-02', '高位水箱液位', 'level', [-120, 26], { buildingId: 'B_C04', warn: 2.0, crit: 1.5 })
pushSensor('IOT-GAS-ST', '燃气调压站出口压力', 'pressure', [17, 60], { buildingId: 'B_C05', warn: 0.22, crit: 0.18 })
pushSensor('IOT-GAS-DET', '调压站可燃气体探测', 'gas', [4, 60], { buildingId: 'B_C05', warn: 10, crit: 20 })
pushSensor('IOT-PWR-01', '配电室总负荷', 'power', [36, 60], { buildingId: 'B_C06', warn: 800, crit: 950 })
pushSensor('IOT-FLOW-01', '小区总进水流量', 'flow', [-113, 14], { buildingId: 'B_C04' })
pushSensor('IOT-FLOW-02', '小区总燃气流量', 'flow', [17, 54], { buildingId: 'B_C05' })

// ---------------------------------------------------------------------------
// 5. 时间序列（近 8 天，小时粒度按天聚合）
// ---------------------------------------------------------------------------
const DAYS = 8
const today = new Date('2026-10-12T00:00:00+08:00')
const dayLabels = []
for (let i = DAYS - 1; i >= 0; i--) {
  const d = new Date(today.getTime() - i * 86400000)
  dayLabels.push(`${d.getMonth() + 1}/${d.getDate()}`)
}

const trend = { labels: dayLabels, community: { water: [], gas: [], power: [] }, byBuilding: {} }
let wBase = 42.5
let gBase = 31.2
let pBase = 1180
for (let i = 0; i < DAYS; i++) {
  const weekend = [0, 6].includes((today.getTime() / 86400000 - (DAYS - 1 - i)) % 7 | 0)
  const wobble = ((hash(`day-${i}`) % 100) / 100 - 0.5) * 4
  wBase = round(42.5 + wobble + (weekend ? 3.2 : 0) + i * 0.18, 1)
  gBase = round(31.2 + wobble * 0.8 + (weekend ? 2.4 : 0) - i * 0.12, 1)
  pBase = round(1180 + wobble * 30 + (weekend ? 90 : 0), 0)
  trend.community.water.push(wBase)
  trend.community.gas.push(gBase)
  trend.community.power.push(pBase)
}

for (const b of RESIDENTIAL) {
  const seed = hash(b.id) % 100
  const scale = b.floors >= 18 ? 1.6 : b.floors >= 11 ? 1.15 : 0.85
  trend.byBuilding[b.id] = {
    name: b.name,
    // 入住率越高、楼层越多，用量越大
    water: Array.from({ length: DAYS }, (_, i) =>
      round((0.35 * scale + seed / 900) * wBase * (0.94 + ((hash(`${b.id}${i}`) % 12) / 100)), 1),
    ),
    gas: Array.from({ length: DAYS }, (_, i) =>
      round((0.28 * scale + seed / 1100) * gBase * (0.92 + ((hash(`g${b.id}${i}`) % 14) / 100)), 1),
    ),
  }
}

// ---------------------------------------------------------------------------
// 6. 告警事件
// ---------------------------------------------------------------------------
const ALARMS = [
  { id: 'AL-20261012-01', ts: '2026-10-12 08:14:22', level: 'critical', source: 'IOT-GAS-DET', target: 'B_C05', targetName: '燃气调压站', type: 'gas', message: '可燃气体浓度 24.6 %LEL，超过报警阈值 20 %LEL', status: '处理中', handler: '张工' },
  { id: 'AL-20261011-03', ts: '2026-10-11 21:40:07', level: 'warning', source: 'IOT-B07-W', target: 'B07', targetName: '7 号楼', type: 'pressure', message: '给水压力 0.23 MPa，低于告警阈值 0.25 MPa', status: '已恢复', handler: '李工' },
  { id: 'AL-20261011-02', ts: '2026-10-11 14:02:55', level: 'info', source: 'W-002', target: 'W-002', targetName: '给水主干管 DN300', type: 'pipe', message: '管段健康度降至 0.71，建议纳入年度更换计划', status: '已归档', handler: '—' },
  { id: 'AL-20261010-05', ts: '2026-10-10 19:22:31', level: 'warning', source: 'IOT-PUMP-02', target: 'B_C04', targetName: '水泵房', type: 'level', message: '高位水箱液位 1.82 m，低于告警阈值 2.0 m', status: '已恢复', handler: '王工' },
  { id: 'AL-20261009-01', ts: '2026-10-09 09:11:03', level: 'critical', source: 'IOT-13-W', target: 'B13', targetName: '13 号楼', type: 'pressure', message: '给水压力骤降至 0.16 MPa，疑似支管泄漏', status: '已闭环', handler: '抢修一班' },
  { id: 'AL-20261008-04', ts: '2026-10-08 16:35:48', level: 'info', source: 'IOT-PWR-01', target: 'B_C06', targetName: '10kV 配电室', type: 'power', message: '总负荷 812 kW，接近预警值 800 kW', status: '已恢复', handler: '—' },
  { id: 'AL-20261007-02', ts: '2026-10-07 11:58:12', level: 'warning', source: 'IOT-GAS-DET', target: 'B_C05', targetName: '燃气调压站', type: 'gas', message: '可燃气体浓度 12.4 %LEL，超过预警阈值 10 %LEL', status: '已闭环', handler: '张工' },
]

// ---------------------------------------------------------------------------
// 7. 写出
// ---------------------------------------------------------------------------
function writeJson(file, data) {
  const p = join(OUT, file)
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
  const kb = (Buffer.byteLength(JSON.stringify(data)) / 1024).toFixed(1)
  console.log(`  ✓ ${file.padEnd(20)} ${kb.padStart(8)} KB`)
}

function bboxOf(features) {
  let w = 180, s = 90, e = -180, n = -90
  for (const f of features) {
    const walk = (c) => {
      if (typeof c[0] === 'number') {
        w = Math.min(w, c[0]); e = Math.max(e, c[0])
        s = Math.min(s, c[1]); n = Math.max(n, c[1])
      } else c.forEach(walk)
    }
    walk(f.geometry.coordinates)
  }
  return [round(w, 6), round(s, 6), round(e, 6), round(n, 6)]
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

console.log('\n▶ 生成示范小区场景数据 …\n')

const allFeatures = [...buildingFeatures, ...roadFeatures]
writeJson('buildings.geojson', { type: 'FeatureCollection', features: buildingFeatures })
writeJson('roads.geojson', { type: 'FeatureCollection', features: roadFeatures })
writeJson('greens.geojson', { type: 'FeatureCollection', features: greenFeatures })
writeJson('pipes.geojson', { type: 'FeatureCollection', features: pipeFeatures })
writeJson('sensors.geojson', { type: 'FeatureCollection', features: sensorFeatures })
writeJson('property.json', property)
writeJson('timeseries.json', trend)
writeJson('alarms.json', { site: '阳光新城', alarms: ALARMS })

const site = {
  name: '阳光新城',
  code: 'YGN-001',
  city: '北京市 · 海淀区',
  origin: ORIGIN,
  bbox: bboxOf(allFeatures),
  area: 0.21, // km²
  households: property.buildings.filter((b) => b.type === 'residential').reduce((s, b) => s + b.units, 0),
  buildings: property.buildings.length,
  residentialBuildings: property.buildings.filter((b) => b.type === 'residential').length,
  pipeLength: round(pipeFeatures.reduce((s, f) => s + f.properties.length, 0), 1),
  sensors: sensorFeatures.length,
  greenRate: 0.36,
  strataUnits: 6,
  management: '阳光新城物业管理处',
  generatedAt: new Date().toISOString(),
  dataSource: 'synthetic',
  disclaimer: '程序化生成的虚构示范小区，住户、能耗与事件均为模拟数据',
  layers: [
    { id: 'buildings', name: '建筑白模', file: 'buildings.geojson' },
    { id: 'roads', name: '小区道路', file: 'roads.geojson' },
    { id: 'greens', name: '绿地广场', file: 'greens.geojson' },
    { id: 'pipes', name: '地下管线', file: 'pipes.geojson' },
    { id: 'sensors', name: 'IoT 点位', file: 'sensors.geojson' },
  ],
}
writeJson('site.json', site)

console.log(`
  住宅楼 ${site.residentialBuildings} 栋 / 建筑 ${site.buildings} 栋 / 户数 ${site.households}
  管线 ${pipeFeatures.length} 段，总长 ${site.pipeLength} m，IoT 点位 ${sensorFeatures.length} 个
  输出目录：public/data/
`)
