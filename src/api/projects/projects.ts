import { useCallback, useRef } from 'react'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  type InfiniteData,
} from '@tanstack/react-query'
import { toast } from 'sonner'

import type {
  BffComment,
  BffCommentPage,
  BffProject,
  BffProjectMetaRequest,
  BffProjectPage,
  BffProjectSaveRequest,
  BffTag,
} from '@/generated/api-types'
import {
  changeBffProjectStatus,
  completeBffUpload,
  createBffAssetComment,
  createBffProjectComment,
  createBffUpload,
  deleteBffComment,
  getBffProject,
  getBffProjectAnalytics,
  getBffProjectOptions,
  getBffProjectStats,
  listBffAssetComments,
  listBffProjects,
  listBffProjectComments,
  saveBffAssetTags,
  saveBffComment,
  saveBffProject,
  saveBffProjectAssignee,
  saveBffProjectMeta,
  saveBffProjectVisibility,
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

  // 稳定身份:会一路传到 memo 化的 ListHeader,每帧新建就等于没 memo
  const refetch = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() }),
    [],
  )

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
    refetch,
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

// 评论。项目级与资产级同形 → 一对 hook 带 entity 参数,不写两份。
// enabled:详情面板折叠时不拉;资产评论只在预览弹窗打开时拉。
type CommentEntity = 'project' | 'asset'

// 单页(项目面板:窄栏、紧凑,一次拉够即可)。limit 100 与改分页前一致,不回归。
export function useComments(entity: CommentEntity, id: string | null, enabled = true) {
  return useQuery({
    enabled: Boolean(id) && enabled,
    queryKey: queryKeys.projects.comments(entity, id ?? ''),
    queryFn: () =>
      entity === 'project'
        ? listBffProjectComments({ path: { id: id! }, query: { limit: 100 } })
        : listBffAssetComments({ path: { id: id! }, query: { limit: 100 } }),
  })
}

// 无限向后分页(资产灯箱:Message Scroller 聊天流,上拉取更旧的一页)。
// 上游按时间正序(offset 0 = 最旧),所以「尾页」= 最新那 20 条 → 起始 offset = total-20。
// total 直接用已知的 asset.commentCount(详情早已加载),不额外请求。fetchPreviousPage 取更旧。
// 缓存键与单页版同一个(comments(entity,id))—— 但资产评论只走这条路,项目只走单页,不撞。
export const COMMENTS_PAGE = 20
// pageParam 必须带 limit 而非只带 offset:尾页只有 total-offset 条(如 total 25、尾页 offset 5 → 20 条),
// 更旧那页跨 [prevOffset, firstOffset),宽度 = firstOffset-prevOffset,可能不足一页。
// 固定 limit 会让相邻两页重叠(offset 5 减 20 → 0,limit 20 抓 #1-#20,与尾页 #6-#25 撞 #6-#20)。
type CommentPageParam = { offset: number; limit: number }
export function useInfiniteComments(
  entity: CommentEntity,
  id: string | null,
  total: number,
  enabled = true,
) {
  const tailOffset = Math.max(0, total - COMMENTS_PAGE)
  return useInfiniteQuery({
    enabled: Boolean(id) && enabled,
    queryKey: queryKeys.projects.comments(entity, id ?? ''),
    // 尾页 = 最新那批:[tailOffset, total),宽度 total-tailOffset(≤20)
    initialPageParam: { offset: tailOffset, limit: total - tailOffset || COMMENTS_PAGE } as CommentPageParam,
    queryFn: ({ pageParam }) =>
      entity === 'project'
        ? listBffProjectComments({ path: { id: id! }, query: pageParam })
        : listBffAssetComments({ path: { id: id! }, query: pageParam }),
    // 更旧一页:[max(0, firstOffset-20), firstOffset);到 0 就没有更早的了
    getPreviousPageParam: (firstPage): CommentPageParam | undefined => {
      if (firstPage.offset <= 0) return undefined
      const offset = Math.max(0, firstPage.offset - COMMENTS_PAGE)
      return { offset, limit: firstPage.offset - offset }
    },
    // 不向后翻:新评论走乐观追加,不靠 next page
    getNextPageParam: () => undefined,
  })
}

// 评论缓存有两种形状:项目面板是单页 BffCommentPage,资产灯箱是 InfiniteData。
// 三个 mutation 共用,故把「改缓存」抽成形状无关的工具 —— 否则每个 mutation 都要分叉两次。
type CommentCache = BffCommentPage | InfiniteData<BffCommentPage>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isInfinite = (v: any): v is InfiniteData<BffCommentPage> => Boolean(v) && Array.isArray(v.pages)

