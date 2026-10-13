<script setup>
/**
 * AI 助手对话面板
 * ---------------------------------------------------------------------------
 * 双模式统一入口：
 *   · 系统操控 —— 后端把自然语言翻译成命令队列，前端交给 cesium-mcp-bridge
 *     与领域命令执行，场景实时响应；执行结果回传后模型再给结语。
 *   · 知识问答 —— 后端做 RAG 检索（Qdrant/BM25）+ 生成，返回答案与引用来源。
 * 面板会显示本轮走的是哪条通道、命中了哪些命令、引用了哪些文档。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { fmt } from '../lib/util.js'

const props = defineProps({
  open: { type: Boolean, default: true },
  store: { type: Object, required: true },
  service: { type: Object, default: null },
  commands: { type: Object, default: () => ({ bridge: [], domain: [], total: 43 }) },
})
const emit = defineEmits(['send', 'toggle'])

const input = ref('')
const listEl = ref(null)

const messages = computed(() => props.store.messages)
const pending = computed(() => props.store.pending)
const showSuggestions = computed(() => messages.value.length <= 2)

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 极简 Markdown 渲染（加粗 / 行内代码 / 列表 / 换行），避免引入额外依赖 */
function render(text) {
  let s = esc(text || '')
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|\n)[-*]\s+/g, '$1• ')
  s = s.replace(/([A-Za-z]+[A-Za-z0-9]*(?=[\s，。、）)]|$))/g, (m) => {
    return props.commands.bridge.includes(m) || props.commands.domain.includes(m) ? `<span class="cmd">${m}</span>` : m
  })
  return s.replace(/\n/g, '<br/>')
}

