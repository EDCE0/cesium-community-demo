# 阳光新城 · 市政工程数字化 Demo

> CesiumJS 三维数字底板 + AI Agent 自然语言操控（cesium-mcp-bridge / runtime / MCP）+ 私有化 RAG 知识库问答
> 一个可直接演示、也可作为工程化起点的完整项目。

---

## 1. 这个 Demo 验证什么

核心验证目标只有一句话：**AI Agent 能否以自然语言为唯一入口，统一操控三维 GIS 场景与知识问答，形成"看得到、问得到、控得住"的交互体验。**

为此项目实现了三层结构：

```
┌──────────────────────────── 交互层 ────────────────────────────┐
│  右下角 AI 对话框（DeepSeek flash）                             │
│    · 操控意图 → 命令队列 → cesium-mcp-bridge → Cesium 场景响应   │
│    · 知识意图 → RAG 检索 → LLM 生成 → 答案 + 引用来源            │
└───────────────────────────────────────────────────────────────┘
┌──────────────────────────── 能力层 ────────────────────────────┐
│  43 个标准命令（19 个 MCP 内置 + 24 个市政领域扩展）             │
│  HTTP /api · WebSocket /ws · MCP stdio · MCP over HTTP 四种入口 │
└───────────────────────────────────────────────────────────────┘
┌──────────────────────────── 数据层 ────────────────────────────┐
│  24 栋建筑 / 609 户 / 13 段地下管线 / 41 个 IoT 测点 / 9 篇制度  │
└───────────────────────────────────────────────────────────────┘
```

### 已实现的功能

| 模块 | 能力 |
|---|---|
| 三维场景 | 建筑白模（按楼层拉伸）、小区道路、绿地广场、程序化城市底纹（**零在线依赖、不需要天地图/OSM/Cesium Ion 的 Key**） |
| 楼层单体化 | 点击楼栋 → 信息卡 → **楼层"抽屉式"逐层分离**（带升起动画）→ 点楼层显示该层户型/业主/面积 |
| 地下管线 | 给水（蓝）/燃气（橙）/污水（棕）按**真实埋深 1.0–3.4 m** 渲染；一键进入**地下隧道剖切视角**；埋深放大 1–12 倍便于观察 |
| IoT 实时监测 | 41 个测点每 2 s 模拟刷新；越限自动告警；支持**注入人为故障**（燃气泄漏/供水压力骤降/配电过载）演示联动 |
| 统计分析 | 用水/用气/用电趋势、入住率对比、管网健康度（仪表盘+饼图）、告警统计；图表**叠加在三维场景之上**，点击图表可联动相机定位 |
| AI 对话 | 自然语言操控场景 + 物业知识问答；显示命令执行轨迹与知识来源引用 |
| 外部 Agent | Claude Desktop / Cursor 可通过 **MCP** 直接操控该页面；任意程序可通过 HTTP/WS 下发命令 |

---

## 2. 快速开始

### 2.1 环境要求

- Node.js ≥ 20（开发时使用 v24）
- 无需 Docker、无需 Cesium Ion、无需在线地图服务

### 2.2 一键启动（推荐）

```bash
cd <项目目录>
./start.sh
```

脚本会自动完成：复制 `.env` → 安装依赖 → 生成场景数据 → 构建前端 → 启动服务。
启动后终端会打印可访问地址，例如：

```
本机访问：    http://127.0.0.1:8787
局域网/远程： http://192.168.1.20:8787
```

### 2.3 手动分步

```bash
npm install
npm run data:build     # 生成 public/data 下的场景数据
npm run build          # 构建前端 → apps/web/dist
npm start              # 启动单端口服务（默认 8787）
```

开发模式（前端热更新）：

```bash
npm run dev            # 后端 8787 + Vite 5173（/api 与 /ws 已配代理）
```

### 2.4 自检与验收

```bash
npm run verify:api      # Cesium API 静态校验（不需浏览器，秒级）
npm run smoke           # 后端冒烟测试（20 项：接口 / 检索 / 统计 / MCP / 对话链路）
npm run verify:browser  # 无头浏览器端到端验证 + 截图到 screenshots/

# 环境没有 GPU 时，用虚拟显示跑浏览器验收（推荐）
xvfb-run -a node scripts/browser-check.mjs
```

