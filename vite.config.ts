import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// workbench-v2：独立仓，通过 pnpm link: 以 TS 源码消费 @gedatou/{editor,shared}（改库即时生效）。
// dedupe 强制 react/remotion/base-ui/zustand 等单实例——否则库副本与 app 副本分裂，context 断裂。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
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
  // 前端唯一入口 = BFF（:4100）：/api 控制面 + /bff 产品面都打到 BFF。
  // BFF 再把 /api/* 转发到渲染服务（:3011）；素材/产物走绝对 :3011/media（CORS 直连，不经 BFF）。
  server: {
    proxy: {
      '/api': 'http://localhost:4100',
      '/bff': 'http://localhost:4100',
    },
  },
})
