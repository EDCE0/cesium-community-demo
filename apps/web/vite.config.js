import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath, URL } from 'node:url'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Cesium 集成方案
 * ---------------------------------------------------------------------------
 *  · 代码统一用 `import * as Cesium from 'cesium'`（走包 exports → Source 入口，构建期打包）
 *  · 静态资源（Assets/Workers/Widgets/ThirdParty）从 node_modules/cesium/Build/Cesium
 *    拷贝到 public/cesium，运行时通过 window.CESIUM_BASE_URL='/cesium/' 定位
 *  · 因此 dev 与 build 行为一致，且完全不需要 CDN / Cesium Ion Key
 *
 * ⚠️ 两个踩过的坑，改动此文件时请勿回退：
 *  1) 不要再给 `cesium` 加自定义 alias。cesium 与 cesium-mcp-bridge 各自解析路径时
 *     一旦落到不同模块实例，@cesium/engine 会被打包两份，模块级单例 ContextLimits
 *     被撕裂 —— 现象是渲染时报 "Vertex texture fetch support is required"，
 *     但 gl.getParameter(MAX_VERTEX_TEXTURE_IMAGE_UNITS) 直读其实是 32。
 *     解决方式：resolve.dedupe + 去掉 alias。
 *  2) manualChunks 里不要把 cesium 单独拆包又让 bridge 从另一入口引入，同样会撕裂单例。
 * ---------------------------------------------------------------------------
 */
export default defineConfig({
  root: r('.'),
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        // 用绝对路径：npm workspaces 会把依赖提升到仓库根的 node_modules
        { src: r('../../node_modules/cesium/Build/Cesium/Workers'), dest: 'cesium' },
        { src: r('../../node_modules/cesium/Build/Cesium/Assets'), dest: 'cesium' },
        { src: r('../../node_modules/cesium/Build/Cesium/Widgets'), dest: 'cesium' },
        { src: r('../../node_modules/cesium/Build/Cesium/ThirdParty'), dest: 'cesium' },
      ],
    }),
  ],
  resolve: {
    // 关键：保证 cesium / cesium-mcp-bridge 共用同一份 @cesium/engine 单例
    dedupe: ['cesium', '@cesium/engine', '@cesium/widgets'],
    alias: [
      // Cesium 自带样式只存在于 Build 目录，单独指一下路径
      {
        find: /^cesium\/Build\/Cesium\/Widgets\/widgets\.css$/,
        replacement: r('../../node_modules/cesium/Build/Cesium/Widgets/widgets.css'),
      },
      { find: /^@\//, replacement: r('./src') + '/' },
    ],
  },
  // 场景数据 / 知识库统一放在仓库根的 public 下，dev 与 build 都从同一处取
  publicDir: r('../../public'),
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium/'),
  },
  server: {
    // 0.0.0.0 便于远程访问；开发模式下 API/WS 通过代理转到 8787
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts'],
        },
      },
    },
  },
})
