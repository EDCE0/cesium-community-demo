/**
 * 服务端数据装载：把 public/data 下的场景数据读进内存
 * 说明：统计口径复用 shared/stats.mjs —— 与前端图表完全同源，
 * 避免"地图上看到的"和"Agent 查到的"对不上。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.mjs'

function readJson(file) {
  const p = join(config.paths.data, file)
  if (!existsSync(p)) throw new Error(`缺少数据文件 ${file}，请先执行：npm run data:build`)
  return JSON.parse(readFileSync(p, 'utf8'))
}

export function loadSceneData() {
  const site = readJson('site.json')
  const buildings = readJson('buildings.geojson')
  const roads = readJson('roads.geojson')
  const greens = readJson('greens.geojson')
  const pipes = readJson('pipes.geojson')
  const sensors = readJson('sensors.geojson')
  const timeseries = readJson('timeseries.json')
  const alarms = readJson('alarms.json')
  const property = readJson('property.json')

  const index = new Map()
  property.buildings.forEach((b) => {
    index.set(b.id, b)
    index.set(b.name.replace(/\s+/g, ''), b)
  })

  return {
    site,
    buildings,
    roads,
    greens,
    pipes,
    sensors,
    timeseries,
    alarms,
    property,
    index: { buildings: index },
    /** completeStats() 需要的形状（与前端 store 保持一致） */
    statsInput: {
      property,
      timeseries,
      pipes,
      alarms,
    },
  }
}

/** 楼栋名/编号归一化 */
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

export function normalizeBuilding(input) {
  if (!input) return null
  return String(input)
    .trim()
    .replace(/\s+/g, '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/号楼|栋|幢|楼/g, '')
    .replace(/[一二三四五六七八九十]/g, (c) => String(CN_NUM[c] ?? c))
    .toUpperCase()
}

export function resolveBuildingId(data, input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (data.index.buildings.has(raw.toUpperCase())) return raw.toUpperCase()
  const norm = normalizeBuilding(raw)
  const num = Number(norm)
  if (Number.isFinite(num)) {
    const id = `B${String(num).padStart(2, '0')}`
    if (data.index.buildings.has(id)) return id
  }
  for (const [id, b] of data.index.buildings) {
    if (b.name && (b.name.replace(/\s+/g, '').includes(norm) || norm.includes(String(b.name).replace(/[^\d]/g, '')))) return id
  }
  return null
}
