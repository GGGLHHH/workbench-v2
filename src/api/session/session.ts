import { useMutation, useQuery } from '@tanstack/react-query'

import type { BffLoginRequest, BffSession } from '@/generated/api-types'
import { getBffSession, loginBffSession } from '@/generated/client'
import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'

// 当前会话。beforeLoad 已把它写进缓存(见 router-auth)→ 这里通常直接命中,不再发请求。
// 用于「我的项目」筛选取自身 user.id;订阅缓存 → 登录/刷新后跟随更新。
export function useSession() {
  return useQuery({
    queryKey: queryKeys.session(),
    queryFn: () => getBffSession({}),
    staleTime: Infinity,
  })
}

// 登录:成功后把会话写进缓存 → 路由守卫立即看到已登录,回跳时不再软探测一次
// (调用方只需在 mutate 的 onSuccess 里 toast + 跳转)。
export function useLogin() {
  return useMutation({
    mutationFn: (body: BffLoginRequest) => loginBffSession({ body }),
    onSuccess: (session: BffSession) => {
      queryClient.setQueryData(queryKeys.session(), session)
    },
  })
}
