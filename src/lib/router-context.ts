import type { QueryClient } from '@tanstack/react-query'
import type { RouterAuth } from '@/lib/router-auth'

export interface AppRouterContext {
  auth: RouterAuth
  queryClient: QueryClient
}
