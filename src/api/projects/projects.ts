import { useRef } from 'react'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
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

type InfiniteProjects = InfiniteData<BffProjectPage, number>

const isAbort = (error: unknown) => error instanceof ApiError && error.kind === 'abort'

// BFF 的 limit 上限。刷新还原时首页一次拿回原来翻了几页的量,超过这个数只能还原到 100 条附近。
const PROJECTS_MAX_LIMIT = 100

// 无限列表:offset 分页,getNextPageParam 累加已加载数直到 total。sort 只认服务端字段
// (created/updated);name 排序由调用方在已加载项上做(xchangeai 只支持时间字段服务端排序)。
//
// restoreCount:刷新前已加载的条数。首页请求直接按这个量取,一次补齐 —— 否则从 20 条重来,
// 还原的 scrollTop 超出内容高度会被夹到底,再触发 IO 连锁补页,看着会抽。
// 用 ref 固化在挂载那一刻:它不进 queryKey(进了每次翻页都会换键重拉),
// 只影响第一次请求;后续 pageParam>0 一律回到常规页大小。
export function useInfiniteProjects(params: ProjectListParams, restoreCount = 0) {
  const firstLimit = useRef(
    Math.min(Math.max(restoreCount, PROJECTS_PAGE_SIZE), PROJECTS_MAX_LIMIT),
  )
  return useInfiniteQuery({
    queryKey: queryKeys.projects.list(params),
    queryFn: ({ pageParam }) =>
      listBffProjects({
        query: {
          limit: pageParam === 0 ? firstLimit.current : PROJECTS_PAGE_SIZE,
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
      const detailKey = queryKeys.projects.detail(id)
      await queryClient.cancelQueries({ queryKey: listsKey })
      const previousLists = queryClient.getQueriesData<InfiniteProjects>({ queryKey: listsKey })
      const previousDetail = queryClient.getQueryData<BffProject>(detailKey)
      const next = NEXT_STATUS[action]
      if (next) {
        queryClient.setQueriesData<InfiniteProjects>({ queryKey: listsKey }, (old) =>
          old ? withStatus(old, id, next) : old,
        )
        queryClient.setQueryData<BffProject>(detailKey, (old) =>
          old ? { ...old, detail: { ...old.detail, status: next } } : old,
        )
      }
      return { previousLists, previousDetail, detailKey }
    },
    onSuccess: (data) => {
      queryClient.setQueriesData<InfiniteProjects>({ queryKey: queryKeys.projects.lists() }, (old) =>
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
