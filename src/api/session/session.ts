import { useMutation } from '@tanstack/react-query'

import type { BffLoginRequest, BffSession } from '@/generated/api-types'
import { loginBffSession } from '@/generated/client'
import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'

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
