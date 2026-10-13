/**
 * 离线意图解析（NLU）
 * ---------------------------------------------------------------------------
 * 没有配置大模型 Key、或模型调用失败时的兜底通道。
 * 用规则把中文指令翻译成与 LLM 完全一致的命令队列，
 * 保证"自然语言 → 场景响应"这条链路在任何环境下都可演示。
 *
 * 设计原则：宁可少认（返回 knowledge 让 RAG 回答），也不要乱执行。
 * ---------------------------------------------------------------------------
 */
import { resolveBuildingId } from './data.mjs'

const PIPE_WORDS = [
  { key: 'water', words: ['给水', '供水', '上水', '水网', '水管', '自来水', '水线'] },
  { key: 'gas', words: ['燃气', '天然气', '煤气', '气管', '燃气管线'] },
  { key: 'sewage', words: ['污水', '排污', '下水', '雨污'] },
]

const METRIC_WORDS = [
  { key: 'water', words: ['用水', '水量', '耗水'] },
  { key: 'gas', words: ['用气', '气量', '耗气', '燃气用量'] },
  { key: 'power', words: ['用电', '电量', '耗电', '负荷'] },
  { key: 'occupancy', words: ['入住率', '入住', '空置率', '空置'] },
  { key: 'pipeHealth', words: ['管网健康', '管线健康', '管道健康', '健康度'] },
  { key: 'alarms', words: ['告警', '报警', '报警次数', '事件'] },
]

const has = (text, words) => words.some((w) => text.includes(w))

function detectPipes(text) {
  const found = PIPE_WORDS.filter((p) => has(text, p.words)).map((p) => p.key)
  return found
}

function detectMetric(text) {
  const m = METRIC_WORDS.find((x) => has(text, x.words))
  return m ? m.key : null
}

function detectDays(text) {
  if (/本月|这个月|当月/.test(text)) return 30
  if (/近\s*(\d+)\s*天|最近\s*(\d+)\s*天|(\d+)\s*天/.test(text)) {
    const m = text.match(/近\s*(\d+)\s*天|最近\s*(\d+)\s*天|(\d+)\s*天/)
    return Number(m[1] || m[2] || m[3])
  }
  if (/本周|这周|近一周/.test(text)) return 7
  if (/今天/.test(text)) return 1
  return 8
}

/** 是否属于"操控系统"类表达 */
export function looksLikeAction(text) {
  const actionWords = [
    '飞到', '飞向', '定位', '放大', '缩小', '全景', '视角', '看', '显示', '隐藏', '打开', '关闭', '展开', '收起',
    '高亮', '统计', '出图', '画', '图表', '地下', '挖', '剖', '切换', '改成', '改为', '调整为', '标注', '聚焦',
    '巡检', '动画', '定位到', '去', '跳到',
  ]
  const knowledgeWords = ['怎么', '如何', '为什么', '是什么', '流程', '规定', '标准', '多久', '多少时间', '收费标准', '办法', '预案']
  if (has(text, knowledgeWords) && !has(text, ['显示', '统计', '飞到', '展开'])) return false
  return has(text, actionWords)
}

/**
 * 解析为命令队列
 * @returns {{route:'action'|'knowledge', commands:Array, reply:string, confidence:number}}
 */
