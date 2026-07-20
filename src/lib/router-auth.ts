import type { QueryClient } from '@tanstack/react-query'
import type { BffSession } from '@/generated/api-types'
import { getBffSession } from '@/generated/client'
import { SOFT_AUTH_HEADER } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

const SESSION_STALE_TIME = 5 * 60 * 1000

export interface RouterAuth {
  // null = 明确未登录;BffSession = 已登录当前用户
  getCurrentUser: () => Promise<BffSession | null>
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if ('status' in error) return Number((error as { status?: unknown }).status)
  if ('response' in error) return Number((error as { response?: { status?: unknown } }).response?.status)
  return undefined
}

export function createRouterAuth(queryClient: QueryClient): RouterAuth {
  return {
    async getCurrentUser() {
      const cached = queryClient.getQueryData<BffSession | null>(queryKeys.session())
      if (cached !== undefined) return cached ?? null

      try {
        // soft 探测:401 不触发 api-client 的跳转级联(守卫自己决定跳哪)
        const session = await queryClient.fetchQuery({
          queryFn: () => getBffSession({}, { headers: { [SOFT_AUTH_HEADER]: '1' } }),
          queryKey: queryKeys.session(),
          retry: false,
          staleTime: SESSION_STALE_TIME,
        })
        return session ?? null
      } catch (error) {
        if (getErrorStatus(error) === 401) return null
        throw error
      }
    },
  }
}
