/**
 * Agent 服务：把一句自然语言变成「场景命令」或「知识问答」
 * ---------------------------------------------------------------------------
 * 通道判断与执行：
 *   1) 优先调用大模型（DeepSeek flash），把 43 个命令作为 tools 交给模型，
 *      模型自主要么返回工具调用（→ sceneCommands 交给前端执行），
 *      要么直接回答（→ 知识问答，答案里带引用来源）。
 *   2) 模型不可用（无 Key / 超时 / 报错）时，自动降级到 nlu.mjs 的规则解析 +
 *      knowledge.mjs 的 BM25 检索，接口返回结构完全不变。
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, resolveLlm } from './config.mjs'
import { parseIntent, looksLikeAction } from './nlu.mjs'
import { computeStats } from '../../../shared/stats.mjs'
import { resolveBuildingId } from './data.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 命令全集：shared/tools.json 是唯一事实来源 */
export const TOOLS = JSON.parse(readFileSync(join(config.paths.root, 'shared', 'tools.json'), 'utf8'))

/** 转成 OpenAI function calling 格式 */
export function toolSchemaForLlm() {
  return [...TOOLS.bridge, ...TOOLS.domain].map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } },
  }))
}

const SYSTEM_PROMPT = `你是"阳光新城"市政/物业数字化平台的智能助手，运行在一个 CesiumJS 三维数字孪生场景里。

你面对的是小区真实台账数据（24 栋建筑、17 栋住宅楼、609 户、13 段地下管线、41 个 IoT 测点）。

你的能力有两类，请自行判断该用哪一类：
【A. 操控三维场景】当用户想"看/定位/显示/统计/展开/高亮/切换"时，调用相应工具。
   - 只能调用给定工具清单里的函数，不要臆造函数名或参数。
   - 用户用中文说楼栋（如"7 号楼"），buildingId 原样传中文即可，系统会自动映射到编号。
   - 一次可以调用多个工具完成复合指令（例如"飞到 3 号楼并把楼层展开" = selectBuilding + expandFloors）。
   - 调用工具后，再用一句简短中文说明你做了什么，不要重复罗列参数。
【B. 物业知识问答】当用户问"怎么做/流程/标准/时限/收费"时，会给你检索到的知识库片段。
   - 严格依据给定片段回答，不要编造条款、数字或电话。
   - 回答末尾用"来源：《文档名》章节"标注引用。
   - 如果片段不足以回答，明确说明"知识库中没有相关规定"，并建议咨询物业（010-6789 5000）。

通用要求：中文回答；语气专业简洁；涉及数字要准确；不确定就说不确定。`

/* -------------------------------------------------------------------------- */
/* 模型调用                                                                    */
/* -------------------------------------------------------------------------- */

async function callOpenAiCompatible({ baseUrl, apiKey, model, messages, tools, maxTokens }) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      tools: tools && tools.length ? tools : undefined,
      tool_choice: tools && tools.length ? 'auto' : undefined,
      temperature: config.llm.temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(config.llm.timeoutMs),
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`模型接口返回 ${res.status}：${text.slice(0, 400)}`)
    err.status = res.status
    throw err
  }
  const data = JSON.parse(text)
  const choice = data.choices?.[0]
  return {
    content: choice?.message?.content || '',
    reasoning: choice?.message?.reasoning_content || '',
    toolCalls: choice?.message?.tool_calls || [],
    finishReason: choice?.finish_reason,
    usage: data.usage,
    model: data.model,
  }
}