export function parseIntent(text, data) {
  const t = String(text || '').trim()
  const commands = []
  const notes = []

  const buildingId = resolveBuildingId(data, t.match(/([A-Za-z]?\d{1,3}\s*(?:号楼|栋|幢)|B\d{1,2})/)?.[1] || t)
  const pipes = detectPipes(t)
  const metric = detectMetric(t)
  const floorMatch = t.match(/(\d{1,3})\s*层/)
  const days = detectDays(t)

  // ---------- 楼层展开 ----------
  if (/展开|分层|拆开|爆破|抽屉|逐层/.test(t)) {
    if (buildingId) commands.push({ action: 'expandFloors', params: { buildingId }, reason: `定位到 ${buildingId}` })
    else commands.push({ action: 'setFloorMode', params: { mode: 'exploded' }, reason: '展开当前选中楼栋' })
  }
  // ---------- 收起 ----------
  if (/收起|复原|合起来|恢复原状/.test(t) && /层|展开/.test(t)) {
    commands.push({ action: 'collapseFloors', params: {}, reason: '收起分层' })
  }
  // ---------- 高亮楼层 ----------
  if (floorMatch && /高亮|打开|显示|看|查/.test(t) && !/展开/.test(t)) {
    if (buildingId) commands.push({ action: 'selectBuilding', params: { buildingId, fly: true } })
    commands.push({ action: 'highlightFloor', params: { floor: Number(floorMatch[1]) }, reason: `高亮 ${floorMatch[1]} 层` })
  }
  // ---------- 选中/飞到楼栋 ----------
  if (buildingId && !commands.some((c) => ['expandFloors', 'selectBuilding'].includes(c.action))) {
    if (/飞到|飞向|定位|去|聚焦|看看|查看|打开|显示|选中|哪|最低|最高/.test(t) || /^[A-Za-z]?\d{1,3}\s*(号楼|栋)?$/.test(t)) {
      commands.push({ action: 'selectBuilding', params: { buildingId, fly: true } })
    }
  }
  // ---------- 管线：地下 / 过滤 / 高亮 ----------
  const wantsUnderground = /地下|挖开|剖面|剖开|下潜|埋深|管廊|隧道|地面以下/.test(t)
  if (wantsUnderground) commands.push({ action: 'showUnderground', params: { enabled: true }, reason: '进入地下隧道视角' })
  if (/回到地表|返回地表|回到地面|关闭地下|退出地下/.test(t)) commands.push({ action: 'showUnderground', params: { enabled: false } })

  if (pipes.length || /管线|管道|管网/.test(t)) {
    commands.push({ action: 'toggleLayer', params: { layer: 'pipes', visible: true } })
    if (pipes.length) commands.push({ action: 'setPipeFilter', params: { types: pipes } })
    if (wantsUnderground) commands.push({ action: 'setPipeDepthScale', params: { scale: 3 } })
    if (pipes.length) {
      const first = data.pipes.features.find((f) => f.properties.pipe === pipes[0])
      if (first) commands.push({ action: 'showInfoCard', params: { kind: 'pipe', id: first.properties.id } })
    }
    if (/健康|更换|老化|风险|该换/.test(t)) commands.push({ action: 'queryPipeHealth', params: { topN: 3 } })
  }
  // ---------- 图层开关 ----------
  if (/隐藏|关闭|不显示|去掉/.test(t)) {
    if (/楼|建筑/.test(t)) commands.push({ action: 'toggleLayer', params: { layer: 'buildings', visible: false } })
    if (/管线|管道/.test(t)) commands.push({ action: 'toggleLayer', params: { layer: 'pipes', visible: false } })
    if (/测点|传感器|iot/i.test(t)) commands.push({ action: 'toggleLayer', params: { layer: 'sensors', visible: false } })
    if (/道路/.test(t)) commands.push({ action: 'toggleLayer', params: { layer: 'roads', visible: false } })
    if (/绿地|绿化/.test(t)) commands.push({ action: 'toggleLayer', params: { layer: 'greens', visible: false } })
  }
  // ---------- 统计与图表 ----------
  if (metric && /统计|图表|出图|画|趋势|显示|分析|多少/.test(t)) {
    const scope = buildingId || 'community'
    commands.push({ action: 'queryStats', params: { metric, scope, days }, reason: `统计${metric}` })
    commands.push({ action: 'showChart', params: { metric, scope, days, type: metric === 'occupancy' || metric === 'alarms' ? 'bar' : metric === 'pipeHealth' ? 'pie' : 'line' } })
    notes.push(`统计范围：${scope === 'community' ? '全小区' : scope}，近 ${days} 天`)
  } else if (metric) {
    commands.push({ action: 'queryStats', params: { metric, scope: buildingId || 'community', days } })
    notes.push(`统计范围：${buildingId || '全小区'}，近 ${days} 天`)
  }
  // ---------- 告警 / 物联网 ----------
  if (/告警|报警|异常|越限/.test(t) && !metric) {
    commands.push({ action: 'listAlarms', params: { limit: 5 } })
    commands.push({ action: 'setPanel', params: { panel: 'alarms', open: true } })
  }
  if (/测点|传感器|实时|压力|燃气浓度|液位|负荷/.test(t) && /查|看|多少|现在|实时/.test(t)) {
    commands.push({ action: 'queryIotRealtime', params: buildingId ? { buildingId } : {} })
  }
  if (/注入|模拟|演练|制造|来一次/.test(t) && /泄漏|故障|爆管|过载|报警/.test(t)) {
    const fault = /燃气|泄漏/.test(t) ? 'gasLeak' : /水|爆管|压力/.test(t) ? 'waterDrop' : 'powerOverload'
    commands.push({ action: 'setSimulate', params: { action: 'injectFault', fault } })
    commands.push({ action: 'setPanel', params: { panel: 'alarms', open: true } })
  }
  // ---------- 视角 ----------
  if (/全景|整个小区|俯视|整体/.test(t)) commands.push({ action: 'overviewSite', params: {} })
  if (/复位|重置|恢复默认|初始视角/.test(t)) commands.push({ action: 'resetView', params: {} })
  if (/巡检|巡游|动画|巡线/.test(t)) {
    const route = pipes.includes('gas') ? 'gas' : /主环|环路/.test(t) ? 'ring' : 'main'
    commands.push({ action: 'showTrajectoryDemo', params: { route } })
  }

  // 去重（同一 action + 参数只保留一次）
  const seen = new Set()
  const deduped = commands.filter((c) => {
    const k = `${c.action}:${JSON.stringify(c.params)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  if (deduped.length) {
    return {
      route: 'action',
      commands: deduped,
      reply: `已解析你的指令，将执行 ${deduped.length} 个场景操作。${notes.join('；')}`,
      confidence: 0.6,
    }
  }
  return { route: 'knowledge', commands: [], reply: '', confidence: 0.3 }
}