// 编辑/删除:对每页 items 跑同一个变换;total 只调最后一页(hook 读的就是它),免得各页漂移。
function patchComments(
  old: CommentCache | undefined,
  fn: (items: BffComment[]) => BffComment[],
  totalDelta = 0,
): CommentCache | undefined {
  if (!old) return old
  if (isInfinite(old)) {
    const last = old.pages.length - 1
    return {
      ...old,
      pages: old.pages.map((p, i) => ({
        ...p,
        items: fn(p.items),
        total: i === last ? Math.max(0, p.total + totalDelta) : p.total,
      })),
    }
  }
  return { ...old, items: fn(old.items), total: Math.max(0, old.total + totalDelta) }
}

// 追加:落到最新端(单页 = items 末尾;无限 = 最后一页末尾)
function appendComment(old: CommentCache | undefined, comment: BffComment): CommentCache | undefined {
  if (!old) return old
  if (isInfinite(old)) {
    const pages = old.pages.slice()
    const last = pages.length - 1
    if (last < 0) return old
    pages[last] = { ...pages[last], items: [...pages[last].items, comment], total: pages[last].total + 1 }
    return { ...old, pages }
  }
  return { ...old, items: [...old.items, comment], total: old.total + 1 }
}

// 乐观追加:评论是纯追加的时间线,失败只需把那条临时项摘掉 —— 比快照整页再回滚简单。
// 服务端返回的真实 id/时间戳在 onSuccess 就地替换掉临时项,不重拉(重拉会让长线程跳一下)。
export function useCreateComment(entity: CommentEntity) {
  return useMutation({
    mutationFn: ({ id, content, attachmentContentIds }: { id: string; content: string; attachmentContentIds?: string[] }) =>
      entity === 'project'
        ? createBffProjectComment({ path: { id }, body: { content, attachmentContentIds } })
        : createBffAssetComment({ path: { id }, body: { content, attachmentContentIds } }),
    onMutate: async ({ id, content }) => {
      const key = queryKeys.projects.comments(entity, id)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<CommentCache>(key)
      // 临时 id 用时间戳,避免与「total 相同」的老写法在快速连发时撞号
      const tempId = `pending:${Date.now()}`
      queryClient.setQueryData<CommentCache>(key, (old) =>
        appendComment(old, { id: tempId, author: '…', content, createdAt: new Date().toISOString() }),
      )
      return { key, previous, tempId }
    },
    onSuccess: (created, _vars, context) => {
      if (!context) return
      queryClient.setQueryData<CommentCache>(context.key, (old) =>
        patchComments(old, (items) => items.map((c) => (c.id === context.tempId ? created : c))),
      )
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      toast.error(error instanceof Error && error.message ? error.message : '评论失败')
    },
    // 计数挂在 detail(资产评论角标也在 detail.assets 里)→ 标记过期,下次展开再对账,
    // 不立刻重拉:详情带全部 asset url,重拉会让缩略图闪一遍。
    onSettled: (_d, _e, { id }) =>
      void queryClient.invalidateQueries({
        queryKey: entity === 'project' ? queryKeys.projects.detail(id) : queryKeys.projects.all,
        refetchType: 'none',
      }),
  })
}

// 项目分析。只对发布过的项目有意义 → 由调用方按状态决定 enabled,不是每开详情都拉。
// 上游 404/403 时静默(analytics 是 frontend 域的端点,权限不一定给到每个 workbench 用户)。
export function useProjectAnalytics(id: string | null, enabled: boolean) {
  return useQuery({
    enabled: Boolean(id) && enabled,
    queryKey: queryKeys.projects.analytics(id ?? ''),
    queryFn: () => getBffProjectAnalytics({ path: { id: id! } }),
    retry: false,
    staleTime: 60 * 1000,
  })
}

// 附件上传三步:换票 → 浏览器直传 minio 预签名地址 → 落库。
// 中间那步刻意绕开 BFF —— 50MB 的文件没必要在 Node 里过一遍(一次内存拷贝 + 一倍带宽)。
// 不是 hook:调用方要对 N 个文件并发跑它,做成 hook 反而得自己排队。
export async function uploadAttachment(file: File, signal?: AbortSignal): Promise<string> {
  const { contentId, uploadUrl } = await createBffUpload({
    body: { fileName: file.name, contentType: file.type || 'application/octet-stream', fileSize: file.size },
  })
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'content-type': file.type || 'application/octet-stream' },
    signal,
  })
  if (!put.ok) throw new Error(`附件上传失败 (${put.status})`)
  await completeBffUpload({ path: { id: contentId } })
  return contentId
}

