import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

// 全站 limit/offset 分页协议的 useInfiniteQuery 封装(从 xchangeai-web 移植,去掉未用的 cursor 版)。
// 领域 hook(如 useInfiniteTagOptions)套一层,喂 queryKey + 单页 queryFn,拿回已铺平的 items
// 和一份对齐 <InfiniteSelect> 的 selectProps。

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

export interface UseInfiniteListResult<TItem> {
  items: TItem[]
  total: number
  hasNextPage: boolean
  isLoading: boolean
  isPending: boolean
  isFetching: boolean
  isFetchingNextPage: boolean
  isError: boolean
  error: unknown
  fetchNextPage: () => void
  refetch: () => void
  selectProps: InfiniteSelectAdapterProps<TItem>
}

const DEFAULT_PAGE_SIZE = 20
const EMPTY_ITEMS: readonly never[] = Object.freeze([])

export function useInfiniteList<TItem, TExtraParams extends object = object>(
  options: UseInfiniteListOptions<TItem, TExtraParams>,
): UseInfiniteListResult<TItem> {
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

  const total = query.data?.pages.at(-1)?.total ?? 0

  const fetchNextPage = useCallback((): void => {
    void query.fetchNextPage()
  }, [query])
  const refetch = useCallback((): void => {
    void query.refetch()
  }, [query])

  const selectProps = useMemo<InfiniteSelectAdapterProps<TItem>>(
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

  return {
    items,
    total,
    hasNextPage: query.hasNextPage,
    isLoading: query.isLoading,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    isError: query.isError,
    error: query.error,
    fetchNextPage,
    refetch,
    selectProps,
  }
}
