import { useRef } from 'react'
import { keepPreviousData, useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import type {
  BffProject,
  BffProjectMetaRequest,
  BffProjectPage,
  BffProjectSaveRequest,
} from '@/generated/api-types'
import {
  changeBffProjectStatus,
  getBffProject,
  getBffProjectOptions,
  getBffProjectStats,
  listBffProjects,
  saveBffProject,
  saveBffProjectMeta,
} from '@/generated/client'
import { ApiError } from '@/lib/api-client'
import { queryClient } from '@/lib/query-client'
import { queryKeys, type ProjectListParams } from '@/lib/query-keys'

export const PROJECTS_PAGE_SIZE = 20

const isAbort = (error: unknown) => error instanceof ApiError && error.kind === 'abort'

const pageQuery = (params: ProjectListParams, index: number) => ({
  queryKey: queryKeys.projects.page(params, index),
  queryFn: () =>
    listBffProjects({
      query: {
        limit: PROJECTS_PAGE_SIZE,
        offset: index * PROJECTS_PAGE_SIZE,
        search: params.search || undefined,
        status: params.status || undefined,
        sort: params.sort,
      },
    }),
  // 翻回看过的一段时别闪 loading —— 这些页多半还在缓存里
  placeholderData: keepPreviousData,
})

/**
 * 「按页随机访问」而不是无限滚动 —— 这是深度还原能做到 O(1) 的前提。
 *
 * 无限滚动的模型里,第 3840 条只能靠「从头翻 192 页」抵达;而 offset 分页天生支持
 * 直接跳到第 192 页(Discord 为了这个能力专门建了时间分桶存储层,我们白捡)。
 * 所以这里不再累积 pages,而是由虚拟化器报告可见区间 → 只取覆盖该区间的那几页。
 *
 * boot 页额外的作用是拿 total:虚拟化器要先知道总高度才能定位,而 BFF 每页都返 total。
 * 还原时 boot 直接取锚点所在页,于是「刷新 → 落回原位」始终是一个请求。
 *
 * 入参是「页号区间」而非「条目区间」:后者每滚一行就变一次,会把 setState + useQueries
 * 重建摊到每一帧上;数据其实只关心跨没跨页,量化到页后 20 行才更新一次。
 */
export function useProjectPages(params: ProjectListParams, pageRange: { start: number; end: number }) {
  const boot = useQuery(pageQuery(params, pageRange.start))
  const total = boot.data?.total ?? 0

  // 可见区间覆盖的页号。total 未知时只有 boot 页(列表还没高度,虚拟化器也报不出区间)。
  const lastPage = total ? Math.min(pageRange.end, Math.floor((total - 1) / PROJECTS_PAGE_SIZE)) : pageRange.start
  const indexes: number[] = []
  for (let i = pageRange.start; i <= Math.max(pageRange.start, lastPage); i++) indexes.push(i)

  const results = useQueries({ queries: indexes.map((i) => pageQuery(params, i)) })

  // 页号 → 该页数据。虚拟行按绝对下标取:itemAt(3847) → 第 192 页的第 7 条。
  const pages = new Map<number, BffProjectPage>()
  for (const [i, r] of results.entries()) {
    const index = indexes[i]
    if (r.data && index !== undefined) pages.set(index, r.data)
  }

  return {
    total,
    itemAt: (index: number) =>
      pages.get(Math.floor(index / PROJECTS_PAGE_SIZE))?.items[index % PROJECTS_PAGE_SIZE],
    isPending: boot.isPending,
    isError: boot.isError,
    isFetching: boot.isFetching || results.some((r) => r.isFetching),
    refetch: () => void queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() }),
  }
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

// Agency / Agent / Assigned creator 三个下拉的候选。全局共用一份、极少变 → 长 staleTime,
// 且只在详情面板真正展开(enabled)时才拉,免得列表页白付一次请求。
export function useProjectOptions(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: queryKeys.projects.options(),
    queryFn: () => getBffProjectOptions({}),
    staleTime: 5 * 60 * 1000,
  })
}

// 保存项目元数据。返回的就是新 detail → 直接落缓存,不重拉(对齐乐观更新范式:用返回值校正)。
// 地址字段会改标题,故列表也要跟着刷新(标题/摘要来自同一份 xchangeai 数据)。
export function useSaveProjectMeta() {
  return useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: BffProjectMetaRequest }) =>
      saveBffProjectMeta({ path: { id }, body: meta }),
    onSuccess: ({ name, detail }, { id }) => {
      queryClient.setQueryData<BffProject>(queryKeys.projects.detail(id), (old) =>
        old ? { ...old, name, detail } : old,
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() })
    },
    onError: (error) => {
      toast.error(error instanceof Error && error.message ? error.message : '保存失败')
    },
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

// 把某个项目在所有列表分片(不同 search/status/sort × 不同页号各一份缓存)里的 status 就地改写。
// 现在每页是独立缓存条目,lists() 前缀能一把捞全 —— 比原先改 InfiniteData 的 pages 数组还简单。
function withStatus(page: BffProjectPage, id: string, status: string): BffProjectPage {
  if (!page.items.some((item) => item.id === id)) return page
  return {
    ...page,
    items: page.items.map((item) => (item.id === id ? { ...item, status } : item)),
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
      const detailKey = queryKeys.projects.detail(id)
      await queryClient.cancelQueries({ queryKey: listsKey })
      const previousLists = queryClient.getQueriesData<BffProjectPage>({ queryKey: listsKey })
      const previousDetail = queryClient.getQueryData<BffProject>(detailKey)
      const next = NEXT_STATUS[action]
      if (next) {
        queryClient.setQueriesData<BffProjectPage>({ queryKey: listsKey }, (old) =>
          old ? withStatus(old, id, next) : old,
        )
        queryClient.setQueryData<BffProject>(detailKey, (old) =>
          old ? { ...old, detail: { ...old.detail, status: next } } : old,
        )
      }
      return { previousLists, previousDetail, detailKey }
    },
    onSuccess: (data) => {
      queryClient.setQueriesData<BffProjectPage>({ queryKey: queryKeys.projects.lists() }, (old) =>
        old ? withStatus(old, data.id, data.status) : old,
      )
      // 详情面板的状态徽章走 detail 缓存,不在 list 分片里 —— 同样就地校正,否则从详情改完不动
      queryClient.setQueryData<BffProject>(queryKeys.projects.detail(data.id), (old) =>
        old ? { ...old, detail: { ...old.detail, status: data.status } } : old,
      )
    },
    onError: (error, _vars, context) => {
      if (isAbort(error)) return
      for (const [key, data] of context?.previousLists ?? []) {
        queryClient.setQueryData(key, data)
      }
      if (context?.detailKey) queryClient.setQueryData(context.detailKey, context.previousDetail)
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
