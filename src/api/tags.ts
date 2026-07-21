import type { BffTag } from '@/generated/api-types'
import { listBffTags } from '@/generated/client'
import { useInfiniteList, type BaseInfiniteListOptions } from '@/lib/use-infinite-list'
import { queryKeys } from '@/lib/query-keys'

// tag 目录的无限下拉数据源:按 search 分页拉「已有」标签,喂给 TagInfiniteSelect。
// v2 不开放建标签,故没有 create;只读目录。BFF 的 /bff/tags 返回体已是 limit/offset 信封,
// 与 useInfiniteList 的 InfiniteListPage 同形,直接透传。
export interface UseInfiniteTagOptionsOptions extends BaseInfiniteListOptions {
  search?: string
}

export function useInfiniteTagOptions({ search, pageSize, enabled, staleTime, gcTime }: UseInfiniteTagOptionsOptions = {}) {
  return useInfiniteList<BffTag>({
    queryKey: queryKeys.tags.infinite(search),
    queryFn: ({ limit, offset }) => listBffTags({ query: { search, limit, offset } }),
    pageSize,
    enabled,
    staleTime,
    gcTime,
  })
}
