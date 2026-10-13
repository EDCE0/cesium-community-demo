/**
 * IoT 实时数据模拟器
 * ---------------------------------------------------------------------------
 * 用确定性漂移 + 周期性波动模拟真实传感器读数（2 s 一个采样周期），
 * 支持注入人为故障（燃气泄漏 / 供水压力骤降 / 配电过载），用于演示
 * "实时监测 → 越限告警 → Agent 联动处置"的闭环。
 *
 * 工程化替换点：把 tick() 里的读数换成 WebSocket / MQTT / Kafka 真实数据源即可，
 * 其余告警判定与 UI 联动逻辑无需改动。
 * ---------------------------------------------------------------------------
 */
import { hexToRgba, seeded } from './util.js'

/** 每类传感器的正常区间与告警阈值 */
export const SENSOR_PROFILES = {
  pressure: { base: 0.40, amp: 0.03, unit: 'MPa', warn: 0.28, crit: 0.22, dir: 'below', label: '管网压力' },
  gas: { base: 2.6, amp: 1.4, unit: '%LEL', warn: 10, crit: 20, dir: 'above', label: '燃气浓度' },
  level: { base: 2.6, amp: 0.18, unit: 'm', warn: 2.0, crit: 1.6, dir: 'below', label: '水池液位' },
  flow: { base: 68, amp: 12, unit: 'm³/h', warn: 110, crit: 125, dir: 'above', label: '瞬时流量' },
  power: { base: 680, amp: 55, unit: 'kW', warn: 800, crit: 950, dir: 'above', label: '有功负荷' },
}

const FAULTS = {
  gasLeak: { type: 'gas', label: '燃气泄漏', minutes: 2 },
  waterDrop: { type: 'pressure', label: '供水压力骤降', minutes: 2 },
  powerOverload: { type: 'power', label: '配电过载', minutes: 2 },
}

export function createIotSimulator(sensorsGeoJSON) {
  const sensors = sensorsGeoJSON.features.map((f) => ({ ...f.properties }))
  const readings = new Map()
  const rand = seeded(20261012)
  let timer = null
  let tickCount = 0
  const startAt = Date.now()
  const overrides = new Map() // sensorId -> { until, value }
  const listeners = new Set()

  function profileOf(sensor) {
    const p = SENSOR_PROFILES[sensor.type] || SENSOR_PROFILES.pressure
    // 个别测点有自己的阈值（如调压站出口压力、配电室负荷）
    return {
      ...p,
      warn: sensor.warn ?? p.warn,
      crit: sensor.crit ?? p.crit,
    }
  }

  function sample(sensor, now) {
    const p = profileOf(sensor)
    const override = overrides.get(sensor.id)
    if (override && override.until > now) return override.value
    if (override) overrides.delete(sensor.id)

    const t = (now - startAt) / 1000
    // 多周期叠加：慢漂移 + 快波动 + 少量随机
    const slow = Math.sin(t / 240 + rand() * 0.01) * p.amp
    const fast = Math.sin(t / 17 + sensor.id.length) * p.amp * 0.35
    const noise = (rand() - 0.5) * p.amp * 0.3
    let v = p.base + slow + fast + noise
    if (sensor.type === 'flow') v = p.base + slow * 2 + noise * 3
    if (sensor.type === 'power') v = p.base + slow * 3 + fast * 2
    return Number(Math.max(0, v).toFixed(3))
  }

  function statusOf(value, p) {
    if (p.dir === 'below') return value <= p.crit ? 'critical' : value <= p.warn ? 'warning' : 'normal'
    return value >= p.crit ? 'critical' : value >= p.warn ? 'warning' : 'normal'
  }

  function tick() {
    const now = Date.now()
    tickCount++
    const changed = []
    sensors.forEach((s) => {
      const p = profileOf(s)
      const value = sample(s, now)
      const prev = readings.get(s.id)
      const status = statusOf(value, p)
      const row = {
        id: s.id,
        name: s.name,
        type: s.type,
        typeLabel: s.typeLabel,
        buildingId: s.buildingId || null,
        unit: p.unit,
        warn: p.warn,
        crit: p.crit,
        value,
        status,
        at: new Date(now).toISOString(),
        trend: prev ? (value > prev.value ? 'up' : value < prev.value ? 'down' : 'flat') : 'flat',
      }
      readings.set(s.id, row)
      if (!prev || prev.status !== status) changed.push(row)
    })
    listeners.forEach((fn) => {
      try {
        fn({ readings: [...readings.values()], changed, tick: tickCount })
      } catch (e) {
        console.error('[iot] listener error', e)
      }
    })
  }

  return {
    get sensors() {
      return sensors
    },
    get running() {
      return !!timer
    },
    onTick(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    start(intervalMs = 2000) {
      if (timer) return false
      tick()
      timer = setInterval(tick, intervalMs)
      return true
    },
    stop() {
      if (!timer) return false
      clearInterval(timer)
      timer = null
      return true
    },
    /**
     * 查询实时读数
     * @param {{sensorId?:string, buildingId?:string, onlyAbnormal?:boolean}} filter
     */
    snapshot(filter = {}) {
      let rows = [...readings.values()]
      if (!rows.length) {
        // 未启动时也返回一次采样，保证 Agent 随时可查
        tick()
        rows = [...readings.values()]
      }
      const hasFilter = filter.sensorId || filter.buildingId || filter.onlyAbnormal
      if (hasFilter) {
        rows = rows.filter(
          (r) =>
            (!filter.sensorId || r.id === filter.sensorId) &&
            (!filter.buildingId || r.buildingId === filter.buildingId) &&
            (!filter.onlyAbnormal || r.status !== 'normal'),
        )
      } else {
        // 无过滤条件时优先返回异常点位，便于"哪里报警了"这类提问
        const abnormal = rows.filter((r) => r.status !== 'normal')
        if (abnormal.length) rows = abnormal.concat(rows.filter((r) => r.status === 'normal').slice(0, 6))
      }
      return rows
    },
    /** 注入故障（演示用） */
    injectFault(kind = 'gasLeak') {
      const fault = FAULTS[kind] || FAULTS.gasLeak
      const targets = sensors.filter((s) => s.type === fault.type)
      if (!targets.length) return { injected: 0 }
      const until = Date.now() + fault.minutes * 60000
      targets.slice(0, 3).forEach((s, i) => {
        const p = profileOf(s)
        const value =
          p.dir === 'above' ? Number((p.crit * (1.05 + i * 0.2)).toFixed(2)) : Number((p.crit * (0.9 - i * 0.06)).toFixed(3))
        overrides.set(s.id, { until, value })
      })
      tick()
      return {
        kind,
        label: fault.label,
        injected: Math.min(3, targets.length),
        targets: targets.slice(0, 3).map((s) => s.id),
        until: new Date(until).toISOString(),
      }
    },
    /** 供 UI 渲染的调色 */
    colorOf(status) {
      return status === 'critical' ? '#ef4444' : status === 'warning' ? '#f59e0b' : '#22d3ee'
    },
    bgOf(status) {
      return hexToRgba(this.colorOf(status), 0.16)
    },
  }
}
