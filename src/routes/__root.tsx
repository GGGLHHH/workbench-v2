import { QueryClientProvider } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { queryClient } from '@/lib/query-client'
import { Toaster } from '@/toaster'
import type { AppRouterContext } from '@/lib/router-context'

// 根路由:提供 QueryClient + 全局 Toaster,渲染子路由。守卫下放到叶子路由。
export const Route = createRootRouteWithContext<AppRouterContext>()({
  component: RootComponent,
})

function RootComponent() {
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster theme="dark" richColors position="bottom-right" />
    </QueryClientProvider>
  )
}
