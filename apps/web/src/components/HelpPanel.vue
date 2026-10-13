<script setup>
/**
 * 帮助面板：Agent 命令清单（19 个 MCP 内置 + 24 个市政领域扩展）、
 * 技术栈说明与常见演示脚本。
 */
import { ref, computed } from 'vue'
import { DOMAIN_COMMAND_SCHEMAS, BRIDGE_COMMANDS, DOMAIN_COMMAND_NAMES, TOTAL_COMMANDS } from '../commands/registry.js'

defineEmits(['close'])

const tab = ref('domain')

const BRIDGE_DOC = {
  flyTo: '飞到指定经纬度与高度（可带 heading/pitch/roll）',
  setView: '瞬间设置相机位置与姿态',
  getView: '读取当前相机状态',
  zoomToExtent: '缩放到指定经纬度范围',
  addGeoJsonLayer: '加载 GeoJSON 图层（支持分级/分类配色）',
  addHeatmap: '生成热力图图层',
  addMarker: '添加点标记',
  addLabel: '批量添加文字标注',
  removeLayer: '移除图层',
  setLayerVisibility: '显示/隐藏图层',
  listLayers: '列出全部图层',
  updateLayerStyle: '动态调整图层样式（颜色/透明度/线宽）',
  setBasemap: '切换底图（dark / satellite / standard / 自定义）',
  highlight: '高亮图层中的要素',
  load3dTiles: '加载 3D Tiles（BIM / 倾斜摄影）',
  loadTerrain: '切换地形服务',
  loadImageryService: '挂载 WMS / WMTS / XYZ / ArcGIS 影像服务',
  playTrajectory: '沿路径播放实体动画（巡检、抢修车辆）',
  screenshot: '截取当前视图为 base64 PNG',
}

const domainList = computed(() =>
  DOMAIN_COMMAND_NAMES.map((name) => ({
    name,
    description: DOMAIN_COMMAND_SCHEMAS[name]?.description || '',
    params: Object.keys(DOMAIN_COMMAND_SCHEMAS[name]?.parameters?.properties || {}),
  })),
)

const DEMOS = [
  { q: '飞到 7 号楼，把它的楼层展开', c: 'flyTo → selectBuilding → expandFloors' },
  { q: '切到地下，看看给水管线的走向', c: 'showUnderground(true) → setPipeFilter(water) → setPipeDepthScale(3)' },
  { q: '显示所有燃气管线，用橙色高亮', c: 'toggleLayer(pipes) → setPipeFilter(gas) → highlight' },
  { q: '统计小区本月用水量，用图表显示', c: 'queryStats(water) → showChart(line)' },
  { q: '哪栋楼入住率最低？', c: 'queryStats(occupancy) → selectBuilding(最低楼栋)' },
  { q: '哪几段管道需要优先更换？', c: 'queryPipeHealth(topN) → showUnderground → highlight' },
  { q: '燃气泄漏怎么应急处置？', c: 'RAG 检索《燃气泄漏应急处置预案》→ 生成答案 + 引用来源' },
]
</script>

<template>
  <div class="help-mask" @click.self="$emit('close')">
    <section class="panel help">
      <div class="panel-head">
        <div class="panel-title"><span class="ico">❔</span>帮助 · Agent 命令与技术架构</div>
        <button class="icon-btn" @click="$emit('close')">✕</button>
      </div>

      <div class="tabs">
        <button :class="{ active: tab === 'domain' }" @click="tab = 'domain'">市政领域命令（24）</button>
        <button :class="{ active: tab === 'bridge' }" @click="tab = 'bridge'">MCP 内置命令（19）</button>
        <button :class="{ active: tab === 'demo' }" @click="tab = 'demo'">演示脚本</button>
        <button :class="{ active: tab === 'arch' }" @click="tab = 'arch'">架构说明</button>
      </div>

      <div class="body scroll-y">
        <template v-if="tab === 'domain'">
          <p class="lead muted">
            共 {{ TOTAL_COMMANDS }} 个命令 = MCP 内置 19 个 + 市政领域扩展 24 个。两者共用同一套调用协议，
            前端对话面板、后端 Agent、外部 MCP 客户端（Claude Desktop / Cursor）走的是同一入口。
          </p>
          <div v-for="c in domainList" :key="c.name" class="cmd-row">
            <div class="cmd-name mono">{{ c.name }}</div>
            <div class="cmd-body">
              <div class="cmd-desc">{{ c.description }}</div>
              <div v-if="c.params.length" class="cmd-params">
                <span v-for="p in c.params" :key="p" class="tag">{{ p }}</span>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="tab === 'bridge'">
          <p class="lead muted">
            来自 <b>cesium-mcp-bridge@1.139.0</b>，由 <code>CesiumBridge.execute({action, params})</code> 原生执行，
            与 <b>cesium-mcp-runtime</b> 的 MCP 工具定义一一对应。
          </p>
          <div v-for="n in BRIDGE_COMMANDS" :key="n" class="cmd-row">
            <div class="cmd-name mono">{{ n }}</div>
            <div class="cmd-body"><div class="cmd-desc">{{ BRIDGE_DOC[n] }}</div></div>
          </div>
        </template>

        <template v-else-if="tab === 'demo'">
          <p class="lead muted">对着右下角对话面板说这些话，即可验证"自然语言 → 场景响应"闭环。</p>
          <div v-for="d in DEMOS" :key="d.q" class="demo-row">
            <div class="demo-q">「{{ d.q }}」</div>
            <div class="demo-c mono muted">{{ d.c }}</div>
          </div>
          <div class="note">
            <b>没配模型也能演示：</b>后端未检测到 API Key 时，会自动降级为本地规则解析 + BM25 检索，
            上述指令依然可用，只是措辞需要更贴近示例。
          </div>
        </template>

        <template v-else>
          <div class="arch">
            <pre class="ascii mono">用户自然语言
   │
   ▼
