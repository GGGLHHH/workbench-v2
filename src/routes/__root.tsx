import { ThemeProvider } from 'next-themes'
import { QueryClientProvider } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { queryClient } from '@/lib/query-client'
import { Toaster } from '@/toaster'
import type { AppRouterContext } from '@/lib/router-context'

// 根路由:提供 ThemeProvider + QueryClient + 全局 Toaster,渲染子路由。守卫下放到叶子路由。
export const Route = createRootRouteWithContext<AppRouterContext>()({
  component: RootComponent,
})

function RootComponent() {
  return (
    // next-themes 接管 <html> 的 .dark class(index.html 预置 class="dark" 作挂载前默认,避免闪白)。
    // 默认 dark 保持现有观感;enableSystem 让「跟随系统」可选。Toaster 不再写死 theme → 随之切换。
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <Toaster richColors position="bottom-right" />
      </QueryClientProvider>
    </ThemeProvider>
  )
}
