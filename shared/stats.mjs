/**
 * 统计与图表配置（前端 / 后端共用，ESM）
 * ---------------------------------------------------------------------------
 * 提供纯计算版本：给定 property / timeseries / pipes / alarms 数据，
 * 输出结构化统计结果与 ECharts option。前端直接渲染，后端 /api/stats 复用同一套逻辑，
 * 保证"地图上看到的"与"Agent 查到的"口径完全一致。
 * ---------------------------------------------------------------------------
 */

export const METRICS = {
  water: { label: '用水量', unit: 'm³', color: '#2E86FF' },
  gas: { label: '用气量', unit: 'm³', color: '#FF8C00' },
  power: { label: '用电量', unit: 'kW·h', color: '#8b5cf6' },
  occupancy: { label: '入住率', unit: '%', color: '#22c55e' },
  pipeHealth: { label: '管线健康度', unit: '', color: '#0ea5e9' },
  alarms: { label: '告警统计', unit: '次', color: '#ef4444' },
}

const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100

/** 单个楼栋 8 天用电量（由用水量线性推演，保持关联性） */
export function buildingPower(series) {
  return series.map((w) => r1(w * 32 + 8))
}

/** 主统计入口：返回结构化数据 */
export function computeStats(metric, scope, days, data) {
  const { property, timeseries, pipes } = data
  const buildings = property.buildings.filter((b) => b.type === 'residential')
  const all = property.buildings
  const labels = timeseries.labels.slice(-days)

  if (metric === 'occupancy') {
    const items = all.map((b) => ({ id: b.id, name: b.name, value: b.occupancyRate, units: b.units, occupied: b.occupiedUnits }))
    items.sort((a, b) => a.value - b.value)
    const totalUnits = all.reduce((s, b) => s + b.units, 0)
    const occupied = all.reduce((s, b) => s + b.occupiedUnits, 0)
    return {
      metric,
      scope,
      title: '各楼栋入住率对比',
      labels: items.map((i) => i.name),
      series: [{ name: '入住率', data: items.map((i) => r2(i.value * 100)) }],
      summary: {
        communityRate: r2(occupied / totalUnits),
        totalUnits,
        occupied,
        lowest: items[0],
        highest: items[items.length - 1],
      },
      itemIds: items.map((i) => i.id),
      unit: '%',
      chartType: 'bar',
    }
  }

  if (metric === 'pipeHealth') {
    const byType = ['water', 'gas', 'sewage'].map((t) => {
      const list = pipes.features.filter((f) => f.properties.pipe === t)
      const avg = list.length ? list.reduce((s, f) => s + f.properties.health, 0) / list.length : 0
      return { type: t, label: { water: '给水', gas: '燃气', sewage: '污水' }[t], count: list.length, avg: r3(avg), length: r1(list.reduce((s, f) => s + f.properties.length, 0)) }
    })
    const levels = [
      { name: '良好（>0.8）', value: pipes.features.filter((f) => f.properties.riskLevel === 'low').length, color: '#22c55e' },
      { name: '关注（0.6~0.8）', value: pipes.features.filter((f) => f.properties.riskLevel === 'medium').length, color: '#f59e0b' },
      { name: '较差（<0.6）', value: pipes.features.filter((f) => f.properties.riskLevel === 'high').length, color: '#ef4444' },
    ]
    const avgAll = pipes.features.reduce((s, f) => s + f.properties.health, 0) / pipes.features.length
    return {
      metric,
      scope,
      title: '管网健康度评估',
      labels: levels.map((l) => l.name),
      series: [{ name: '管段数', data: levels.map((l) => l.value) }],
      pie: levels,
      byType,
      summary: { avgHealth: r3(avgAll), total: pipes.features.length, high: levels[2].value, medium: levels[1].value },
      unit: '',
      chartType: 'pie',
    }
  }

  if (metric === 'alarms') {
    const alarms = data.alarms.alarms
    const byLevel = ['critical', 'warning', 'info'].map((lv) => ({
      level: lv,
      label: { critical: '严重', warning: '告警', info: '提示' }[lv],
      value: alarms.filter((a) => a.level === lv).length,
      color: { critical: '#ef4444', warning: '#f59e0b', info: '#38bdf8' }[lv],
    }))
    const byType = {}
    alarms.forEach((a) => {
      byType[a.type] = (byType[a.type] || 0) + 1
    })
    return {
      metric,
      scope,
      title: '告警事件统计',
      labels: byLevel.map((l) => l.label),
      series: [{ name: '告警次数', data: byLevel.map((l) => l.value) }],
      pie: byLevel,
      byType,
      summary: { total: alarms.length, critical: byLevel[0].value, warning: byLevel[1].value, info: byLevel[2].value },
      unit: '次',
      chartType: 'bar',
    }
  }

  // --- 用水 / 用气 / 用电：时间序列 ---
  const meta = METRICS[metric]
  const scopeIsCommunity = !scope || scope === 'community'
  let values = []
  let title = ''

  if (scopeIsCommunity) {
    const src = metric === 'power' ? null : timeseries.community[metric]
    values = metric === 'power' ? timeseries.community.power : src
    title = `小区近 ${days} 天${meta.label}趋势`
  } else {
    const b = timeseries.byBuilding[scope]
    if (!b) throw new Error(`没有楼栋 ${scope} 的用量数据`)
    values = metric === 'power' ? buildingPower(b.water) : b[metric]
    title = `${b.name} 近 ${days} 天${meta.label}趋势`
  }
  values = values.slice(-days)

  const total = values.reduce((s, v) => s + v, 0)
  const avg = total / Math.max(values.length, 1)
  const peak = Math.max(...values)
  const peakIdx = values.indexOf(peak)

  return {
    metric,
    scope: scope || 'community',
    title,
    labels,
    series: [{ name: meta.label, data: values }],
    summary: {
      total: r1(total),
      avg: r1(avg),
      peak,
      peakDay: labels[peakIdx],
      unit: meta.unit,
      // 与前一天相比的变化率
      changeRate: r3((values[values.length - 1] - values[values.length - 2]) / Math.max(values[values.length - 2], 1)),
    },
    unit: meta.unit,
    chartType: 'line',
    itemIds: null,
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000

/* ========================================================================== */
/* ECharts option 构造                                                         */
/* ========================================================================== */

const AXIS_STYLE = {
  axisLine: { lineStyle: { color: 'rgba(148,163,184,0.45)' } },
  axisLabel: { color: '#94a3b8', fontSize: 11 },
  splitLine: { lineStyle: { color: 'rgba(148,163,184,0.14)' } },
}

/**
 * 生成 ECharts option
 * @param {object} stats computeStats 的结果
 * @param {object} opts { type, showLegend }
 */
export function buildChartOption(stats, opts = {}) {
  const type = opts.type || stats.chartType || 'line'
  const meta = METRICS[stats.metric] || { color: '#38bdf8', label: stats.metric, unit: '' }
  const base = {
    backgroundColor: 'transparent',
    animationDuration: 600,
    grid: { left: 46, right: 20, top: 34, bottom: 30 },
    tooltip: {
      trigger: type === 'pie' ? 'item' : 'axis',
      backgroundColor: 'rgba(15,23,42,0.92)',
      borderColor: 'rgba(148,163,184,0.3)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
    },
  }

  if (type === 'pie') {
    const items = stats.pie || stats.series[0].data.map((v, i) => ({ name: stats.labels[i], value: v, color: meta.color }))
    return {
      ...base,
      legend: { bottom: 0, textStyle: { color: '#cbd5e1', fontSize: 11 }, icon: 'circle' },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '46%'],
          itemStyle: { borderColor: 'rgba(11,18,32,0.9)', borderWidth: 2 },
          label: { color: '#e2e8f0', fontSize: 11, formatter: '{b}\n{c}' },
          data: items.map((it) => ({
            name: it.name,
            value: it.value,
            itemStyle: { color: it.color || meta.color },
          })),
        },
      ],
    }
  }

  if (type === 'gauge') {
    const v = stats.summary?.avgHealth ?? stats.summary?.communityRate ?? 0
    const pctVal = v <= 1 ? r2(v * 100) : r1(v)
    return {
      ...base,
      series: [
        {
          type: 'gauge',
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: 100,
          radius: '92%',
          progress: { show: true, width: 14, itemStyle: { color: pctVal > 80 ? '#22c55e' : pctVal > 60 ? '#f59e0b' : '#ef4444' } },
          axisLine: { lineStyle: { width: 14, color: [[1, 'rgba(148,163,184,0.2)']] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: false },
          detail: { valueAnimation: true, fontSize: 30, color: '#e2e8f0', offsetCenter: [0, 0], formatter: '{value}%' },
          title: { show: true, offsetCenter: [0, '34%'], color: '#94a3b8', fontSize: 12 },
          data: [{ value: pctVal, name: stats.title }],
        },
      ],
    }
  }

  if (type === 'bar') {
    const isPct = stats.metric === 'occupancy'
    return {
      ...base,
      grid: { left: 50, right: 22, top: 30, bottom: 52 },
      xAxis: {
        type: 'category',
        data: stats.labels,
        ...AXIS_STYLE,
        axisLabel: { ...AXIS_STYLE.axisLabel, rotate: stats.labels.length > 8 ? 38 : 0, interval: 0 },
      },
      yAxis: { type: 'value', name: stats.unit, nameTextStyle: { color: '#94a3b8', fontSize: 11 }, ...AXIS_STYLE },
      series: [
        {
          type: 'bar',
          barMaxWidth: 26,
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: meta.color },
                { offset: 1, color: 'rgba(56,189,248,0.25)' },
              ],
            },
          },
          label: { show: true, position: 'top', color: '#cbd5e1', fontSize: 10, formatter: isPct ? '{c}%' : '{c}' },
          data: stats.series[0].data,
        },
      ],
    }
  }

  // 默认折线（带面积渐变）
  return {
    ...base,
    xAxis: { type: 'category', boundaryGap: false, data: stats.labels, ...AXIS_STYLE },
    yAxis: { type: 'value', name: stats.unit, nameTextStyle: { color: '#94a3b8', fontSize: 11 }, ...AXIS_STYLE },
    series: [
      {
        type: 'line',
        smooth: true,
        symbolSize: 6,
        lineStyle: { width: 2.6, color: meta.color },
        itemStyle: { color: meta.color },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: hexA(meta.color, 0.45) },
              { offset: 1, color: hexA(meta.color, 0.02) },
            ],
          },
        },
        data: stats.series[0].data,
      },
    ],
  }
}

function hexA(hex, alpha) {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

export default { METRICS, computeStats, buildChartOption }
