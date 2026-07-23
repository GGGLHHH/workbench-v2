import type { BffPromptPreset } from '@/generated/api-types'
import { listBffPromptPresets } from '@/generated/client'
import { useInfiniteList, type BaseInfiniteListOptions } from '@/components/select/use-infinite-list'
import { queryKeys } from '@/lib/query-keys'

// 预设 prompt 目录的无限下拉数据源:按 search 分页拉预设,喂给 PromptPresetInfiniteSelect。
// 只读目录(v2 不建预设)。BFF 的 /bff/prompt-presets 返回体已是 limit/offset 信封,与
// useInfiniteList 的 InfiniteListPage 同形,直接透传。与 useInfiniteTagOptions 同构。
export interface UseInfinitePromptPresetOptionsOptions extends BaseInfiniteListOptions {
  search?: string
}

export function useInfinitePromptPresetOptions({
  search,
  pageSize,
  enabled,
  staleTime,
  gcTime,
}: UseInfinitePromptPresetOptionsOptions = {}) {
  return useInfiniteList<BffPromptPreset>({
    queryKey: queryKeys.promptPresets.infinite(search),
    queryFn: ({ limit, offset }) => listBffPromptPresets({ query: { search, limit, offset } }),
    pageSize,
    enabled,
    staleTime,
    gcTime,
  })
}
