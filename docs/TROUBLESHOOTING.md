# 常见问题与踩坑记录（Troubleshooting）

> 这份文档记录本项目在真实环境里**实际踩到并已修复**的问题。
> 改动 Cesium 相关代码前请先扫一眼 —— 前四个都是"页面白屏/渲染停止"级别的坑。

---

## 1. Cesium 依赖版本必须锁死（最高优先级）

**现象**：三维视口全黑，Cesium 弹出红色错误面板：

```
RuntimeError: Vertex texture fetch support is required to render primitives
with per-instance attributes. The maximum number of vertex texture image units
must be greater than zero.
```

但浏览器控制台里 `gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)` 明明是 `32`。

**原因**：`cesium@1.139.0` 声明的依赖范围是 `@cesium/widgets: ^14.4.0`。
npm 会解析到 **14.5.0**，而 `@cesium/widgets@14.5.0` 又依赖 `@cesium/engine@^24.0.0`。
于是 `cesium` 用 engine 23、widgets 用 engine 24，**同一份 `@cesium/engine` 被打包成两个模块实例**，
模块级单例 `ContextLimits` 被撕裂：Viewer 的 Context 读到 32 写进 A 实例，
而 `Primitive.update` 读的是还是初始值 0 的 B 实例。

**修复**（本项目已内置）：

1. `apps/web/package.json` 显式钉住：
   ```json
   "dependencies": {
     "cesium": "1.139.0",
     "@cesium/engine": "23.0.1",
     "@cesium/widgets": "14.4.0"
   }
   ```
2. 根 `package.json` 加 `overrides` 兜底：
   ```json
   "overrides": { "@cesium/engine": "23.0.1", "@cesium/widgets": "14.4.0" }
   ```
3. `apps/web/vite.config.js` 里 `resolve.dedupe: ['cesium','@cesium/engine','@cesium/widgets']`，
   **并且不要给 `cesium` 加自定义 alias**（alias + 裸导入会走两条解析路径，同样撕裂单例）。
4. 改完必须**删掉 `node_modules` 与 `package-lock.json` 重新装**，否则嵌套的旧版本不会被清掉。

**自检**：`npm ls @cesium/engine @cesium/widgets` 应显示单一版本、无 `invalid` / 无嵌套副本。

---

## 2. `PolylineGeometry.positions` 必须是 `Cartesian3[]`

**现象**：渲染直接停止，报 `DeveloperError: left is required.`

**原因**：写成了扁平数字数组：

```js
// ✗ 错误：createGeometry 内部按顶点索引读时读到 undefined
const positions = []
for (...) positions.push(v.x, v.y, v.z)
new Cesium.PolylineGeometry({ positions, width: 3 })

// ✓ 正确
const positions = []
for (...) positions.push(Cesium.Cartesian3.lerp(from, to, t, new Cesium.Cartesian3()))
new Cesium.PolylineGeometry({ positions, width: 3 })
```

这个报错信息极具误导性：它来自 `Cartesian3.equalsEpsilon`（内部被
`arrayRemoveDuplicates` 当比较器用），跟"左右"参数毫无关系。
**凡是看到 `left is required` / `right is required`，先怀疑某项几何参数类型不对。**

---

## 3. `PolygonGeometry` 不支持 `rectangle` 参数，也没有 `fromRectangle`

在 Cesium 1.139 里：

- `Cesium.BoxGeometry.fromRectangle` —— **不存在**
- `Cesium.PolygonGeometry.fromRectangle` —— **不存在**
- `new Cesium.PolygonGeometry({ rectangle })` —— **报 `Expected options.polygonHierarchy to be typeof object`**

**正确写法**：用 `PolygonHierarchy` 传四角坐标。

