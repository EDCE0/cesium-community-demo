/**
 * Agent 命令注册表（共 43 个）
 * ---------------------------------------------------------------------------
 * 分两部分：
 *   A. cesium-mcp-bridge 内置 19 个命令（相机/图层/实体/3D/动画/交互），
 *      由 CesiumBridge.execute() 原生执行 —— 与 MCP 协议、外部 Agent 完全兼容；
 *   B. 市政领域扩展 24 个命令（buildings / pipes / iot / alarms / stats / charts /
 *      underground / ui），由本文件的 dispatch() 执行。
 *
 * 前端对话面板、后端 Agent、外部 MCP 客户端（Claude Desktop / Cursor）
 * 走的是同一套命令名与参数结构。
 * ---------------------------------------------------------------------------
 */

export const BRIDGE_COMMANDS = [
  'flyTo',
  'setView',
  'getView',
  'zoomToExtent',
  'addGeoJsonLayer',
  'addHeatmap',
  'addMarker',
  'addLabel',
  'removeLayer',
  'setLayerVisibility',
  'listLayers',
  'updateLayerStyle',
  'setBasemap',
  'highlight',
  'load3dTiles',
  'loadTerrain',
  'loadImageryService',
  'playTrajectory',
  'screenshot',
]

/** 领域命令清单（24 个） */
export const DOMAIN_COMMAND_NAMES = [
  'overviewSite',
  'listBuildings',
  'selectBuilding',
  'expandFloors',
  'collapseFloors',
  'highlightFloor',
  'showUnderground',
  'setPipeFilter',
  'setPipeDepthScale',
  'listPipes',
  'queryPipeHealth',
  'listSensors',
  'queryIotRealtime',
  'setSimulate',
  'listAlarms',
  'queryStats',
  'showChart',
  'showInfoCard',
  'showTooltip',
  'setPanel',
  'toggleLayer',
  'setFloorMode',
  'showTrajectoryDemo',
  'resetView',
]

export const TOTAL_COMMANDS = BRIDGE_COMMANDS.length + DOMAIN_COMMAND_NAMES.length // 43

/**
 * 领域命令的 JSON Schema 描述 —— 供 LLM function calling 与 MCP 工具列表使用
 */
