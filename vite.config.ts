import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type PluginOption } from 'vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { openapiCodegen } from 'vite-plugin-openapi-codegen'

// workbench-v2：独立仓,通过 pnpm link: 以 TS 源码消费 @gedatou/{editor,shared}（改库即时生效）。
// dedupe 强制 react/remotion/base-ui/zustand 等单实例——否则库副本与 app 副本分裂,context 断裂。
export default defineConfig(({ mode }) => {
  // 端口单一真相源 = 根 .env(见 .env.example)。前端 dev 口、代理目标、codegen 拉取地址全从这里派生,
  // 不再散落硬编码。loadEnv 只在 config 期读取,不注入客户端 bundle(仅 VITE_ 前缀才会进 import.meta.env)。
  const env = loadEnv(mode, process.cwd(), '')
  const bff = `http://localhost:${env.BFF_PORT ?? 4100}`
  return {
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
      // 前端不认 server/xchangeai 的口,只认 BFF。不设 pathPrefix:合并 spec 有 /api/v1 与 /bff 两个根,
      // 保留完整路径,由 ky(无 prefix)+ vite 代理分流。generate 时需 BFF 与 xchangeai 均在跑。
      openapiCodegen({
        input: `${bff}/openapi.yaml`,
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
    // 前端只认 BFF：/api（含 /api/v1）与 /bff 全打到 BFF,由 BFF 内部分流
    //   /api/v1/* → xchangeai-server   /api/* → 渲染服务 server   /bff/* → BFF 自有
    // 素材/产物走绝对 <server>/media（CORS 直连,不经代理）。目标口来自 .env 的 BFF_PORT。
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      proxy: {
        '/api': bff,
        '/bff': bff,
      },
    },
  }
})
