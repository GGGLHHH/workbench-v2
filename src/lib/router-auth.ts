import type { QueryClient } from '@tanstack/react-query'
import type { BffSession } from '@/generated/api-types'
import { getBffSession } from '@/generated/client'
import { SOFT_AUTH_HEADER } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

const SESSION_STALE_TIME = 5 * 60 * 1000

export interface RouterAuth {
  // 受保护路由守卫用:硬探测。access 过期(401)时走 api-client 刷新阶梯自动恢复;
  // refresh 也失效才返回 null(此时 api-client 已 toast「会话已过期」+ 跳登录)。
  getCurrentUser: () => Promise<BffSession | null>
  // 游客守卫用(登录页「已登录就跳走」):软探测。只判断是否已登录,不刷新、不弹「过期」——
  // 未登录访客坐在登录页不该被自动刷新或提示。
  getCurrentUserSoft: () => Promise<BffSession | null>
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if ('status' in error) return Number((error as { status?: unknown }).status)
  if ('response' in error) return Number((error as { response?: { status?: unknown } }).response?.status)
  return undefined
}

export function createRouterAuth(queryClient: QueryClient): RouterAuth {
  const read = async (soft: boolean): Promise<BffSession | null> => {
    const cached = queryClient.getQueryData<BffSession | null>(queryKeys.session())
    if (cached !== undefined) return cached ?? null

    try {
      // soft:带软探测头 → 401 只抛错,不触发刷新/跳转级联(守卫自己决定跳哪)。
      // 非 soft:硬探测 → 401 进 api-client 刷新阶梯(access 过期时透明恢复)。
      const session = await queryClient.fetchQuery({
        queryFn: () => getBffSession({}, soft ? { headers: { [SOFT_AUTH_HEADER]: '1' } } : {}),
        queryKey: queryKeys.session(),
        retry: false,
        staleTime: SESSION_STALE_TIME,
      })
      return session ?? null
    } catch (error) {
      if (getErrorStatus(error) === 401) return null
      throw error
    }
  }

  return {
    getCurrentUser: () => read(false),
    getCurrentUserSoft: () => read(true),
  }
}