### 2.5 远程访问

服务默认监听 `0.0.0.0`，因此**只要网络可达**，用服务器 IP 即可访问：

1. 确认 `.env` 中 `HOST=0.0.0.0`（默认已是）；
2. 放行端口：`sudo ufw allow 8787/tcp`（或云厂商安全组放行 8787）；
3. 浏览器打开 `http://<服务器IP>:8787`。

**没有公网 IP 时**，用 SSH 隧道把端口转发到本地最简单：

```bash
ssh -L 8787:127.0.0.1:8787 user@<服务器IP>
# 然后在本地浏览器打开 http://127.0.0.1:8787
```

> 单端口设计的好处：页面、接口、WebSocket 同源，只需暴露一个端口，不存在跨域与多端口映射问题。

---

## 3. 接入 DeepSeek（右下角对话框）

`.env` 中已预置配置，默认使用 **flash 模型**（响应快、成本低，适合高频交互）：

```ini
LLM_PROVIDER=deepseek
LLM_API_KEY=sk-xxxxxxxxxxxxxxxx
LLM_MODEL=deepseek-v4-flash
LLM_BASE_URL=https://api.deepseek.com
LLM_MAX_TOKENS=2000
LLM_FALLBACK_MODEL=deepseek-chat   # 模型名不可用时自动回退
```

几点工程上の注意事项（都已在本项目里处理）：

- **flash 是思维链模型**，返回里带有 `reasoning_content`，会占用 `max_tokens` 预算。
  因此 `LLM_MAX_TOKENS` 给到 2000，并且当响应 `finish_reason=length` 且没有工具调用时，会自动换 `deepseek-chat` 加大预算重试一次。
- **函数调用已验证可用**：43 个命令以 OpenAI `tools` 格式下发，模型可直接返回 `tool_calls`。
- **没有 Key 也能演示**：模型不可用时自动降级为「规则解析 + BM25 检索」，接口返回结构不变，聊天面板会标注当前处于离线模式。
- 想换成本地模型：`LLM_PROVIDER=ollama`、`LLM_BASE_URL=http://127.0.0.1:11434`、`LLM_MODEL=qwen2.5:7b`。

> ⚠️ `LLM_API_KEY` 属于敏感信息，`.env` 已被 `.gitignore` 忽略，请勿提交或截图外发。生产环境建议改为服务端网关或环境变量注入，并给 Key 设置额度与 IP 白名单。

---

## 4. 演示脚本（照着说就能看到效果）

打开页面后，对右下角对话框依次输入：

| # | 输入 | 预期表现 |
|---|---|---|
| 1 | `飞到 7 号楼，把它的楼层展开` | 相机飞向 7 号楼 → 楼栋高亮 → 18 层逐层分离升起 → 右侧信息卡列出各层 |
| 2 | `3 号楼 12 层有几户，都是什么户型？` | 返回该层户型/面积/业主类型（来自真实台账） |
| 3 | `切到地下，看看给水管线的走向` | 场景切为白色隧道剖切视角，仅显示蓝色给水管，埋深放大 3 倍 |
| 4 | `显示所有燃气管线，用橙色高亮` | 管线层打开、过滤为燃气、高亮显示 |
| 5 | `统计小区近 7 天用水量，用图表显示` | 叠加折线图卡片；点击图表可联动定位 |
| 6 | `哪栋楼入住率最低？` | 查询台账 → 文字回答 + 相机飞到该楼栋 |
| 7 | `哪几段管道需要优先更换？` | 返回健康度最低的管段（管龄/材质/健康度）并高亮 |
| 8 | `注入一次燃气泄漏` | IoT 模拟器注入故障 → 告警中心弹出 → 严重告警 toast |
| 9 | `燃气泄漏怎么应急处置？` | **RAG**：检索《燃气泄漏应急处置预案》，生成分级响应答案并标注来源 |
| 10 | `报修多久能到场？收费标准是什么？` | 检索《报修与收费标准》，引用条款回答 |

底部快捷按钮同样可以触发：`全景` / `地下管线` / `燃气高亮` / `用水统计` / `注入燃气泄漏` / `复位`。

---

## 5. 架构与代码结构

