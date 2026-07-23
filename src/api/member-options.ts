import type { BffOption } from '@/generated/api-types'
import { listBffMemberOptions } from '@/generated/client'
import { useInfiniteList, type BaseInfiniteListOptions } from '@/components/select/use-infinite-list'
import { queryKeys } from '@/lib/query-keys'

// 成员选项(agency/agent/assignee)的无限下拉数据源:一条 kind 路由收敛三者,按 search 分页,喂给
// MemberInfiniteSelect。与 useInfiniteTagOptions 同构;BFF 返回 { items,total,limit,offset } 直接透传。
export type MemberKind = 'agency' | 'agent' | 'assignee'

export interface UseInfiniteMemberOptionsOptions extends BaseInfiniteListOptions {
  search?: string
}

export function useInfiniteMemberOptions(
  kind: MemberKind,
  { search, pageSize, enabled, staleTime, gcTime }: UseInfiniteMemberOptionsOptions = {},
) {
  return useInfiniteList<BffOption>({
    queryKey: queryKeys.memberOptions.infinite(kind, search),
    queryFn: ({ limit, offset }) => listBffMemberOptions({ query: { kind, search, limit, offset } }),
    pageSize,
    enabled,
    staleTime,
    gcTime,
  })
}
