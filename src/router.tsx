import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { globalRouter } from './lib/global-router'
import { queryClient } from './lib/query-client'
import { createRouterAuth } from './lib/router-auth'
import type { AppRouterContext } from './lib/router-context'

const routerContext = {
  auth: createRouterAuth(queryClient),
  queryClient,
} satisfies AppRouterContext

export const router = createRouter({
  routeTree,
  context: routerContext,
  scrollRestoration: true,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

// 发布给非 React 调用方(api-client 401 跳转)
globalRouter.instance = router

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