```
.
├── start.sh                     一键启动（构建 + 运行）
├── .env / .env.example          运行配置（端口、DeepSeek、RAG）
├── shared/
│   ├── tools.json               ★ 43 个命令的唯一定义（前端/后端/MCP 共用）
│   └── stats.mjs                统计与 ECharts 配置（前端与 /api/stats 同源）
├── knowledge/                   9 篇物业制度文档（RAG 语料，带 frontmatter）
├── scripts/
│   ├── gen-scene-data.mjs       场景数据生成（确定性、可复现）
│   └── fetch-osm-overpass.mjs   可选：从 OpenStreetMap 拉真实建筑轮廓
├── public/data/                 生成后的场景数据（GeoJSON/JSON）
├── apps/web/                    前端：Vue3 + Vite5 + Pinia + ECharts + Cesium
│   └── src/
│       ├── cesium/
│       │   ├── viewer.js        ★ 场景总装 + 拾取交互 + bridge 接入
│       │   ├── layers.js        建筑/楼层分层/管线/IoT/道路绿地
│       │   ├── tunnel.js        地下隧道剖切（ClippingPlane 实现）
│       │   └── baseMap.js       程序化底图（城市底纹 + 周边街区）
│       ├── commands/registry.js ★ 43 命令分发器（bridge 19 + 领域 24）
│       ├── components/          ChatPanel / LayerPanel / StatsPanel / InfoCard …
│       └── stores/              scene / ui / chat
└── apps/server/                 后端：Node + Express + ws（单端口对外）
    └── src/
        ├── index.mjs            HTTP API + WebSocket + 静态资源
        ├── agent.mjs            ★ Agent：路由 → LLM function calling / RAG
        ├── nlu.mjs              离线规则解析（无 Key 兜底）
        ├── knowledge.mjs        RAG 检索（Qdrant/向量/BM25 三级降级）
        ├── config.mjs           环境变量解析
        ├── data.mjs             场景数据装载
        └── mcp-stdio.mjs        MCP stdio 服务（给 Claude Desktop 等）
```

### Agent 处理链路

```
用户输入
  │
  ├─ ① 知识检索（无论哪条通道都先检索，便于"操控+解释"混合回答）
  │     Qdrant 向量 → 内存向量 → BM25 字级（三级自动降级）
  │
  ├─ ② 组装上下文：小区实时台账 + 检索片段 + 43 个工具定义
  │
  ├─ ③ DeepSeek flash 决策
  │     ├── 返回 tool_calls → sceneCommands 队列 → 前端逐条 dispatch
  │     │      → 执行结果回传 → 模型生成结语（"看着场景说结果"）
  │     └── 直接回答 → 作为知识问答返回，附引用来源
  │
  └─ ④ 失败/未配 Key → nlu.mjs 规则解析 + BM25 摘要（结构不变）
```

### 命令分发

`shared/tools.json` 是命令的**唯一事实来源**，三处共用：

- 前端 `commands/registry.js`：`dispatch({action, params})`，领域命令本地执行，其余转交 `CesiumBridge.execute()`
- 后端 `agent.mjs`：转成 OpenAI `tools` 交给模型
- MCP `mcp-stdio.mjs`：转成 MCP 工具注册

---

## 6. HTTP / WebSocket / MCP 接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 健康检查（含已连接浏览器数） |
| `/api/agent/chat` | POST | **对话主入口**：`{message, history, context}` → `{route, reply, sources, sceneCommands}` |
| `/api/agent/info` | POST/GET | 当前模型、RAG 模式、命令数量 |
| `/api/agent/tools` | GET | 43 个命令的 JSON Schema |
| `/api/knowledge/search` | POST | 纯检索：`{query, topK}` |
| `/api/knowledge/docs` | GET | 知识库文档清单与检索模式 |
| `/api/stats/:metric` | GET | 统计（`metric=water|gas|power|occupancy|pipeHealth|alarms`） |
| `/api/scene/command` | POST | 向浏览器下发命令（`wait=true` 时等待执行结果） |
| `/api/mcp` | POST | MCP over HTTP（JSON-RPC：`initialize` / `tools/list` / `tools/call` / `resources/*`） |
| `/api/events` | GET | SSE 事件流 |
| `/ws?session=demo&role=browser` | WS | 浏览器通道（协议与 cesium-mcp-runtime 一致） |

示例：

