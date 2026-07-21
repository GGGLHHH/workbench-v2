import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

// 全站 limit/offset 分页协议的 useInfiniteQuery 封装(对齐 basereact 的 select 基座:
// 直接返回 <InfiniteSelect> 消费的 InfiniteSelectAdapterProps,不再套 { selectProps } 一层)。
// basereact 那份只留 cursor 版;这里因下游 /bff/tags 是 offset 分页,保留 offset 版,形态一致。

/** 与生成的 PageResponse 对齐的分页信封;空页后端可能回 items:null,这里归一。 */
export interface InfiniteListPage<TItem> {
  items: TItem[] | null
  limit: number
  offset: number
  total: number
}

export interface InfiniteListPaginationParams {
  limit: number
  offset: number
}

/** 领域 hook 通用选项。 */
export interface BaseInfiniteListOptions {
  /** 页大小,默认 20。 */
  pageSize?: number
  enabled?: boolean
  staleTime?: number
  gcTime?: number
}

export interface UseInfiniteListOptions<TItem, TExtraParams extends object = object>
  extends BaseInfiniteListOptions {
  /** queryKey 必须体现 baseParams 的有效差异。 */
  queryKey: QueryKey
  /** 单页拉取;hook 负责合并 limit/offset/baseParams。 */
  queryFn: (params: TExtraParams & InfiniteListPaginationParams) => Promise<InfiniteListPage<TItem>>
  /** 领域过滤条件;变化必须同时反映到 queryKey。 */
  baseParams?: TExtraParams
}

/** <InfiniteSelect> 消费的最小适配 props。 */
export interface InfiniteSelectAdapterProps<TItem> {
  items: TItem[]
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  isError: boolean
  onLoadMore: () => void
  onRetry: () => void
}

const DEFAULT_PAGE_SIZE = 20
const EMPTY_ITEMS: readonly never[] = Object.freeze([])

export function useInfiniteList<TItem, TExtraParams extends object = object>(
  options: UseInfiniteListOptions<TItem, TExtraParams>,
): InfiniteSelectAdapterProps<TItem> {
  const { queryKey, queryFn, baseParams, pageSize = DEFAULT_PAGE_SIZE, enabled, staleTime, gcTime } = options

  const query = useInfiniteQuery({
    enabled,
    ...(gcTime !== undefined && { gcTime }),
    ...(staleTime !== undefined && { staleTime }),
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      queryFn({ ...((baseParams ?? {}) as TExtraParams), limit: pageSize, offset: pageParam }),
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.offset + (lastPage.items?.length ?? 0)
      return loaded < lastPage.total ? loaded : undefined
    },
  })

  const items = useMemo<TItem[]>(() => {
    if (!query.data) return EMPTY_ITEMS as unknown as TItem[]
    const out: TItem[] = []
    for (const page of query.data.pages) {
      if (page.items?.length) out.push(...page.items)
    }
    return out
  }, [query.data])

  const fetchNextPage = useCallback((): void => {
    void query.fetchNextPage()
  }, [query])
  const refetch = useCallback((): void => {
    void query.refetch()
  }, [query])

  return useMemo<InfiniteSelectAdapterProps<TItem>>(
    () => ({
      items,
      isLoading: query.isLoading,
      isFetchingNextPage: query.isFetchingNextPage,
      hasNextPage: query.hasNextPage,
      isError: query.isError,
      onLoadMore: fetchNextPage,
      onRetry: refetch,
    }),
    [items, query.isLoading, query.isFetchingNextPage, query.hasNextPage, query.isError, fetchNextPage, refetch],
  )
}
