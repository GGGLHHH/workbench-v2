import { QueryClient } from '@tanstack/react-query'

// 对齐 xchangeai-web/src/lib/query-client.ts 的默认策略：5min 新鲜、10min 回收、
// 不在窗口聚焦时重取；4xx/明确的服务端错误码不重试，其余最多重试 1 次。
const NO_RETRY_STATUS = [
  400, 401, 403, 404, 405, 406, 409, 410, 411, 412, 413, 414, 415, 416, 422, 423, 451, 501, 505,
  506, 507, 508, 510, 511,
]

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 10 * 60 * 1000,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status
        if (status && NO_RETRY_STATUS.includes(status)) return false
        return failureCount < 1
      },
    },
  },
})
