/**
 * MCP stdio 服务：让外部 AI 客户端（Claude Desktop / Cursor / VS Code）
 * 直接操控本 Demo 的三维场景
 * ---------------------------------------------------------------------------
 * 架构：
 *   Claude Desktop --MCP stdio--> 本文件 --HTTP--> Demo 服务 --WS--> 浏览器 Cesium
 *
 * 与 cesium-mcp-runtime 的作用相同，但额外多暴露一个 `askAgent` 工具，
 * 让外部客户端也能用自然语言（含知识库问答）驱动场景。
 *
 * 配置示例（Claude Desktop 的 claude_desktop_config.json）：
 * {
 *   "mcpServers": {
 *     "community-twin": {
 *       "command": "node",
 *       "args": ["<项目路径>/apps/server/src/mcp-stdio.mjs"],
 *       "env": { "DEMO_API": "http://127.0.0.1:8787" }
 *     }
 *   }
 * }
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../../..')
const API = process.env.DEMO_API || `http://127.0.0.1:${process.env.PORT || 8787}`
const SESSION = process.env.DEMO_SESSION || 'demo'

const TOOLS = JSON.parse(readFileSync(join(ROOT, 'shared', 'tools.json'), 'utf8'))
const ALL = [...TOOLS.bridge, ...TOOLS.domain]

async function callApi(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`接口 ${path} 返回 ${res.status}：${text.slice(0, 300)}`)
  return JSON.parse(text)
}

/** JSON Schema(简化) → zod 形状；未识别类型退化为可选字符串 */
function toZodShape(schema = {}) {
  const shape = {}
  const props = schema.properties || {}
  const required = new Set(schema.required || [])
  for (const [key, def] of Object.entries(props)) {
    let v
    switch (def.type) {
      case 'number':
      case 'integer':
        v = z.number().describe(def.description || '')
        break
      case 'boolean':
        v = z.boolean().describe(def.description || '')
        break
      case 'array':
        v =
          def.items?.type === 'number'
            ? z.array(z.number()).describe(def.description || '')
            : z.array(z.string()).describe(def.description || '')
        break
      case 'object':
        v = z.record(z.any()).describe(def.description || '')
        break
      default:
        v = def.enum ? z.enum(def.enum).describe(def.description || '') : z.string().describe(def.description || '')
    }
    shape[key] = required.has(key) ? v : v.optional()
  }
  return shape
}

const server = new McpServer({ name: 'community-digital-twin', version: '1.0.0' })

// ---- 43 个场景命令，全部原样注册为 MCP 工具 ----
for (const tool of ALL) {
  server.tool(tool.name, tool.description, toZodShape(tool.parameters), async (args) => {
    const result = await callApi('/api/scene/command', {
      sessionId: SESSION,
      command: { action: tool.name, params: args || {} },
      wait: true,
    })
    return {
      content: [{ type: 'text', text: JSON.stringify(result.results?.[0]?.result ?? result, null, 2) }],
      isError: !result.ok,
    }
  })
}

// ---- 额外：自然语言入口（等价于页面右下角对话框） ----
server.tool(
  'askAgent',
  '用一句自然语言驱动整个系统：即可操控三维场景（如"飞到7号楼并展开楼层"），也可回答物业知识问题（如"燃气泄漏怎么处置"）。',
  { message: z.string().describe('用户的自然语言指令或问题') },
  async ({ message }) => {
    const res = await callApi('/api/agent/chat', { message, context: { source: 'mcp-stdio' } })
    const parts = [res.reply]
    if (res.sceneCommands?.length) {
      parts.push(`\n【已下发场景命令】\n${res.sceneCommands.map((c) => `- ${c.action} ${JSON.stringify(c.params)}`).join('\n')}`)
    }
    if (res.sources?.length) {
      parts.push(`\n【知识库来源】\n${res.sources.map((s) => `- 《${s.title}》${s.section}`).join('\n')}`)
    }
    return { content: [{ type: 'text', text: parts.join('\n') }] }
  },
)

// ---- 资源：相机状态 / 图层 / 知识库清单 ----
server.resource('cesium-camera', 'cesium://scene/camera', { mimeType: 'application/json' }, async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(await callApi('/api/mcp', { method: 'resources/read', params: { uri: 'cesium://scene/camera', session: SESSION } }), null, 2),
    },
  ],
}))

server.resource('cesium-layers', 'cesium://scene/layers', { mimeType: 'application/json' }, async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(await callApi('/api/mcp', { method: 'resources/read', params: { uri: 'cesium://scene/layers', session: SESSION } }), null, 2),
    },
  ],
}))

server.resource('kb-documents', 'kb://documents', { mimeType: 'application/json' }, async (uri) => {
  const res = await fetch(`${API}/api/knowledge/docs`).then((r) => r.json())
  return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(res.documents, null, 2) }] }
})

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[mcp-stdio] 已就绪：${ALL.length + 1} 个工具，后端 API = ${API}`)
