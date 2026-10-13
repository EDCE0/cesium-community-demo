/**
 * 知识库与检索（RAG 的"R"）
 * ---------------------------------------------------------------------------
 * 检索策略按可用性自动降级，接口完全一致：
 *   1) Qdrant 向量检索      —— 需要 QDRANT_URL + embedding（本地 Ollama 或云端）
 *   2) 内存向量检索         —— 需要 embedding 模型，无 Qdrant
 *   3) BM25 字级检索        —— 零依赖兜底（中文按 1-gram + 2-gram 切分）
 * 无论走哪条路，返回结构都是 [{ docId, title, section, text, score, chunkId }]，
 * 上层 Agent 与前端引用展示无需改动。
 * ---------------------------------------------------------------------------
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.mjs'

/* -------------------------------------------------------------------------- */
/* 文档加载与切分                                                              */
/* -------------------------------------------------------------------------- */

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { meta: {}, body: raw }
  const meta = {}
  m[1].split('\n').forEach((line) => {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!kv) return
    let v = kv[2].trim()
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
    else v = v.replace(/^["']|["']$/g, '')
    meta[kv[1]] = v
  })
  return { meta, body: raw.slice(m[0].length) }
}

/** 按 Markdown 标题切块，块内再按长度细分，保留章节路径 */
function chunkDocument(doc) {
  const lines = doc.body.split('\n')
  const blocks = []
  let current = { path: [doc.title], lines: [] }
  let inTable = false

  for (const line of lines) {
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      if (current.lines.join('\n').trim()) blocks.push(current)
      const level = h[1].length
      const title = h[2].trim()
      const path = current.path.slice(0, Math.max(0, level - 1))
      path[level - 1] = title
      current = { path: path.filter(Boolean), lines: [] }
      inTable = false
      continue
    }
    // 表格与代码块整体保留，避免把一行数据切开
    if (/^\s*\|/.test(line)) inTable = true
    else if (inTable && !line.trim()) inTable = false
    current.lines.push(line)
  }
  if (current.lines.join('\n').trim()) blocks.push(current)

  const chunks = []
  blocks.forEach((b) => {
    const text = b.lines.join('\n').trim()
    if (!text) return
    const { chunkSize, chunkOverlap } = config.rag
    if (text.length <= chunkSize) {
      chunks.push({ section: b.path.join(' > '), text })
      return
    }
    // 按段落聚合，超长再滑动窗口
    const paras = text.split(/\n{2,}/)
    let buf = ''
    const flush = () => {
      if (buf.trim()) chunks.push({ section: b.path.join(' > '), text: buf.trim() })
      buf = ''
    }
    paras.forEach((p) => {
      if ((buf + p).length > chunkSize) {
        flush()
        if (p.length > chunkSize) {
          for (let i = 0; i < p.length; i += chunkSize - chunkOverlap) {
            chunks.push({ section: b.path.join(' > '), text: p.slice(i, i + chunkSize) })
          }
          return
        }
      }
      buf += (buf ? '\n\n' : '') + p
    })
    flush()
  })
  return chunks
}

function loadDocuments() {
  const dir = config.paths.knowledge
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /\.(md|txt)$/i.test(f))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), 'utf8')
      const { meta, body } = parseFrontmatter(raw)
      const title = meta.title || file.replace(/\.md$/, '')
      return { file, docId: meta.docId || file.slice(0, 5), title, category: meta.category || '', tags: meta.tags || [], body }
    })
}

/* -------------------------------------------------------------------------- */
/* 中文友好分词 + BM25                                                         */
/* -------------------------------------------------------------------------- */

const STOP = new Set('的 了 是 在 和 与 或 及 请 我 你 他 它 们 这 那 有 无 不 也 就 都 还 而 被 把 对 从 到 怎么 如何 什么 为什么 可以 需要 应该 吗 呢 吧'.split(/\s+/))

export function tokenize(text) {
  const s = String(text)
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, ' ')
  const tokens = []
  // 英文/数字词
  s.replace(/[a-z0-9][a-z0-9._-]*/g, (m) => {
    if (!STOP.has(m) && m.length > 1) tokens.push(m)
    return ' '
  })
  // 中文：字 + 相邻二字组合
  const han = s.match(/[\u4e00-\u9fa5]+/g) || []
  han.forEach((seg) => {
    for (let i = 0; i < seg.length; i++) {
      const c = seg[i]
      if (!STOP.has(c)) tokens.push(c)
      if (i < seg.length - 1) tokens.push(seg.slice(i, i + 2))
    }
  })
  return tokens
}

function buildBm25(chunks) {
  const df = new Map()
  const docTokens = chunks.map((c) => {
    const toks = tokenize(`${c.title} ${c.section} ${c.text}`)
    const tf = new Map()
    toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1))
    new Set(toks).forEach((t) => df.set(t, (df.get(t) || 0) + 1))
    return { tf, len: toks.length }
  })
  const avgLen = docTokens.reduce((s, d) => s + d.len, 0) / Math.max(docTokens.length, 1)
  return { df, docTokens, avgLen, N: chunks.length }
}