[Agent 服务]  route: action | knowledge
   ├── action ──► 命令队列 {action, params}
   │                 │
   │                 ▼
   │        WebSocket(:9100) / 前端直连
   │                 │
   │                 ▼
   │        cesium-mcp-bridge → Cesium Viewer
   └── knowledge ─► 检索(向量/BM25) → LLM 生成 → 答案 + 引用</pre>
            <ul class="facts">
              <li><b>三维引擎：</b>CesiumJS 1.139（本地资源，无 CDN、无 Ion Key）</li>
              <li><b>AI 操控层：</b>cesium-mcp-bridge 1.139 + cesium-mcp-runtime 1.139（真实 npm 包）</li>
              <li><b>前端：</b>Vue 3 + Vite 5 + Pinia + ECharts 5</li>
              <li><b>后端：</b>Node + Express + ws，提供 /api/agent、/api/stats、/ws 与 MCP stdio 三种入口</li>
              <li><b>RAG：</b>9 篇物业制度文档，支持 Qdrant 向量检索；离线时自动退化为 BM25</li>
              <li><b>数据：</b>程序化生成小区场景（24 栋楼 / 609 户 / 13 段管线 / 41 个 IoT 点位），可切换真实 OSM 数据</li>
            </ul>
            <div class="note">
              <b>工程化替换点：</b>楼层分层的"抽屉式"实现未使用 3D Tiles；若后续用 Blender 按层拆分并导出
              分层 3D Tiles，只需替换 <code>createFloorViewer</code>，命令协议与前端交互无需改动。
            </div>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.help-mask {
  position: absolute;
  inset: 0;
  background: rgba(4, 8, 16, 0.6);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  z-index: 80;
}
.help {
  width: min(880px, 92vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
}
.tabs {
  display: flex;
  gap: 5px;
  padding: 11px 13px 0;
}
.tabs button {
  padding: 5px 11px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: rgba(148, 163, 184, 0.08);
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}
.tabs button.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.5);
  color: #e0f2fe;
}
.body {
  padding: 12px 14px 18px;
  max-height: 66vh;
}
.lead {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.7;
}
.lead code,
.note code {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.16);
  font-family: var(--mono);
  font-size: 11px;
}
.cmd-row {
  display: flex;
  gap: 12px;
  padding: 7px 9px;
  border-radius: 8px;
}
.cmd-row:nth-child(odd) {
  background: rgba(148, 163, 184, 0.05);
}
.cmd-name {
  min-width: 168px;
  font-size: 12px;
  color: #7dd3fc;
}
.cmd-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cmd-desc {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.55;
}
.cmd-params {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.demo-row {
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px solid var(--border);
  margin-bottom: 8px;
}
.demo-q {
  font-size: 13px;
  color: var(--text-1);
}
.demo-c {
  margin-top: 3px;
  font-size: 11px;
}
.note {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 9px;
  background: rgba(56, 189, 248, 0.09);
  border: 1px solid rgba(56, 189, 248, 0.28);
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-2);
}
.ascii {
  font-size: 11.5px;
  line-height: 1.7;
  color: #a5d8ff;
  background: rgba(7, 12, 22, 0.7);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 13px 15px;
  overflow-x: auto;
}
.facts {
  margin: 14px 0 0;
  padding-left: 20px;
  font-size: 12.5px;
  line-height: 1.9;
  color: var(--text-2);
}
</style>