// 编辑 / 删除评论。上游按全局 comment id 寻址,但缓存是按 entity 分的 →
// 调用方把所属 entity/entityId 一起传进来,省得为了找一条评论去遍历所有评论缓存。
export function useEditComment(entity: CommentEntity) {
  return useMutation({
    mutationFn: ({ commentId, content }: { entityId: string; commentId: string; content: string }) =>
      saveBffComment({ path: { id: commentId }, body: { content } }),
    onMutate: async ({ entityId, commentId, content }) => {
      const key = queryKeys.projects.comments(entity, entityId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<CommentCache>(key)
      queryClient.setQueryData<CommentCache>(key, (old) =>
        patchComments(old, (items) => items.map((c) => (c.id === commentId ? { ...c, content } : c))),
      )
      return { key, previous }
    },
    // 用服务端返回的整条替换:乐观值只改了 content,editedAt 只有服务端知道
    // (不校正的话「已编辑」标记要等下次重拉才出现,看着像没生效)
    onSuccess: (updated, { commentId }, context) => {
      queryClient.setQueryData<CommentCache>(context.key, (old) =>
        patchComments(old, (items) => items.map((c) => (c.id === commentId ? updated : c))),
      )
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      toast.error(error instanceof Error && error.message ? error.message : '评论修改失败')
    },
  })
}

export function useDeleteComment(entity: CommentEntity) {
  return useMutation({
    mutationFn: ({ commentId }: { entityId: string; commentId: string }) =>
      deleteBffComment({ path: { id: commentId } }),
    onMutate: async ({ entityId, commentId }) => {
      const key = queryKeys.projects.comments(entity, entityId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<CommentCache>(key)
      queryClient.setQueryData<CommentCache>(key, (old) =>
        patchComments(old, (items) => items.filter((c) => c.id !== commentId), -1),
      )
      return { key, previous }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      toast.error(error instanceof Error && error.message ? error.message : '评论删除失败')
    },
    onSettled: (_d, _e, { entityId }) =>
      void queryClient.invalidateQueries({
        queryKey: entity === 'project' ? queryKeys.projects.detail(entityId) : queryKeys.projects.all,
        refetchType: 'none',
      }),
  })
}

// 指派。'me' 是哨兵值 → 服务端解析成当前会话用户(前端不必先去问自己的 id)。
export function useSaveProjectAssignee() {
  return useMutation({
    mutationFn: ({ id, assigneeId }: { id: string; assigneeId: string | null }) =>
      saveBffProjectAssignee({ path: { id }, body: { assigneeId } }),
    // 不做乐观:'me' 的落点只有服务端知道,猜不出名字。用返回值就地校正,仍然只花一次往返。
    onSuccess: ({ assignee, assigneeId }, { id }) => {
      queryClient.setQueryData<BffProject>(queryKeys.projects.detail(id), (old) =>
        old ? { ...old, detail: { ...old.detail, assignee, assigneeId } } : old,
      )
      // 列表卡片也显示 assignee → 标记过期,下次 mount 再同步(不立刻重拉,免得缩略图闪)
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists(), refetchType: 'none' })
    },
    onError: (error) => {
      toast.error(error instanceof Error && error.message ? error.message : '指派失败')
    },
  })
}

// 资产房间标签。下游按名字全量覆盖 → 前端也传全量,省掉 add/remove 两套语义。
// 乐观改 detail.assets[].tags:标签是灯箱里即时反馈的东西,等一个往返会明显发木。
export function useSaveAssetTags() {
  return useMutation({
    mutationFn: ({ projectId, assetId, tags }: { projectId: string; assetId: string; tags: BffTag[] }) =>
      saveBffAssetTags({ path: { id: projectId, assetId }, body: { tagIds: tags.map((t) => t.id) } }),
    onMutate: async ({ projectId, assetId, tags }) => {
      const key = queryKeys.projects.detail(projectId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BffProject>(key)
      queryClient.setQueryData<BffProject>(key, (old) =>
        old
          ? {
              ...old,
              detail: {
                ...old.detail,
                assets: old.detail.assets?.map((a) => (a.id === assetId ? { ...a, tags } : a)),
              },
            }
          : old,
      )
      return { key, previous }
    },
    // 用服务端回的规范名校正乐观值(上游会把 "living room" 折成 "living_room")
    onSuccess: ({ tags }, { assetId }, context) => {
      queryClient.setQueryData<BffProject>(context.key, (old) =>
        old
          ? {
              ...old,
              detail: {
                ...old.detail,
                assets: old.detail.assets?.map((a) => (a.id === assetId ? { ...a, tags } : a)),
              },
            }
          : old,
      )
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      toast.error(error instanceof Error && error.message ? error.message : '标签保存失败')
    },
  })
}

// 可见性。下游只回 204,BFF 回显入参 → 直接就地改 detail 缓存。
export function useSaveProjectVisibility() {
  return useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: 'public' | 'agency' | 'owner_private' }) =>
      saveBffProjectVisibility({ path: { id }, body: { visibility } }),
    onMutate: async ({ id, visibility }) => {
      const key = queryKeys.projects.detail(id)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BffProject>(key)
      queryClient.setQueryData<BffProject>(key, (old) =>
        old ? { ...old, detail: { ...old.detail, visibility } } : old,
      )
      return { key, previous }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      toast.error(error instanceof Error && error.message ? error.message : '可见性修改失败')
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