async function callOllama({ baseUrl, model, messages, tools, maxTokens }) {
  const res = await fetch(`${String(baseUrl).replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      tools: tools && tools.length ? tools : undefined,
      stream: false,
      options: { temperature: config.llm.temperature, num_predict: maxTokens },
    }),
    signal: AbortSignal.timeout(config.llm.timeoutMs),
  })
  const data = await res.json()
  const msg = data.message || {}
  return {
    content: msg.content || '',
    reasoning: '',
    toolCalls: (msg.tool_calls || []).map((t, i) => ({
      id: `ollama-${i}`,
      function: { name: t.function?.name, arguments: JSON.stringify(t.function?.arguments || {}) },
    })),
    finishReason: data.done ? 'stop' : 'length',
    usage: { total_tokens: data.eval_count },
    model,
  }
}

/**
 * 带降级的模型调用：flash 模型名不可用 / 输出被 max_tokens 截断时，
 * 自动换兜底模型并加大预算重试一次。
 */
async function callLlm({ messages, tools, maxTokens = config.llm.maxTokens }) {
  const target = resolveLlm()
  if (target.provider === 'offline') {
    const e = new Error('未配置大模型')
    e.offline = true
    throw e
  }
  const invoke = (t, budget, msgs = messages) =>
    t.provider === 'ollama'
      ? callOllama({ ...t, messages: msgs, tools, maxTokens: budget })
      : callOpenAiCompatible({ ...t, messages: msgs, tools, maxTokens: budget })

  try {
    const r = await invoke(target, maxTokens)
    // 思维链模型可能把预算吃光，导致工具调用没输出完
    if (r.finishReason === 'length' && !r.toolCalls.length && !r.content) {
      const fallback = config.llm.fallbackModel || 'deepseek-chat'
      if (fallback !== target.model) {
        console.warn(`[agent] ${target.model} 输出被截断，回退 ${fallback}`)
        return { ...(await invoke({ ...target, model: fallback }, maxTokens * 2)), fellBackTo: fallback }
      }
    }
    return r
  } catch (e) {
    const fallback = config.llm.fallbackModel || 'deepseek-chat'
    if (target.provider !== 'ollama' && fallback && fallback !== target.model && (e.status === 400 || e.status === 404)) {
      console.warn(`[agent] 模型 ${target.model} 不可用（${e.status}），回退 ${fallback}`)
      return { ...(await invoke({ ...target, model: fallback }, maxTokens)), fellBackTo: fallback }
    }
    throw e
  }
}

/* -------------------------------------------------------------------------- */
/* 统计与场景事实（供模型参考 + 离线回答）                                     */
/* -------------------------------------------------------------------------- */

function statFacts(data, metric, scope, days) {
  const s = computeStats(metric, scope, days, data.statsInput)
  return s
}

/** 把关键业务事实压缩成给模型的上下文 */
function sceneFacts(data, context) {
  const residential = data.property.buildings.filter((b) => b.type === 'residential')
  const worst = residential.slice().sort((a, b) => a.occupancyRate - b.occupancyRate)
  const pipeRisk = data.pipes.features
    .map((f) => f.properties)
    .sort((a, b) => a.health - b.health)
    .slice(0, 3)
  return {
    小区: `${data.site.name}（${data.site.city}）`,
    楼栋: {
      总数: data.property.buildings.length,
      住宅: residential.length,
      总户数: residential.reduce((s, b) => s + b.units, 0),
      入住率最低: worst.slice(0, 3).map((b) => `${b.name} ${(b.occupancyRate * 100).toFixed(1)}%`),
      入住率最高: worst.slice(-2).map((b) => `${b.name} ${(b.occupancyRate * 100).toFixed(1)}%`),
    },
    管网: {
      段数: data.pipes.features.length,
      总长米: Math.round(data.pipes.features.reduce((s, f) => s + f.properties.length, 0)),
      健康度最差: pipeRisk.map((p) => `${p.name}（${p.health}，${p.age}年，${p.material}）`),
    },
    告警: {
      总数: data.alarms.alarms.length,
      最近: data.alarms.alarms.slice(0, 3).map((a) => `${a.ts} ${a.message}`),
    },
    当前视图: context || {},
  }
}

/* -------------------------------------------------------------------------- */
/* 主入口                                                                      */
/* -------------------------------------------------------------------------- */

export function createAgent({ data, knowledge }) {
  /** 知识检索 */
  async function retrieve(question) {
    const hits = await knowledge.search(question)
    return hits.map((h) => ({
      chunkId: h.chunkId,
      docId: h.docId,
      title: h.title,
      section: h.section,
      text: h.text,
      score: Number((h.score ?? 0).toFixed(4)),
    }))
  }

  /**
   * 处理一次对话
   * @param {{message:string, history?:Array, context?:object, toolResults?:Array, followUp?:boolean}} input
   */
  async function chat(input) {
    const started = Date.now()
    const message = String(input.message || '').trim()
    const history = Array.isArray(input.history) ? input.history.slice(-8) : []
    const context = input.context || {}
    const target = resolveLlm()

    if (!message) return { route: 'knowledge', reply: '请描述你要做什么，或要问什么。', sources: [], sceneCommands: [], provider: 'local' }

    /* ---------- 第二轮：带着工具执行结果让模型说结语 ---------- */
    if (input.followUp && Array.isArray(input.toolResults)) {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message },
        {
          role: 'user',
          content:
            `系统已执行以下场景命令，结果如下（JSON）：\n${JSON.stringify(input.toolResults).slice(0, 4000)}\n` +
            '请基于执行结果，用 1~3 句中文向用户说明结果。若数据中有具体数字（用量、入住率、健康度、告警数等），要准确引用。不要输出 JSON。',
        },
      ]
      try {
        const r = await callLlm({ messages, tools: null })
        return { route: 'action', reply: r.content || '已完成场景操作。', sources: [], sceneCommands: [], provider: target.provider, model: r.model || target.model, elapsedMs: Date.now() - started }
      } catch {
        return { route: 'action', reply: '已完成场景操作。', sources: [], sceneCommands: [], provider: 'local', elapsedMs: Date.now() - started }
      }
    }

    /* ---------- 知识检索（无论哪条通道都先检索，便于混合回答） ---------- */
    let hits = []
    try {
      hits = await retrieve(message)
    } catch (e) {
      console.warn('[agent] 检索失败：', e.message)
    }
    const sources = hits.map((h) => ({ docId: h.docId, title: h.title, section: h.section, score: h.score }))

    /* ---------- 调用模型 ---------- */
    const facts = sceneFacts(data, context)
    const knowledgeBlock = hits.length
      ? hits.map((h, i) => `【片段${i + 1}】《${h.title}》${h.section}\n${h.text}`).join('\n\n')
      : '（未检索到相关知识库片段）'

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content:
          `【小区实时台账】\n${JSON.stringify(facts, null, 1)}\n\n` +
          `【知识库检索片段】\n${knowledgeBlock}\n\n` +
          '如果用户是在提问物业制度类问题，请依据上面的片段回答并标注来源；' +
          '如果用户是在要求操控三维场景，请直接调用工具，不要只做文字回答。',
      },
      ...history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
      { role: 'user', content: message },
    ]

    try {
      const r = await callLlm({ messages, tools: toolSchemaForLlm() })
      const commands = r.toolCalls
        .map((tc) => {
          let params = {}
          try {
            params = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : tc.function.arguments || {}
          } catch {
            params = {}
          }
          const known = [...TOOLS.bridge, ...TOOLS.domain].some((t) => t.name === tc.function.name)
          return { action: tc.function.name, params, reason: known ? '' : '未知命令（将被忽略）' }
        })
        .filter((c) => c.action)

      const route = commands.length ? (r.content && hits.length ? 'mixed' : 'action') : 'knowledge'

      return {
        route,
        reply: r.content || (commands.length ? `已按你的要求下发 ${commands.length} 个场景操作。` : '我没有理解这个请求，可以换个说法，或问我物业制度类问题。'),
        sources: commands.length && !hits.length ? [] : sources,
        sceneCommands: commands,
        continueWithResults: commands.length > 0,
        provider: target.provider,
        model: r.fellBackTo || r.model || target.model,
        retrieved: hits.length,
        elapsedMs: Date.now() - started,
      }
    } catch (e) {
      /* ---------- 降级：离线规则解析 ---------- */
      const offline = offlineAnswer({ message, hits, sources, data, started, error: e })
      return offline
    }
  }

  /** 无模型时的本地通道 */
  function offlineAnswer({ message, hits, sources, data, started, error }) {
    const needAction = looksLikeAction(message)
    const parsed = parseIntent(message, data)

    if (parsed.route === 'action' && parsed.commands.length) {
      return {
        route: 'action',
        reply: parsed.reply,
        sources: [],
        sceneCommands: parsed.commands,
        continueWithResults: false,
        provider: 'offline',
        model: null,
        retrieved: 0,
        offline: true,
        elapsedMs: Date.now() - started,
      }
    }

    // 纯知识问答：把检索到的片段整理成答案（离线摘要式回答）
    if (hits.length) {
      const top = hits.slice(0, 3)
      const digest = top
        .map((h) => {
          const body = h.text.replace(/\n{2,}/g, '\n').split('\n').filter((l) => l.trim() && !/^\|?\s*-{3,}/.test(l))
          return `**${h.title} · ${h.section}**\n${body.slice(0, 6).join('\n')}`
        })
        .join('\n\n')
      return {
        route: 'knowledge',
        reply:
          `（当前为离线检索模式：未配置或未能调用大模型${error ? `，原因：${String(error.message || error).slice(0, 120)}` : ''}）\n\n` +
          `为你检索到 ${hits.length} 段相关内容：\n\n${digest}\n\n` +
          '以上为知识库原文摘录。配置 LLM_API_KEY 后，可由模型生成更自然、更凝练的回答。',
        sources,
        sceneCommands: [],
        continueWithResults: false,
        provider: 'offline',
        model: null,
        retrieved: hits.length,
        offline: true,
        elapsedMs: Date.now() - started,
      }
    }

    return {
      route: needAction ? 'action' : 'knowledge',
      reply:
        `（离线规则模式）我没能识别这条指令。可以试试：\n` +
        '• 飞到 7 号楼，把它的楼层展开\n• 切到地下看看给水管线\n• 统计小区近 7 天用水量并出图\n• 哪栋楼入住率最低\n' +
        '或者问物业知识：燃气泄漏怎么处置、报修多久到场、车位费怎么收。',
      sources: [],
      sceneCommands: [],
      continueWithResults: false,
      provider: 'offline',
      model: null,
      retrieved: 0,
      offline: true,
      elapsedMs: Date.now() - started,
    }
  }

  /** 供 /api/agent/info 使用的能力描述 */
  function info() {
    const target = resolveLlm()
    return {
      provider: target.provider,
      model: target.model,
      baseUrl: target.baseUrl || null,
      fallbackModel: config.llm.fallbackModel,
      rag: { mode: knowledge.mode, ...knowledge.size, topK: config.rag.topK },
      commands: { total: TOOLS.total, bridge: TOOLS.bridge.length, domain: TOOLS.domain.length },
      endpoints: {
        chat: 'POST /api/agent/chat',
        info: 'POST /api/agent/info',
        tools: 'GET /api/agent/tools',
        knowledgeSearch: 'POST /api/knowledge/search',
        sceneCommand: 'POST /api/scene/command',
        mcpHttp: 'POST /api/mcp',
        ws: 'WS /ws?session=demo&role=browser',
      },
    }
  }

  return { chat, info, retrieve, statFacts }
}