```js
const hierarchy = new Cesium.PolygonHierarchy([
  Cesium.Cartesian3.fromDegrees(west, south),
  Cesium.Cartesian3.fromDegrees(east, south),
  Cesium.Cartesian3.fromDegrees(east, north),
  Cesium.Cartesian3.fromDegrees(west, north),
])
new Cesium.PolygonGeometry({ polygonHierarchy: hierarchy, height: 0, extrudedHeight: 20 })
```

同时注意：**不要用"两个三角形拼 6 个顶点"当多边形环**（`PerInstanceColorAppearance` 的
三角扇写法）。`PolygonGeometry` 会按 earcut 三角化后的边表索引读顶点，
非法环同样会抛 `left is required`。

---

## 4. 无头渲染环境缺少顶点纹理拾取

即便版本正确，某些无头/软件渲染环境（SwiftShader）拿不到
`MAX_VERTEX_TEXTURE_IMAGE_UNITS`，Cesium 会直接停止渲染。

```bash
# 推荐：有头模式 + 虚拟显示（本项目验证用的方式）
xvfb-run -a node scripts/browser-check.mjs          # 需先 apt-get install -y xvfb
HEADED=1 xvfb-run -a node scripts/browser-check.mjs

# 或者指定真实 Chrome（不要用 --disable-gpu / --use-gl=swiftshader）
CHROME_PATH=/path/to/chrome node scripts/browser-check.mjs
```

`scripts/verify-cesium-api.mjs` 可以在**不启动浏览器**的情况下，提前发现
API 改名/移除类问题，建议改完 Cesium 代码先跑它。

---

## 5. `ClippingPlaneCollection` 没有公开的 `.planes` 访问器

1.139 里要用 `get(index)` / `length`：

```js
// ✗ scene.clippingPlanes.planes.get(0)
// ✓
const plane = scene.clippingPlanes.get(0)
plane.normal = normal
plane.distance = -dist
```

`MaterialAppearance.VERTEX_FORMAT` 也**不存在**，改用
`Cesium.VertexFormat.POSITION_AND_NORMAL` / `POSITION_ONLY`。

---

## 6. 贴地多边形 pick 不到

`GeoJsonDataSource.load(..., { clampToGround: true })` 的建筑是 ClassificationPrimitive，
部分驱动/缩放下 `scene.pick()` 返回不到实体。

本项目做了两层兜底（`apps/web/src/cesium/layers.js`）：

1. 优先用 `scene.pick()`；
2. 失败时用 `pickBuildingByRay()`：射线与楼栋轮廓所在水平面求交 + 点在多边形内判定。

---

## 7. 对话框回复"离线规则模式"

说明模型没调通。依次检查：

1. `.env` 里 `LLM_API_KEY` 是否有效；
2. `LLM_MODEL` 是否存在（`curl` 直接打一下接口最稳）；
3. `POST /api/agent/info` 看 `provider` 字段是否为你期望的值；
4. flash 这类**思维链模型**会返回 `reasoning_content` 并占用 `max_tokens`，
   `LLM_MAX_TOKENS` 建议 ≥ 1500，否则可能出现"有思考、没输出"。

本项目已内置：模型名不可用（400/404）或输出被截断时，自动回退到
`LLM_FALLBACK_MODEL`（默认 `deepseek-chat`）并加倍预算重试一次。

---

## 8. 其他

| 问题 | 处理 |
|---|---|
| 远程打不开 | 确认 `.env` 中 `HOST=0.0.0.0`；防火墙/安全组放行 `PORT`；先用 `curl http://127.0.0.1:PORT/api/health` 在服务器本机自测 |
| 外部 MCP 调用提示"浏览器响应超时" | 命令在浏览器里执行，需要**先打开页面**，顶栏 `MCP 已连接` 变绿 |
| 首屏没有 3D | 看浏览器 console；多半是第 1 或第 4 条 |
| 想重置演示状态 | 底部 `↺ 复位`，或刷新页面 |
| 前端构建很慢/包很大 | Cesium 本体约 4 MB（gzip 1.2 MB），属正常；生产环境可考虑按需裁剪 |