function submit() {
  const text = input.value.trim()
  if (!text || pending.value) return
  emit('send', text)
  input.value = ''
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

watch(
  () => [messages.value.length, pending.value],
  async () => {
    await nextTick()
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  },
)

const routeLabel = computed(() => {
  const r = props.store.messages.filter((m) => m.meta).slice(-1)[0]?.meta
  if (!r) return null
  return { action: '系统操控 (MCP)', knowledge: '知识问答 (RAG)', mixed: '操控 + 问答' }[r.route] || r.route
})

const providerText = computed(() => {
  const c = props.store.capability
  if (!c.ready) return '后端未连接'
  if (c.provider === 'offline') return '离线规则引擎 + BM25'
  return `${c.provider} · ${c.model || ''}`.trim()
})
</script>

<template>
  <section class="panel chat" :class="{ collapsed: !open }">
    <div class="chat-head" @click="!open && emit('toggle')">
      <div class="panel-title">
        <span class="ico">🤖</span>
        <div class="head-main">
          <strong>AI 助手</strong>
          <span class="muted">{{ providerText }}</span>
        </div>
      </div>
      <div class="head-right">
        <span class="tag" :title="`共 ${commands.total} 个命令`">{{ commands.total }} 命令</span>
        <button class="icon-btn" :title="open ? '收起' : '展开'" @click.stop="emit('toggle')">{{ open ? '—' : '▲' }}</button>
      </div>
    </div>

    <template v-if="open">
      <div ref="listEl" class="msg-list scroll-y">
        <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
          <div class="bubble" :class="{ error: m.error }">
            <div class="text" v-html="render(m.text || (pending && m.role === 'assistant' && !m.text ? '正在思考…' : ''))"></div>

            <!-- 命令执行轨迹 -->
            <div v-if="m.steps && m.steps.length" class="steps">
              <div v-for="(s, i) in m.steps" :key="i" class="step" :class="{ fail: !s.ok }">
                <span class="s-ico">{{ s.ok ? '✓' : '✕' }}</span>
                <span class="s-act mono">{{ s.action }}</span>
                <span v-if="s.reason" class="s-reason muted">{{ s.reason }}</span>
              </div>
            </div>

            <!-- RAG 引用来源 -->
            <div v-if="m.sources && m.sources.length" class="sources">
              <span class="src-label">📚 引用来源</span>
              <div v-for="(s, i) in m.sources" :key="i" class="src">
                <span class="src-title">{{ s.title }}</span>
                <span class="src-meta muted mono">{{ s.docId }} · 相似度 {{ (s.score ?? 0).toFixed(3) }}</span>
              </div>
            </div>

            <div v-if="m.meta" class="meta muted mono">
              {{ routeLabel || m.meta.route }} · {{ m.meta.provider }}{{ m.meta.model ? ' / ' + m.meta.model : '' }}
              <template v-if="m.meta.elapsedMs"> · {{ m.meta.elapsedMs }} ms</template>
              <template v-if="m.meta.retrieved"> · 命中 {{ m.meta.retrieved }} 段</template>
            </div>
          </div>
          <span class="time mono">{{ fmt.time(new Date(m.at)) }}</span>
        </div>
      </div>

      <div v-if="showSuggestions" class="suggestions">
        <button v-for="s in store.suggestions" :key="s" class="sug" :disabled="pending" @click="emit('send', s)">
          {{ s }}
        </button>
      </div>

      <div class="chat-foot">
        <textarea
          v-model="input"
          rows="2"
          :disabled="pending"
          placeholder="说一句话操控场景，或问一个物业问题…&#10;例如：飞到 7 号楼并把楼层展开 / 燃气泄漏怎么处置"
          @keydown="onKeydown"
        ></textarea>
        <button class="send" :disabled="pending || !input.trim()" @click="submit">
          {{ pending ? '执行中…' : '发送' }}
        </button>
      </div>
      <div class="foot-hint muted">Enter 发送 · Shift+Enter 换行 · 命令由 cesium-mcp-bridge 执行</div>
    </template>
  </section>
</template>

<style scoped>
.chat {
  position: absolute;
  right: 16px;
  bottom: 72px;
  width: 392px;
  display: flex;
  flex-direction: column;
  z-index: 48;
  overflow: hidden;
}
.chat.collapsed {
  width: 260px;
  right: 16px;
  bottom: 72px;
}
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.head-main {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}
.head-main span {
  font-size: 10px;
}
.head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.msg-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  max-height: 44vh;
  min-height: 120px;
}
.msg {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.msg.user {
  align-items: flex-end;
}
.bubble {
  max-width: 96%;
  padding: 9px 11px;
  border-radius: 11px;
  font-size: 12.5px;
  line-height: 1.6;
  background: rgba(148, 163, 184, 0.1);
  border: 1px solid var(--border);
  color: var(--text-1);
}
.msg.user .bubble {
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.24), rgba(56, 189, 248, 0.14));
  border-color: rgba(56, 189, 248, 0.45);
}
.bubble.error {
  border-color: rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.12);
}
.text :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.18);
  font-family: var(--mono);
  font-size: 11.5px;
}
.text :deep(.cmd) {
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.18);
  color: #bae6fd;
  font-family: var(--mono);
  font-size: 11.5px;
}
.time {
  font-size: 9.5px;
  color: var(--text-3);
  padding: 0 4px;
}
.steps {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed var(--border);
}
.step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-2);
}
.step .s-ico {
  color: var(--accent-2);
}
.step.fail .s-ico {
  color: var(--danger);
}
.s-act {
  color: #bae6fd;
}
.s-reason {
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sources {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.src-label {
  font-size: 10.5px;
  color: var(--text-3);
}
.src {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 7px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.08);
  font-size: 11px;
}
.src-title {
  color: var(--text-1);
}
.src-meta {
  font-size: 9.5px;
  white-space: nowrap;
}
.meta {
  margin-top: 7px;
  font-size: 9.5px;
  color: var(--text-3);
}
.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 0 12px 8px;
}
.sug {
  padding: 5px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(148, 163, 184, 0.08);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}
.sug:hover:not(:disabled) {
  border-color: rgba(56, 189, 248, 0.5);
  color: #e0f2fe;
}
.sug:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.chat-foot {
  display: flex;
  gap: 7px;
  padding: 10px 12px 6px;
  border-top: 1px solid var(--border);
}
textarea {
  flex: 1;
  resize: none;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: rgba(7, 12, 22, 0.72);
  color: var(--text-1);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  outline: none;
}
textarea:focus {
  border-color: rgba(56, 189, 248, 0.55);
}
.send {
  align-self: stretch;
  padding: 0 14px;
  border-radius: 9px;
  border: 1px solid rgba(56, 189, 248, 0.5);
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.34), rgba(56, 189, 248, 0.18));
  color: #e0f2fe;
  font-size: 12.5px;
  cursor: pointer;
}
.send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.foot-hint {
  padding: 0 12px 10px;
  font-size: 9.5px;
}
</style>
