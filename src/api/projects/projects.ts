import { useRef } from 'react'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { BffProjectPage, BffProjectSaveRequest } from '@/generated/api-types'
import {
  changeBffProjectStatus,
  getBffProject,
  getBffProjectStats,
  listBffProjects,
  saveBffProject,
} from '@/generated/client'
import { ApiError } from '@/lib/api-client'
import { queryClient } from '@/lib/query-client'
import { queryKeys, type ProjectListParams } from '@/lib/query-keys'

export const PROJECTS_PAGE_SIZE = 20

type InfiniteProjects = InfiniteData<BffProjectPage, number>

const isAbort = (error: unknown) => error instanceof ApiError && error.kind === 'abort'

// 无限列表:offset 分页,getNextPageParam 累加已加载数直到 total。sort 只认服务端字段
// (created/updated);name 排序由调用方在已加载项上做(xchangeai 只支持时间字段服务端排序)。
export function useInfiniteProjects(params: ProjectListParams) {
  return useInfiniteQuery({
    queryKey: queryKeys.projects.list(params),
    queryFn: ({ pageParam }) =>
      listBffProjects({
        query: {
          limit: PROJECTS_PAGE_SIZE,
          offset: pageParam,
          search: params.search || undefined,
          status: params.status || undefined,
          sort: params.sort,
        },
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const loaded = last.offset + last.items.length
      return loaded < last.total ? loaded : undefined
    },
  })
}

export function useProjectStats() {
  return useQuery({
    queryKey: queryKeys.projects.stats(),
    queryFn: () => getBffProjectStats({}),
  })
}

export function useProject(id: string | null) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: queryKeys.projects.detail(id ?? ''),
    queryFn: () => getBffProject({ path: { id: id! } }),
  })
}

export function useSaveProject() {
  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: BffProjectSaveRequest }) =>
      saveBffProject({ path: { id }, body: request }),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(id) })
    },
  })
}

// action → 目标状态:确定性的正向推进可乐观预测。revert(后端决定退到哪一步)不在此表,
// 乐观期只显示 busy、不猜 status,落地时用服务端返回的权威 status 校正。
const NEXT_STATUS: Record<string, string> = {
  prepare: 'prepared',
  assign: 'assigned',
  start_work: 'in_progress',
  generate: 'generated',
  fail: 'rejected',
  submit_review: 'ready_for_review',
  start_review: 'reviewing',
  approve: 'approved',
  reject: 'rejected',
  publish: 'published',
  resubmit: 'reviewing',
  reassign: 'created',
}

// 把某个项目在所有列表分片(不同 search/status/sort 各一份缓存)里的 status 就地改写。
function withStatus(data: InfiniteProjects, id: string, status: string): InfiniteProjects {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === id ? { ...item, status } : item)),
    })),
  }
}

// 乐观「推进状态」(对齐 .claude/skills/optimistic-updates 范式)。
// - onMutate:cancel 在途 list 重拉 → 快照所有 list 分片 → 确定性动作(NEXT_STATUS)即时改那一行徽章;
//   revert 这类落点后端才知道的不猜,只显示 busy。
// - onSuccess:用服务端返回的权威 status setQueryData 校正(补上 revert 的落点),不 invalidate 重拉 → 徽章不闪。
// - onError:被取消(连点/切换触发的 abort)静默不回滚;真失败才回滚快照 + refetch 对账
//   (快照可能是并发乐观中间值,单纯回滚会停在错误态)。
// - onSettled:stats 是小对象无缩略图 → active 重拉让 tab 计数即时更新;list 含缩略图 →
//   只 refetchType:'none' 标记过期(避免图片闪烁),筛选 tab 下的成员归属下次 mount 再同步。
// abort 按 project id 用 Map 隔离:同一项目快速连点取消上一次在途,切到别的项目不误杀其在途保存。
export function useChangeProjectStatus() {
  const controllersRef = useRef(new Map<string, AbortController>())
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => {
      controllersRef.current.get(id)?.abort()
      const controller = new AbortController()
      controllersRef.current.set(id, controller)
      return changeBffProjectStatus({ path: { id }, body: { action }, signal: controller.signal })
    },
    onMutate: async ({ id, action }) => {
      const listsKey = queryKeys.projects.lists()
      await queryClient.cancelQueries({ queryKey: listsKey })
      const previousLists = queryClient.getQueriesData<InfiniteProjects>({ queryKey: listsKey })
      const next = NEXT_STATUS[action]
      if (next) {
        queryClient.setQueriesData<InfiniteProjects>({ queryKey: listsKey }, (old) =>
          old ? withStatus(old, id, next) : old,
        )
      }
      return { previousLists }
    },
    onSuccess: (data) => {
      queryClient.setQueriesData<InfiniteProjects>({ queryKey: queryKeys.projects.lists() }, (old) =>
        old ? withStatus(old, data.id, data.status) : old,
      )
    },
    onError: (error, _vars, context) => {
      if (isAbort(error)) return
      for (const [key, data] of context?.previousLists ?? []) {
        queryClient.setQueryData(key, data)
      }
      void queryClient.refetchQueries({ queryKey: queryKeys.projects.lists() })
      toast.error(error instanceof Error && error.message ? error.message : '状态变更失败')
    },
    onSettled: (_data, error) => {
      if (isAbort(error)) return // 被取消的那次不做对账,交给胜出的那次
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.stats() })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
        refetchType: 'none',
      })
    },
  })
}