```bash
# 自然语言（走完整 Agent）
curl -s -X POST http://127.0.0.1:8787/api/agent/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"飞到7号楼并把楼层展开"}'

# 直接下发命令（跳过模型，用于程序化控制）
curl -s -X POST http://127.0.0.1:8787/api/scene/command \
  -H 'Content-Type: application/json' \
  -d '{"command":{"action":"showUnderground","params":{"enabled":true}},"wait":false}'

# MCP 调用
curl -s -X POST http://127.0.0.1:8787/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"queryPipeHealth","arguments":{"topN":3}}}'
```

### 让 Claude Desktop / Cursor 直接操控这个页面

```json
{
  "mcpServers": {
    "community-twin": {
      "command": "node",
      "args": ["<项目绝对路径>/apps/server/src/mcp-stdio.mjs"],
      "env": { "DEMO_API": "http://127.0.0.1:8787" }
    }
  }
}
```

这样外部 AI 客户端可以调用 43 个场景命令，也可以用 `askAgent` 走完整 Agent（含知识库问答）。

---

## 7. 数据说明

场景数据由 `scripts/gen-scene-data.mjs` **确定性生成**（同一份代码永远得到同一份数据），不依赖任何外部数据源，因此 Demo 可离线复现。

| 文件 | 内容 |
|---|---|
| `site.json` | 小区元信息：中心点、范围、图层清单 |
| `buildings.geojson` | 24 栋建筑轮廓（含 `floors` / `height` / 户数 / 入住率） |
| `roads.geojson` | 主环路 + 支路中心线 |
| `greens.geojson` | 绿地与广场 |
| `pipes.geojson` | 13 段管线（`diameter` 管径、`material` 材质、`depth` 埋深、`age` 管龄、`health` 健康度） |
| `sensors.geojson` | 41 个 IoT 测点（压力/燃气浓度/液位/流量/负荷） |
| `property.json` | 楼层-单元-户台账（609 户：面积、户型、业主类型、用水用气基线） |
| `timeseries.json` | 近 8 天用水/用气/用电趋势（小区 + 分楼栋） |
| `alarms.json` | 告警事件（含处理状态与处理人） |

**换成真实数据**：`public/data` 目录结构不变，直接替换文件即可；或运行 `npm run data:osm` 用 Overpass API 拉取真实小区的 OSM 建筑轮廓（见脚本内注释）。

---

## 8. 技术选型与工程化演进

### 为什么这么选

| 选择 | 理由 |
|---|---|
| 单端口（8787）对外 | 远程演示只需暴露一个端口，页面/API/WS 同源 |
| 程序化底图 | 去掉天地图/OSM/Cesium Ion 的 Key 依赖，Demo 可离线跑；真实项目用 `loadImageryService` 命令挂 WMTS 即可 |
| 楼层分层用几何体而非 3D Tiles | 无需建模产线即可演示"楼层单体化"交互，1 天内可复现 |
| 命令协议集中在一份 JSON | 前端、后端 Agent、MCP 三处共用，避免协议漂移 |
| 检索三级降级 | 有 Qdrant 用向量、没有就用 BM25，保证任何环境都能演示 |

### 后续工程化替换点

1. **楼层分层升级为 3D Tiles**：用 Blender/SketchUp 按层拆分导出，替换 `createFloorViewer` 即可，命令协议与前端交互不变。
2. **IoT 接真实数据**：把 `apps/web/src/lib/iot.js` 的 `tick()` 换成 WebSocket/MQTT/Kafka 数据源，告警判定逻辑无需改动。
3. **RAG 上生产**：配置 `QDRANT_URL` + `EMBEDDING_PROVIDER` 切换为向量检索；语料换成真实物业制度文件并建立更新流程。
4. **鉴权与审计**：在 `/api/*` 前加统一鉴权中间件，记录"谁在什么时间用哪条自然语言触发了哪些场景命令"。
5. **地图底图**：`setBasemap` / `loadImageryService`（天地图 WMTS 需申请 tk）。

---

## 9. 验收结论与常见问题

本项目在交付前完成了三层验收，全部通过：