export const DOMAIN_COMMAND_SCHEMAS = {
  overviewSite: {
    description: '把相机拉到能看清整个小区全景的俯视视角',
    parameters: { type: 'object', properties: { duration: { type: 'number', description: '飞行秒数，默认 1.6' } } },
  },
  listBuildings: {
    description: '列出小区所有楼栋的名称与编号，可用于确定用户说的"3 号楼"对应哪一栋',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['residential', 'community', 'school', 'commercial', 'utility', 'parking'], description: '按建筑类型过滤' },
        sortBy: { type: 'string', enum: ['id', 'floors', 'occupancyRate', 'units'], description: '排序字段' },
      },
    },
  },
  selectBuilding: {
    description: '选中并飞到指定楼栋，同时弹出该楼栋的信息卡片',
    parameters: {
      type: 'object',
      properties: {
        buildingId: { type: 'string', description: '楼栋编号（如 B07）或名称（如 "7 号楼"）' },
        fly: { type: 'boolean', description: '是否同时飞到该楼栋，默认 true' },
      },
      required: ['buildingId'],
    },
  },
  expandFloors: {
    description: '把指定楼栋按楼层"抽屉式"展开，逐层分离显示',
    parameters: {
      type: 'object',
      properties: { buildingId: { type: 'string', description: '楼栋编号或名称' } },
      required: ['buildingId'],
    },
  },
  collapseFloors: {
    description: '收起当前已展开的楼层分层视图',
    parameters: { type: 'object', properties: {} },
  },
  highlightFloor: {
    description: '在已展开的楼栋中高亮某一层',
    parameters: {
      type: 'object',
      properties: { floor: { type: 'number', description: '楼层号，从 1 开始' } },
      required: ['floor'],
    },
  },
  showUnderground: {
    description: '切换到地下隧道视角，直观查看埋地给水/燃气/污水管线；关闭则回到地表',
    parameters: {
      type: 'object',
      properties: { enabled: { type: 'boolean', description: 'true 进入地下视角，false 返回地表，默认 true' } },
    },
  },
  setPipeFilter: {
    description: '按管网类型过滤显示的管线',
    parameters: {
      type: 'object',
      properties: {
        types: {
          type: 'array',
          items: { type: 'string', enum: ['water', 'gas', 'sewage', 'all'] },
          description: '要显示的管线类型，all 表示全部',
        },
      },
      required: ['types'],
    },
  },
  setPipeDepthScale: {
    description: '放大管线埋深以便观察（1 = 真实埋深，建议 2~6）',
    parameters: {
      type: 'object',
      properties: { scale: { type: 'number', description: '埋深放大系数，1~12' } },
      required: ['scale'],
    },
  },
  listPipes: {
    description: '列出地下管线的编号、类型、管径、材质、埋深与管龄',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['water', 'gas', 'sewage'], description: '按类型过滤' },
        minAge: { type: 'number', description: '只列出管龄不小于该值的管段' },
      },
    },
  },
  queryPipeHealth: {
    description: '查询管线健康度评估结果，用于识别需要优先更换的管段',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['high', 'medium', 'low'], description: '按风险等级过滤' },
        topN: { type: 'number', description: '返回健康度最低的 N 段，默认 5' },
      },
    },
  },
  listSensors: {
    description: '列出 IoT 点位（水压、燃气浓度、液位、流量、配电负荷）',
    parameters: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['pressure', 'gas', 'level', 'flow', 'power'], description: '按传感器类型过滤' } },
    },
  },
  queryIotRealtime: {
    description: '查询 IoT 点位的实时读数与告警状态',
    parameters: {
      type: 'object',
      properties: {
        sensorId: { type: 'string', description: '点位编号；缺省时返回所有处于告警状态的测点' },
        buildingId: { type: 'string', description: '按楼栋过滤' },
      },
    },
  },
  setSimulate: {
    description: '控制 IoT 实时数据模拟（用于演示告警联动）',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'stop', 'injectFault'], description: '启动/停止模拟，或注入一个人为故障' },
        fault: { type: 'string', enum: ['gasLeak', 'waterDrop', 'powerOverload'], description: '注入的故障类型' },
      },
    },
  },
  listAlarms: {
    description: '查询设备告警事件列表',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['critical', 'warning', 'info'], description: '按级别过滤' },
        days: { type: 'number', description: '最近天数，默认 8' },
        limit: { type: 'number', description: '最多返回条数，默认 10' },
      },
    },
  },
  queryStats: {
    description: '查询统计数据：用水/用气趋势、入住率、管线健康度、告警频次、楼栋对比',
    parameters: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['water', 'gas', 'power', 'occupancy', 'pipeHealth', 'alarms'],
          description: '统计指标',
        },
        scope: { type: 'string', description: '统计范围：community（整个小区）或楼栋编号如 B07' },
        days: { type: 'number', description: '统计天数，默认 8' },
      },
      required: ['metric'],
    },
  },
  showChart: {
    description: '在三维场景上叠加统计图表',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['line', 'bar', 'pie', 'radar', 'gauge'], description: '图表类型' },
        title: { type: 'string', description: '图表标题' },
        metric: { type: 'string', enum: ['water', 'gas', 'power', 'occupancy', 'pipeHealth', 'alarms'], description: '数据指标' },
        scope: { type: 'string', description: '统计范围，默认 community' },
        position: { type: 'string', enum: ['left', 'right', 'center'], description: '面板位置，默认 right' },
      },
      required: ['metric'],
    },
  },
  showInfoCard: {
    description: '在界面上弹出信息卡片（楼栋、管段或自定义文本）',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['building', 'pipe', 'sensor', 'text'], description: '卡片类型' },
        id: { type: 'string', description: '目标编号' },
        title: { type: 'string', description: 'kind=text 时的标题' },
        content: { type: 'string', description: 'kind=text 时的正文（支持换行）' },
      },
      required: ['kind'],
    },
  },
  showTooltip: {
    description: '在三维场景中显示一条悬浮提示（通常用于讲解或强调）',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '提示文字' },
        longitude: { type: 'number' },
        latitude: { type: 'number' },
        height: { type: 'number', description: '高度（米），默认 60' },
        duration: { type: 'number', description: '持续秒数，默认 8' },
      },
      required: ['text'],
    },
  },
  setPanel: {
    description: '打开或关闭界面面板',
    parameters: {
      type: 'object',
      properties: {
        panel: { type: 'string', enum: ['layers', 'stats', 'chat', 'card', 'alarms', 'legend'], description: '面板名称' },
        open: { type: 'boolean', description: '是否打开，缺省为切换' },
      },
      required: ['panel'],
    },
  },
  toggleLayer: {
    description: '显示或隐藏三维图层',
    parameters: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: ['buildings', 'roads', 'greens', 'pipes', 'sensors', 'baseMap'], description: '图层名称' },
        visible: { type: 'boolean', description: '是否可见，缺省为切换' },
      },
      required: ['layer'],
    },
  },
  setFloorMode: {
    description: '楼层显示模式：normal 正常白模，exploded 分层展开',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['normal', 'exploded'] },
        buildingId: { type: 'string', description: 'exploded 模式下的目标楼栋' },
      },
      required: ['mode'],
    },
  },
  showTrajectoryDemo: {
    description: '播放一次巡检无人机/抢修车沿小区道路的巡游动画',
    parameters: {
      type: 'object',
      properties: {
        route: { type: 'string', enum: ['ring', 'main', 'gas'], description: '巡游路线，默认 ring 主环路' },
        speed: { type: 'number', description: '速度倍率，默认 1' },
      },
    },
  },
  resetView: {
    description: '恢复默认视角与图层状态',
    parameters: { type: 'object', properties: {} },
  },
}

