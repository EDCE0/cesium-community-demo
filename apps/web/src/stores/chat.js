/**
 * 对话状态与 Agent 循环
 * ---------------------------------------------------------------------------
 * 一次用户输入的处理链路：
 *   用户输入 → POST /api/agent/chat（带会话历史 + 场景快照）
 *     ├─ 走"系统操控"：后端返回 sceneCommands 队列，前端逐条 dispatch 到
 *     │  cesium-mcp-bridge / 领域命令，把执行结果回传，再由模型生成结语
 *     └─ 走"知识问答"：后端做 RAG 检索 + 生成，返回答案与引用来源
 * 未配置模型 API Key 时，后端自动降级为本地规则解析 + 本地 BM25 检索，
 * 对话链路完全一致，只是"大脑"从 LLM 换成规则引擎。
 * ---------------------------------------------------------------------------
 */
import { defineStore } from 'pinia'

let seq = 0
const uid = (p) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText} ${text.slice(0, 300)}`)
  }
  return res.json()
}

export const useChatStore = defineStore('chat', {
  state: () => ({
    open: true,
    messages: [
      {
        id: 'welcome',
        role: 'assistant',
        text:
          '你好，我是阳光新城数字孪生平台的智能助手。\n\n我可以做两类事情：\n' +
          '1️⃣ **操控三维场景**：例如"飞到 7 号楼""把 3 号楼楼层展开""切到地下看水管""显示燃气管线并高亮"\n' +
          '2️⃣ **回答物业知识**：例如"燃气泄漏怎么处置""报修多久到场""车位费怎么收"\n\n' +
          '下面有示例指令，点一下就能试。',
        at: Date.now(),
        meta: null,
      },
    ],
    pending: false,
    /** 后端能力探测结果 */
    capability: { provider: 'offline', model: null, rag: true, ready: false },
    suggestions: [
      '飞到 7 号楼，把它的楼层展开',
      '切到地下，看看给水管线的走向',
      '展示燃气管线并高亮，用橙色',
      '统计小区本月用水量，用图表显示',
      '哪栋楼入住率最低？',
      '燃气泄漏怎么应急处置？',
      '3 号楼 12 层有几户，都是什么户型？',
      '哪几段管道需要优先更换？',
    ],
    lastExecuted: [],
  }),

  actions: {
    /** 探测后端能力（模型提供方 / RAG 状态） */
    async probe() {
      try {
        const info = await postJSON('/api/agent/info', {})
        this.capability = { ...this.capability, ...info, ready: true }
      } catch (e) {
        this.capability = { provider: 'offline', model: null, rag: false, ready: false, error: String(e.message || e) }
      }
      return this.capability
    },

    /** 场景快照：让模型知道"现在屏幕上是什么" */
    snapshot(getter) {
      return getter()
    },

    async send(text, ctx) {
      const content = String(text || '').trim()
      if (!content || this.pending) return
      this.messages.push({ id: uid('u'), role: 'user', text: content, at: Date.now() })
      this.pending = true

      const assistant = {
        id: uid('a'),
        role: 'assistant',
        text: '',
        at: Date.now(),
        meta: null,
        actions: [],
        sources: [],
        steps: [],
        error: null,
      }
      this.messages.push(assistant)

      const history = this.messages
        .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.text))
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.text }))

      try {
        const res = await postJSON('/api/agent/chat', {
          message: content,
          history,
          context: ctx.snapshot(),
        })
        assistant.meta = {
          route: res.route,
          provider: res.provider,
          model: res.model,
          elapsedMs: res.elapsedMs,
          retrieved: res.retrieved,
        }
        assistant.text = res.reply || ''
        assistant.sources = res.sources || []

        // 执行场景命令队列（最多 4 轮，允许模型"看着场景继续调"）
        let round = 0
        let queue = res.sceneCommands || []
        while (queue.length && round < 4) {
          round++
          const results = []
          for (const cmd of queue) {
            const started = performance.now()
            try {
              const result = await ctx.dispatch(cmd)
              results.push({ action: cmd.action, ok: true, data: result?.data ?? result, ms: Math.round(performance.now() - started) })
              assistant.steps.push({ action: cmd.action, params: cmd.params, ok: true, reason: cmd.reason || '' })
            } catch (e) {
              results.push({ action: cmd.action, ok: false, error: String(e.message || e), ms: Math.round(performance.now() - started) })
              assistant.steps.push({ action: cmd.action, params: cmd.params, ok: false, error: String(e.message || e), reason: cmd.reason || '' })
            }
          }
          this.lastExecuted = results

          if (!res.continueWithResults) break
          const follow = await postJSON('/api/agent/chat', {
            message: content,
            history,
            context: ctx.snapshot(),
            toolResults: results,
            followUp: true,
          })
          if (follow.reply) assistant.text = follow.reply
          if (follow.sources?.length) assistant.sources = follow.sources
          assistant.meta = { ...assistant.meta, ...{ route: follow.route, provider: follow.provider, model: follow.model } }
          queue = follow.sceneCommands || []
        }
        if (!assistant.text) assistant.text = '好的，已按你的要求调整场景。'
      } catch (e) {
        assistant.error = String(e.message || e)
        assistant.text = '对话服务暂时不可用（可能是后端未启动）。你可以先直接用左侧图层面板操作场景。'
      } finally {
        this.pending = false
      }
    },

    clear() {
      this.messages = this.messages.filter((m) => m.id === 'welcome')
    },
  },
})
