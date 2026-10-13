/**
 * 小型工具库：经纬度换算、颜色、格式化、事件总线
 */

export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI
export const EARTH_R = 6378137.0

/** 米制高度 -> 图层深度呈现 */
export const fmt = {
  num: (v, n = 0) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(n)),
  /** 0.7123 -> 71.2% */
  pct: (v, n = 1) => (v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(n)}%`),
  /** 米 -> 1.2 km / 320 m */
  dist: (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`),
  time: (d = new Date()) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`,
}

/** 颜色字符串 -> Cesium.Color（独立于 Cesium 的轻量版本，供纯 UI 使用） */
export function hexToRgba(hex, alpha = 1) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** 确定性伪随机（用于 IoT 模拟，保证可复现） */
export function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 平滑噪声：用于水位/压力漂移 */
export function drift(t, base, amp, period = 60000) {
  return base + Math.sin((t / period) * Math.PI * 2) * amp
}

/** 极简事件总线 */
export function createBus() {
  const map = new Map()
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set())
      map.get(type).add(fn)
      return () => map.get(type).delete(fn)
    },
    off(type, fn) {
      map.get(type)?.delete(fn)
    },
    emit(type, payload) {
      map.get(type)?.forEach((fn) => {
        try {
          fn(payload)
        } catch (e) {
          console.error(`[bus:${type}]`, e)
        }
      })
    },
  }
}

/** 深拷贝（数据均为 JSON 结构） */
export const clone = (v) => JSON.parse(JSON.stringify(v))

/** 简易防抖 */
export function debounce(fn, ms = 120) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