/* ========================================================================== */
/* 执行器                                                                      */
/* ========================================================================== */

/** 简易中文数字 → 阿拉伯数字，便于解析"3 号楼" */
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/**
 * 创建命令分发器
 * @param {object} ctx
 * @param {CesiumViewerService} ctx.svc  三维场景服务
 * @param {object} ctx.ui                界面控制桥（Pinia store 方法集合）
 * @param {object} ctx.data              原始数据（buildings/pipes/sensors/timeseries/alarms/property）
 * @param {object} ctx.iot               IoT 模拟器
 * @param {Function} ctx.stats           统计计算函数
 */
export function createCommandDispatcher(ctx) {
  const { svc, ui, data, iot } = ctx

  /* ---------- 11 个领域的辅助函数 ---------- */

  /** 名称/编号 → 楼栋编号 */
  function resolveBuildingId(input) {
    if (!input) return null
    const raw = String(input).trim()
    if (data.index.buildings.has(raw.toUpperCase())) return raw.toUpperCase()
    const normalized = raw
      .replace(/\s+/g, '')
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[一二三四五六七八九十]/g, (c) => String(CN_NUM[c] ?? c))
      .replace(/号楼|栋|幢|楼/g, '')
      .toUpperCase()
    // 1 → B01 / 7 → B07
    const num = Number(normalized)
    if (Number.isFinite(num)) {
      const id = `B${String(num).padStart(2, '0')}`
      if (data.index.buildings.has(id)) return id
    }
    // 模糊包含匹配
    for (const [id, b] of data.index.buildings) {
      if (b.name.replace(/\s+/g, '').includes(normalized) || normalized.includes(String(b.name).replace(/[^\d]/g, ''))) return id
    }
    return null
  }

  function pipeList() {
    return data.pipes.features.map((f) => f.properties)
  }

  function sensorRealtime(filter = {}) {
    return iot.snapshot(filter)
  }

  function requireBuilding(params) {
    const id = resolveBuildingId(params.buildingId || params.id || params.name)
    if (!id) throw new Error(`找不到楼栋「${params.buildingId ?? ''}」，可用编号如 B01~B17`)
    return id
  }

  /* ---------- 领域命令实现 ---------- */

  const handlers = {
    async overviewSite(p) {
      await svc.overview(p.duration ?? 1.6)
      return { ok: true, view: svc.getView() }
    },

    listBuildings(p = {}) {
      let list = data.property.buildings.map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type,
        group: b.group,
        floors: b.floors,
        units: b.units,
        occupancyRate: b.occupancyRate,
        height: b.height,
      }))
      if (p.type) list = list.filter((b) => b.type === p.type)
      if (p.sortBy) list.sort((a, b) => (a[p.sortBy] > b[p.sortBy] ? -1 : 1))
      return { total: list.length, buildings: list }
    },

    async selectBuilding(p) {
      const id = requireBuilding(p)
      const detail = await svc.selectBuilding(id, { fly: p.fly !== false })
      ui.openCard(detail)
      return { id, name: detail.name, floors: detail.floors, units: detail.units, occupancyRate: detail.occupancyRate }
    },

    async expandFloors(p) {
      const id = requireBuilding(p)
      await svc.selectBuilding(id, { fly: false })
      await svc.expandFloors(id)
      const detail = svc.getBuildingDetail(id)
      ui.openCard(detail)
      return { id, floors: detail.floors, mode: 'exploded' }
    },

    async collapseFloors() {
      const ok = await svc.collapseFloors()
      return { collapsed: ok }
    },

    async highlightFloor(p) {
      const floor = Number(p.floor)
      if (!Number.isFinite(floor)) throw new Error('highlightFloor 需要 floor 参数')
      svc.highlightFloor(floor)
      ui.setActiveFloor(floor)
      return { floor }
    },

    async showUnderground(p = {}) {
      const enabled = p.enabled !== false
      const on = svc.setUnderground(enabled)
      ui.setUnderground(on)
      if (on) {
        // 拉近到水泵房—中央大道一带，俯角略陡，让管线成为画面主体
        await svc.flyTo(
          {
            longitude: svc.site.origin.lon - 0.0004,
            latitude: svc.site.origin.lat - 0.0022,
            height: 230,
            headingDeg: -6,
            pitchDeg: -42,
          },
          1.8,
        )
      } else {
        await svc.overview(1.4)
      }
      return { underground: on, pipeCount: pipeList().length }
    },

    async setPipeFilter(p) {
      const types = (p.types || []).filter((t) => t !== 'all')
      svc.setLayerVisibility('pipes', true)
      svc.pipes.filter(types)
      ui.setPipeFilter(types)
      return { types, matched: pipeList().filter((x) => !types.length || types.includes(x.pipe)).length }
    },

    setPipeDepthScale(p) {
      const scale = svc.pipes.setDepthScale(p.scale)
      ui.setDepthScale(scale)
      return { scale }
    },

    listPipes(p = {}) {
      let list = pipeList()
      if (p.type) list = list.filter((x) => x.pipe === p.type)
      if (p.minAge) list = list.filter((x) => x.age >= p.minAge)
      return {
        total: list.length,
        pipes: list.map((x) => ({
          id: x.id,
          name: x.name,
          pipe: x.pipeLabel,
          diameter: x.diameter,
          material: x.material,
          depth: x.depth,
          age: x.age,
          length: x.length,
          health: x.health,
        })),
      }
    },

    queryPipeHealth(p = {}) {
      let list = pipeList()
      if (p.level) list = list.filter((x) => x.riskLevel === p.level)
      list = list.sort((a, b) => a.health - b.health).slice(0, p.topN ?? 5)
      return {
        worst: list.map((x) => ({ id: x.id, name: x.name, health: x.health, level: x.healthLevel, age: x.age, material: x.material })),
        summary: {
          total: pipeList().length,
          avgHealth: Number((pipeList().reduce((s, x) => s + x.health, 0) / pipeList().length).toFixed(3)),
          high: pipeList().filter((x) => x.riskLevel === 'high').length,
          medium: pipeList().filter((x) => x.riskLevel === 'medium').length,
        },
      }
    },

    listSensors(p = {}) {
      let list = data.sensors.features.map((f) => f.properties)
      if (p.type) list = list.filter((s) => s.type === p.type)
      return {
        total: list.length,
        sensors: list.map((s) => ({ id: s.id, name: s.name, type: s.typeLabel, unit: s.unit, buildingId: s.buildingId })),
      }
    },

    queryIotRealtime(p = {}) {
      const rows = sensorRealtime({ sensorId: p.sensorId, buildingId: p.buildingId })
      return {
        count: rows.length,
        abnormal: rows.filter((r) => r.status !== 'normal').length,
        readings: rows.map((r) => ({ id: r.id, name: r.name, value: r.value, unit: r.unit, status: r.status, at: r.at })),
      }
    },

    setSimulate(p = {}) {
      if (p.action === 'stop') {
        iot.stop()
        return { running: false }
      }
      if (p.action === 'injectFault') {
        const fault = iot.injectFault(p.fault || 'gasLeak')
        return { fault, ...fault }
      }
      iot.start()
      return { running: true }
    },

    listAlarms(p = {}) {
      let list = data.alarms.alarms.slice()
      if (p.level) list = list.filter((a) => a.level === p.level)
      if (p.days) {
        const since = Date.now() - p.days * 86400000
        list = list.filter((a) => new Date(a.ts.replace(' ', 'T') + '+08:00').getTime() >= since)
      }
      list = list.slice(0, p.limit ?? 10)
      return {
        total: list.length,
        byLevel: {
          critical: list.filter((a) => a.level === 'critical').length,
          warning: list.filter((a) => a.level === 'warning').length,
          info: list.filter((a) => a.level === 'info').length,
        },
        alarms: list,
      }
    },

    queryStats(p) {
      const result = ctx.stats(p.metric, p.scope || 'community', p.days ?? 8)
      return result
    },

    showChart(p) {
      const chart = ctx.buildChart(p)
      ui.pushChart(chart)
      return { shown: true, chartId: chart.id, type: chart.type, title: chart.title }
    },

    showInfoCard(p) {
      if (p.kind === 'building') {
        const id = requireBuilding({ buildingId: p.id })
        const detail = svc.getBuildingDetail(id)
        ui.openCard(detail)
        return { kind: 'building', id }
      }
      if (p.kind === 'pipe') {
        const pipe = pipeList().find((x) => x.id === p.id)
        if (!pipe) throw new Error(`找不到管段 ${p.id}`)
        svc.highlightPipes([pipe.id], true)
        ui.openPipeCard(pipe)
        return { kind: 'pipe', id: pipe.id }
      }
      if (p.kind === 'sensor') {
        const row = sensorRealtime({ sensorId: p.id })[0]
        if (!row) throw new Error(`找不到点位 ${p.id}`)
        ui.openSensorCard(row)
        return { kind: 'sensor', id: row.id }
      }
      ui.openTextCard(p.title || '提示', p.content || '')
      return { kind: 'text' }
    },

    showTooltip(p) {
      return ui.showTooltip(p)
    },

    setPanel(p) {
      const state = ui.setPanel(p.panel, p.open)
      return { panel: p.panel, open: state }
    },

    toggleLayer(p) {
      const current = svc.getLayerVisibility()[p.layer]
      const visible = p.visible === undefined ? !current : !!p.visible
      svc.setLayerVisibility(p.layer, visible)
      ui.setLayer(p.layer, visible)
      return { layer: p.layer, visible }
    },

    async setFloorMode(p) {
      if (p.mode === 'exploded') {
        const id = p.buildingId ? requireBuilding(p) : svc.selectedBuildingId
        if (!id) throw new Error('请先指定要展开的楼栋，例如"把 7 号楼楼层展开"')
        await svc.expandFloors(id)
        ui.openCard(svc.getBuildingDetail(id))
        return { mode: 'exploded', id }
      }
      await svc.collapseFloors()
      return { mode: 'normal' }
    },

    async showTrajectoryDemo(p = {}) {
      const routeId = p.route === 'main' ? 'R_MAIN_2' : p.route === 'gas' ? 'G-002' : 'R_MAIN_1'
      const feature =
        data.roads.features.find((f) => f.id === routeId) || data.pipes.features.find((f) => f.id === routeId)
      if (!feature) throw new Error('找不到巡游路线')
      const coords = feature.geometry.coordinates
      const speed = p.speed ?? 1
      const info = svc.bridge.playTrajectory({
        id: `tour-${routeId}`,
        name: p.route === 'gas' ? '燃气巡检车' : '园区巡检车',
        coordinates: coords,
        durationSeconds: Math.max(12, coords.length * 3),
        trailSeconds: 14,
        label: p.route === 'gas' ? '燃气巡检' : '园区巡检',
      })
      void speed
      return { playing: true, route: routeId, points: coords.length }
    },

    async resetView() {
      svc.setUnderground(false)
      await svc.collapseFloors()
      await svc.overview(1.6)
      svc.setLayerVisibility('pipes', false)
      ui.resetLayers()
      return { ok: true }
    },
  }

  /**
   * 统一分发：先领域命令，再落到 bridge 内置命令
   * @param {{action:string, params?:object}} cmd
   */
  async function dispatch(cmd) {
    const action = cmd?.action
    const params = cmd?.params || {}
    if (!action) throw new Error('缺少 action')

    if (handlers[action]) {
      const data_ = await handlers[action](params)
      return { success: true, action, data: data_ }
    }

    if (BRIDGE_COMMANDS.includes(action)) {
      const result = await svc.bridge.execute({ action, params })
      if (!result.success) throw new Error(result.error || `${action} 执行失败`)
      return result
    }

    throw new Error(`未知命令：${action}`)
  }

  return { dispatch, handlers, resolveBuildingId }
}