| 验收层 | 命令 | 结果 |
|---|---|---|
| Cesium API 静态校验 | `npm run verify:api` | **77 / 77** 通过（含 4 条反向断言，防止误用已移除的 API） |
| 后端冒烟测试 | `npm run smoke` | **20 / 20** 通过（接口 / 检索 / 统计 / MCP / 真实模型对话链路） |
| 浏览器端到端 | `npm run verify:browser` | 页面加载、Cesium 渲染、WS 远控、楼层分层、对话框（真实调用 flash）全部通过，控制台 0 报错 |

> 浏览器验证基于 Chrome for Testing 114 + ANGLE/Vulkan，产物截图见 `screenshots/`：
> `01-overview` 全景 · `02-underground` 地下管线 · `03-floors` 楼层分层 · `04-chat` 对话操控 · `05-rag` 知识问答

**跑不起来时，先看 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** —— 里面记录了 4 个会导致
"页面白屏 / 渲染停止"的真实坑（Cesium 依赖版本错配、PolylineGeometry 参数类型、
PolygonGeometry 的 rectangle 用法、无头环境缺 VTF），以及对应的自检方法。

最常见的三个：

**Q：对话框回复"离线规则模式"？** 模型没调通 —— 检查 `.env` 的 `LLM_API_KEY` / `LLM_MODEL`，
用 `POST /api/agent/info` 看生效的 provider。

**Q：远程访问打不开？** 确认 `HOST=0.0.0.0`、防火墙放行 `PORT`，或在服务器本机
`curl http://127.0.0.1:8787/api/health` 自测；无公网 IP 时用 `ssh -L 8787:127.0.0.1:8787 user@host`。

**Q：外部 MCP 客户端报"浏览器响应超时"？** 命令是在浏览器里执行的，要先打开页面，
确认顶栏 `MCP 已连接` 变绿。

## 10. 命令清单（43 个）

**MCP 内置 19 个**（来自 cesium-mcp-bridge@1.139.0）
`flyTo` `setView` `getView` `zoomToExtent` `addGeoJsonLayer` `addHeatmap` `addMarker` `addLabel` `removeLayer` `setLayerVisibility` `listLayers` `updateLayerStyle` `setBasemap` `highlight` `load3dTiles` `loadTerrain` `loadImageryService` `playTrajectory` `screenshot`

**市政领域扩展 24 个**

| 分类 | 命令 |
|---|---|
| 楼栋 | `overviewSite` `listBuildings` `selectBuilding` `expandFloors` `collapseFloors` `highlightFloor` `setFloorMode` |
| 管网 | `showUnderground` `setPipeFilter` `setPipeDepthScale` `listPipes` `queryPipeHealth` |
| IoT | `listSensors` `queryIotRealtime` `setSimulate` |
| 告警 | `listAlarms` |
| 统计 | `queryStats` `showChart` |
| 界面 | `showInfoCard` `showTooltip` `setPanel` `toggleLayer` |
| 演示 | `showTrajectoryDemo` `resetView` |

页面上点右下角 `❔` 可查看全部命令的说明与参数。

---

## 11. 许可与致谢

- 三维引擎：[CesiumJS](https://cesium.com/platform/cesiumjs/)（Apache-2.0）
- AI 操控层：[cesium-mcp-bridge](https://www.npmjs.com/package/cesium-mcp-bridge) / [cesium-mcp-runtime](https://www.npmjs.com/package/cesium-mcp-runtime)（MIT）
- 本项目代码用于方案验证与演示，可按需修改。

## 智慧社区大屏界面（2026-10）

首页采用全屏 Cesium 场景、青蓝色半透明双侧监控面板，提供社区概况、用水用气趋势、实时管网监测、用电统计、安全事件与设备清单。顶部业务导航可打开原有图层、统计、告警和 AI 助手；楼栋选中、楼层展开、地下管线与自然语言操作继续保留。

`npm run data:build` 可重新生成虚构小区：17 栋住宅、7 栋公共建筑、609 户住宅、41 个 IoT 点位及 13 段管线。住户、能耗、事件为模拟数据。建筑立面窗户、沿路树木和停车位在浏览器中程序化生成，无须地图 API Key 或在线三维模型。该方案是程序化三维场景，并非参考图片中的摄影测量实景模型。

启动：`npm install`，然后 `npm run dev`；生产运行：`npm run build`，然后 `npm start`。修改已通过生产构建及 Cesium API 检查；实际 GPU 渲染与不同屏幕尺寸的视觉效果需在浏览器确认。
