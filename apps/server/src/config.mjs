/**
 * 服务端配置：环境变量集中解析
 * ---------------------------------------------------------------------------
 * 所有外部依赖都是"可选"的：不配置任何 Key 也能完整跑通 Demo，
 * 只是 Agent 换成离线规则引擎、检索从向量退化为 BM25。
 * ---------------------------------------------------------------------------
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(__dirname, '../../..')

/** 极简 .env 读取（不引入 dotenv 依赖） */
function loadEnvFile() {
  const p = join(ROOT, '.env')
  if (!existsSync(p)) return
  readFileSync(p, 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
      if (!m) return
      const key = m[1]
      let val = m[2].replace(/^["']|["']$/g, '')
      if (!(key in process.env)) process.env[key] = val
    })
}
loadEnvFile()

const env = (k, d = '') => process.env[k] ?? d
const num = (k, d) => Number(process.env[k] ?? d)

export const config = {
  port: num('PORT', 8787),
  wsPort: num('WS_PORT', 9100),

  paths: {
    root: ROOT,
    data: join(ROOT, 'public', 'data'),
    knowledge: join(ROOT, 'knowledge'),
    webDist: join(ROOT, 'apps', 'web', 'dist'),
  },

  /** 大模型：deepseek / openai / ollama / offline */
  llm: {
    provider: env('LLM_PROVIDER', '').toLowerCase(),
    apiKey: env('LLM_API_KEY') || env('DEEPSEEK_API_KEY') || env('OPENAI_API_KEY'),
    baseUrl: env('LLM_BASE_URL'),
    model: env('LLM_MODEL'),
    temperature: Number(env('LLM_TEMPERATURE', '0.2')),
    maxTokens: num('LLM_MAX_TOKENS', 1200),
    timeoutMs: num('LLM_TIMEOUT_MS', 45000),
  },

  /** 向量检索：qdrant / ollama / openai / lexical(BM25 兜底) */
  rag: {
    topK: num('RAG_TOP_K', 4),
    chunkSize: num('RAG_CHUNK_SIZE', 900),
    chunkOverlap: num('RAG_CHUNK_OVERLAP', 120),
    scoreThreshold: Number(env('RAG_SCORE_THRESHOLD', '0.05')),
    embeddingProvider: env('EMBEDDING_PROVIDER', '').toLowerCase(),
    embeddingModel: env('EMBEDDING_MODEL', 'nomic-embed-text'),
    embeddingBaseUrl: env('EMBEDDING_BASE_URL', 'http://127.0.0.1:11434'),
    embeddingApiKey: env('EMBEDDING_API_KEY') || env('LLM_API_KEY') || env('DEEPSEEK_API_KEY') || env('OPENAI_API_KEY'),
    qdrantUrl: env('QDRANT_URL', 'http://127.0.0.1:6333'),
    qdrantCollection: env('QDRANT_COLLECTION', 'community_property_kb'),
  },
}

/** 推断最终生效的 LLM 提供方 */
export function resolveLlm() {
  const { provider, apiKey, baseUrl } = config.llm
  if (provider === 'offline' || provider === 'none') return { provider: 'offline', model: null }
  if (provider === 'ollama') {
    return { provider: 'ollama', model: config.llm.model || 'qwen2.5:7b', baseUrl: baseUrl || 'http://127.0.0.1:11434' }
  }
  if (provider === 'deepseek') {
    return { provider: 'deepseek', model: config.llm.model || 'deepseek-chat', apiKey, baseUrl: baseUrl || 'https://api.deepseek.com' }
  }
  if (provider === 'openai') {
    return { provider: 'openai', model: config.llm.model || 'gpt-4o-mini', apiKey, baseUrl: baseUrl || 'https://api.openai.com/v1' }
  }
  // 未显式指定：按是否拿到 Key 自动判断
  if (apiKey) {
    if (/deepseek/i.test(baseUrl)) return { provider: 'deepseek', model: config.llm.model || 'deepseek-chat', apiKey, baseUrl }
    return { provider: 'openai', model: config.llm.model || 'gpt-4o-mini', apiKey, baseUrl: baseUrl || 'https://api.openai.com/v1' }
  }
  return { provider: 'offline', model: null }
}