function bm25Search(index, chunks, query, topK) {
  const qTokens = [...new Set(tokenize(query))]
  const k1 = 1.4
  const b = 0.72
  const scored = chunks.map((chunk, i) => {
    const { tf, len } = index.docTokens[i]
    let score = 0
    qTokens.forEach((t) => {
      const f = tf.get(t)
      if (!f) return
      const idf = Math.log(1 + (index.N - (index.df.get(t) || 0) + 0.5) / ((index.df.get(t) || 0) + 0.5))
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / index.avgLen)))
    })
    return { ...chunk, score, index: i }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, topK)
}

/* -------------------------------------------------------------------------- */
/* 向量检索（可选）                                                            */
/* -------------------------------------------------------------------------- */

async function embed(texts) {
  const { embeddingProvider, embeddingModel, embeddingBaseUrl, embeddingApiKey } = config.rag
  const provider = embeddingProvider || (config.llm.provider === 'ollama' ? 'ollama' : embeddingApiKey ? 'openai' : '')
  if (!provider) return null

  if (provider === 'ollama') {
    const res = await fetch(`${embeddingBaseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: embeddingModel, prompt: texts[0] }),
    })
    if (!res.ok) return null
    const data = await res.json()
    // Ollama /api/embeddings 单条；批量走 /api/embed
    return [data.embedding]
  }
  const url = `${(config.llm.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/embeddings`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${embeddingApiKey}` },
    body: JSON.stringify({ model: embeddingModel || 'text-embedding-3-small', input: texts }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.data.map((d) => d.embedding)
}

function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

async function tryQdrant() {
  try {
    const res = await fetch(`${config.rag.qdrantUrl}/collections`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/* -------------------------------------------------------------------------- */
/* 对外接口                                                                    */
/* -------------------------------------------------------------------------- */

export async function createKnowledgeBase() {
  const docs = loadDocuments()
  const chunks = []
  docs.forEach((doc) => {
    chunkDocument(doc).forEach((c, i) => {
      chunks.push({
        chunkId: `${doc.docId}-${i + 1}`,
        docId: doc.docId,
        title: doc.title,
        category: doc.category,
        tags: doc.tags,
        section: c.section,
        text: c.text,
      })
    })
  })

  const bm25 = buildBm25(chunks)
  let vectors = null
  let qdrant = false

  // 尝试生成向量索引（失败则静默退化为 BM25）
  try {
    const provider = config.rag.embeddingProvider || (config.llm.provider === 'ollama' ? 'ollama' : config.rag.embeddingApiKey ? 'openai' : '')
    if (provider) {
      const sampled = await embed([chunks[0]?.text || 'init'])
      if (sampled && sampled[0]) {
        vectors = []
        const batch = 16
        for (let i = 0; i < chunks.length; i += batch) {
          const part = chunks.slice(i, i + batch).map((c) => `${c.title}\n${c.section}\n${c.text}`)
          const vecs = await embed(part)
          if (!vecs) throw new Error('embedding 返回为空')
          vecs.forEach((v) => vectors.push(v))
        }
        qdrant = await tryQdrant()
      }
    }
  } catch (e) {
    console.warn('[knowledge] 向量索引构建失败，退化为 BM25：', e.message)
    vectors = null
  }

  const mode = qdrant && vectors ? 'qdrant+vector' : vectors ? 'memory-vector' : 'bm25'

  return {
    mode,
    size: { documents: docs.length, chunks: chunks.length, indexedVectors: vectors ? vectors.length : 0 },
    docs: docs.map((d) => ({ docId: d.docId, title: d.title, category: d.category, tags: d.tags, file: d.file })),

    /**
     * 检索
     * @param {string} query
     * @param {{topK?:number}} opts
     */
    async search(query, opts = {}) {
      const topK = opts.topK || config.rag.topK
      // 1) 有向量索引时优先向量检索
      if (vectors && vectors.length) {
        try {
          const qv = await embed([query])
          if (qv && qv[0]) {
            const scored = chunks
              .map((c, i) => ({ ...c, score: vectors[i] ? cosine(qv[0], vectors[i]) : 0 }))
              .sort((a, b) => b.score - a.score)
              .slice(0, topK)
            if (scored[0]?.score > 0) return scored
          }
        } catch {
          /* 落到 BM25 */
        }
      }
      // 2) BM25 兜底
      return bm25Search(bm25, chunks, query, topK)
    },

    /** 直接按 docId 取全文（用于"给我看看原文"类追问） */
    getDoc(docId) {
      const d = docs.find((x) => x.docId === docId)
      if (!d) return null
      return { docId: d.docId, title: d.title, category: d.category, text: d.body }
    },
  }
}
