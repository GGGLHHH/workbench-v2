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
  // /api 控制面转发到本地渲染服务器（server/）；素材/产物走绝对 <publicBaseUrl>/media（CORS 直连）。
  server: {
    proxy: {
      '/api': 'http://localhost:3011',
    },
  },
})
