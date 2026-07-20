import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type PluginOption } from 'vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { openapiCodegen } from 'vite-plugin-openapi-codegen'

// workbench-v2：独立仓，通过 pnpm link: 以 TS 源码消费 @gedatou/{editor,shared}（改库即时生效）。
// dedupe 强制 react/remotion/base-ui/zustand 等单实例——否则库副本与 app 副本分裂，context 断裂。
export default defineConfig({
  plugins: [
    // 开发期「点元素跳源码」:按住 Alt+Shift 点击页面元素 → 在编辑器打开对应组件源码。
    // 仅 dev 生效(生产 build 自动关闭)。
    codeInspectorPlugin({ bundler: 'vite' }),
    // 文件式路由:从 src/routes 生成 src/routeTree.gen.ts(必须在 react() 之前)
    // as PluginOption:规避 tsc 对 router 插件复杂类型的 TS2321(深度比较栈溢出)
    tanstackRouter({ target: 'react', autoCodeSplitting: true }) as PluginOption,
    react(),
    tailwindcss(),
    // 前端唯一契约来源 = BFF 的合并 openapi.yaml（含 BFF 自有 /bff/* + 下游 xchangeai /api/v1/*）。
    // 前端不认 :8080/:3011,只认 :4100。不设 pathPrefix:合并 spec 有 /api/v1 与 /bff 两个根,
    // 保留完整路径,由 ky(无 prefix)+ vite 代理分流。generate 时需 BFF(:4100)与 :8080 均在跑。
    openapiCodegen({
      input: 'http://localhost:4100/openapi.yaml',
      output: 'src/generated',
      // 插件默认 pathPrefix '/api/' 会过滤掉 /bff/* 并剥前缀（单前缀模型）。
      // 合并 spec 有两个根 → pathPrefix '/' 收全部、stripPrefix false 保留完整路径,
      // 运行时 ky 不设 prefix,由 vite 代理按根分流。
      pathPrefix: '/',
      stripPrefix: false,
      typeAliases: true,
      httpClient: { module: '@/lib/api-client' },
      generateOnDev: false,
      generateOnHmr: false,
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    dedupe: [
      'react',
      'react-dom',
      'remotion',
      '@remotion/player',
      '@remotion/media',
      '@remotion/gif',
      '@remotion/google-fonts',
      '@remotion/captions',
      '@base-ui/react',
      'zustand',
      'mediabunny',
    ],
  },
  // 前端只认 BFF(:4100)：/api（含 /api/v1）与 /bff 全打到 BFF,由 BFF 内部分流
  //   /api/v1/* → xchangeai-server(:8080)   /api/* → 渲染服务(:3011)   /bff/* → BFF 自有
  // 素材/产物走绝对 :3011/media（CORS 直连,不经代理）。
  server: {
    proxy: {
      '/api': 'http://localhost:4100',
      '/bff': 'http://localhost:4100',
    },
  },
})
