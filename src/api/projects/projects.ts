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
import { useTranslation } from 'react-i18next'

import type {
  BffComment,
  BffCommentPage,
  BffProject,
  BffProjectAsset,
  BffProjectMetaRequest,
  BffProjectPage,
  BffProjectSaveRequest,
  BffSession,
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
import i18n from '@/i18n'
import { ApiError, requestJson } from '@/lib/api-client'
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
        assignee: params.assignee || undefined,
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

// 负责人筛选的计数。All 用 stats.total;Unassigned('unassigned')/My(当前用户 id)各发一个
// limit:1 的列表读 total(全局计数,不跟随搜索框——与状态计数一致)。key 挂在 stats 前缀下,
// 随 stats 一起失效(状态/指派变更时)。assignee 为空则不查(如 me 但会话未就绪)。
export function useAssigneeCount(assignee: string, enabled: boolean) {
  return useQuery({
    enabled: enabled && Boolean(assignee),
    queryKey: queryKeys.projects.assigneeCount(assignee),
    queryFn: () => listBffProjects({ query: { limit: 1, assignee } }),
    select: (page) => page.total,
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

// 保存项目元数据。乐观:meta 字段与 detail 同名同义 → onMutate 直接 { ...detail, ...meta } 就地覆盖,
// 详情表单一关就是新值,不等往返。派生字段(name 由 address 拼、assignee/agency 名字由 id 查)前端
// 猜不准,保持旧值、留给 onSuccess 用服务端返回的权威 { name, detail } 校正;失败回滚快照。
// 地址字段会改标题,故列表标记过期下次 mount 再同步(不立即重拉,免得缩略图闪)。
export function useSaveProjectMeta() {
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: BffProjectMetaRequest }) =>
      saveBffProjectMeta({ path: { id }, body: meta }),
    onMutate: async ({ id, meta }) => {
      const key = queryKeys.projects.detail(id)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BffProject>(key)
      queryClient.setQueryData<BffProject>(key, (old) =>
        old ? { ...old, detail: { ...old.detail, ...meta } } : old,
      )
      return { key, previous }
    },
    onSuccess: ({ name, detail }, { id }) => {
      queryClient.setQueryData<BffProject>(queryKeys.projects.detail(id), (old) =>
        old ? { ...old, name, detail } : old,
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists(), refetchType: 'none' })
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      toast.error(error instanceof Error && error.message ? error.message : t('projects.saveFailed'))
    },
  })
}

// 评论。项目级与资产级同形 → 一对 hook 带 entity 参数,不写两份。
// enabled:详情面板折叠时不拉;资产评论只在预览弹窗打开时拉。
type CommentEntity = 'project' | 'asset'

// 无限向后分页(评论 pane:项目详情「评论」Tab 与资产灯箱共用,上拉取更旧的一页)。
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

// 评论角标不在评论缓存里:项目级是 detail.commentCount,资产级是 detail.assets[].commentCount。
// 增删评论时同步 bump,否则角标要等下次拉详情才动(onSettled 只标记过期、不重拉)。资产不知属于
// 哪个 project → 扫所有 detail 缓存按 assetId 命中;项目直接改该 detail。onError 反向 bump 回滚。
function adjustCommentCount(entity: CommentEntity, id: string, delta: number) {
  if (entity === 'project') {
    queryClient.setQueryData<BffProject>(queryKeys.projects.detail(id), (old) =>
      old ? { ...old, detail: { ...old.detail, commentCount: Math.max(0, (old.detail.commentCount ?? 0) + delta) } } : old,
    )
    return
  }
  queryClient.setQueriesData<BffProject>(
    { queryKey: queryKeys.projects.all, predicate: (q) => q.queryKey[2] === 'detail' },
    (old) => {
      if (!old?.detail?.assets?.some((a) => a.id === id)) return old
      return {
        ...old,
        detail: {
          ...old.detail,
          assets: old.detail.assets.map((a) =>
            a.id === id ? { ...a, commentCount: Math.max(0, a.commentCount + delta) } : a,
          ),
        },
      }
    },
  )
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
  const { t } = useTranslation()
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
      // 带上当前用户:否则乐观项 authorId 为空 → 先按「别人」渲染到左边,onSuccess 才翻到右(左→右闪烁)
      const me = queryClient.getQueryData<BffSession>(queryKeys.session())?.user
      queryClient.setQueryData<CommentCache>(key, (old) =>
        appendComment(old, {
          id: tempId,
          author: me?.name ?? '…',
          authorId: me?.id ?? null,
          content,
          createdAt: new Date().toISOString(),
        }),
      )
      adjustCommentCount(entity, id, 1) // 角标 +1(乐观)
      return { key, previous, tempId }
    },
    onSuccess: (created, _vars, context) => {
      if (!context) return
      queryClient.setQueryData<CommentCache>(context.key, (old) =>
        patchComments(old, (items) => items.map((c) => (c.id === context.tempId ? created : c))),
      )
    },
    onError: (error, { id }, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      adjustCommentCount(entity, id, -1) // 回滚角标
      toast.error(error instanceof Error && error.message ? error.message : t('projects.commentFailed'))
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

// minio 预签名 PUT。fetch 拿不到上传进度 → 用 XHR 的 upload.onprogress(与库里 http-transport 同款)。
// signal 支持中止;onProgress 回传已传字节数(调用方按总字节聚合成百分比)。
function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  opts?: { signal?: AbortSignal; onProgress?: (loadedBytes: number) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('content-type', contentType)
    if (opts?.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(e.loaded)
      }
    }
    const fail = (status: number) => reject(new Error(i18n.t('projects.attachmentUploadFailed', { status })))
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : fail(xhr.status))
    xhr.onerror = () => fail(0)
    if (opts?.signal) {
      if (opts.signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true })
      xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))
    }
    xhr.send(file)
  })
}

// 附件上传三步:换票 → 浏览器直传 minio 预签名地址 → 落库。
// 中间那步刻意绕开 BFF —— 50MB 的文件没必要在 Node 里过一遍(一次内存拷贝 + 一倍带宽)。
// 不是 hook:调用方要对 N 个文件并发跑它,做成 hook 反而得自己排队。onProgress 回传已传字节。
export async function uploadAttachment(
  file: File,
  signal?: AbortSignal,
  onProgress?: (loadedBytes: number) => void,
): Promise<string> {
  const contentType = file.type || 'application/octet-stream'
  const { contentId, uploadUrl } = await createBffUpload({
    body: { fileName: file.name, contentType, fileSize: file.size },
  })
  await putWithProgress(uploadUrl, file, contentType, { signal, onProgress })
  await completeBffUpload({ path: { id: contentId } })
  return contentId
}

// 编辑 / 删除评论。上游按全局 comment id 寻址,但缓存是按 entity 分的 →
// 调用方把所属 entity/entityId 一起传进来,省得为了找一条评论去遍历所有评论缓存。
export function useEditComment(entity: CommentEntity) {
  const { t } = useTranslation()
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
      toast.error(error instanceof Error && error.message ? error.message : t('projects.commentEditFailed'))
    },
  })
}

export function useDeleteComment(entity: CommentEntity) {
  const { t } = useTranslation()
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
      adjustCommentCount(entity, entityId, -1) // 角标 -1(乐观)
      return { key, previous }
    },
    onError: (error, { entityId }, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      adjustCommentCount(entity, entityId, 1) // 回滚角标
      toast.error(error instanceof Error && error.message ? error.message : t('projects.commentDeleteFailed'))
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
  const { t } = useTranslation()
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
      // 指派变了 → 未指派/我的 计数随之变(计数 key 挂在 stats 前缀下,一并失效)
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.stats() })
    },
    onError: (error) => {
      toast.error(error instanceof Error && error.message ? error.message : t('projects.assignFailed'))
    },
  })
}

// 资产房间标签。下游按名字全量覆盖 → 前端也传全量,省掉 add/remove 两套语义。
// 乐观改 detail.assets[].tags:标签是灯箱里即时反馈的东西,等一个往返会明显发木。
export function useSaveAssetTags() {
  const { t } = useTranslation()
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
      toast.error(error instanceof Error && error.message ? error.message : t('projects.tagSaveFailed'))
    },
  })
}

// agent asset 的描述(存 prompt 文本):上游按 (project_id, asset_id) upsert,不重建 id → 乐观改缓存即可、无需重拉。
// 端点新增、生成 client 未含,走 requestJson 打 /bff/*(同 reorder)。
export function useSaveAssetDescription() {
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({ projectId, assetId, description }: { projectId: string; assetId: string; description: string }) =>
      requestJson<{ description: string }>(`/bff/projects/${projectId}/assets/${assetId}/description`, {
        method: 'PUT',
        json: { description },
      }),
    onMutate: async ({ projectId, assetId, description }) => {
      const key = queryKeys.projects.detail(projectId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BffProject>(key)
      queryClient.setQueryData<BffProject>(key, (old) =>
        old
          ? {
              ...old,
              detail: {
                ...old.detail,
                assets: old.detail.assets?.map((a) => (a.id === assetId ? ({ ...a, description } as BffProjectAsset) : a)),
              },
            }
          : old,
      )
      return { key, previous }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      toast.error(error instanceof Error && error.message ? error.message : t('projects.descriptionSaveFailed'))
    },
  })
}

// 可见性。下游只回 204,BFF 回显入参 → 直接就地改 detail 缓存。
export function useSaveProjectVisibility() {
  const { t } = useTranslation()
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
      toast.error(error instanceof Error && error.message ? error.message : t('projects.visibilityUpdateFailed'))
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

// 发布到平台:把已存时间线里指向本地 server 的素材上传 xchangeai + 改写引用 + 回存时间线。
// 端点新增、生成 client 未含,直接走 requestJson 打 /bff/*(同源代理)。发布前先保存(读的是已存态)。
export function usePublishProject() {
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      requestJson<{ id: string; uploaded: number; skipped: number }>(`/bff/projects/${id}/publish`, {
        method: 'POST',
      }),
    onSuccess: (data, { id }) => {
      toast.success(
        t('projects.published', { uploaded: data.uploaded }) +
          (data.skipped ? t('projects.publishedSkipped', { skipped: data.skipped }) : ''),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(id) })
    },
    onError: () => toast.error(t('projects.publishFailed')),
  })
}

// 成片交付:把编辑器渲染产物(server/ 的 render URL)上传平台绑为 creator-asset。
export function useDeliverProject() {
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({ id, videoUrl }: { id: string; videoUrl: string }) =>
      requestJson<{ id: string; contentId: string }>(`/bff/projects/${id}/deliver`, {
        method: 'POST',
        json: { videoUrl },
      }),
    onSuccess: (_data, { id }) => {
      toast.success(t('projects.delivered'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(id) })
    },
    onError: () => toast.error(t('projects.deliverFailed')),
  })
}

// 上传图片登记为项目 agent-asset(面板「Clips」组):并发直传 minio(uploadAttachment)拿 content_id,
// 再一次性 POST 给 BFF 单次整表替换追加(逐个调会互相覆盖)。成功后刷新详情。端点走 requestJson(同 deliver)。
export function useUploadAgentAssets() {
  const { t } = useTranslation()
  return useMutation({
    mutationFn: async ({
      projectId,
      files,
      onFile,
    }: {
      projectId: string
      files: File[]
      // 逐文件回报:上传中给 pct(0..1),终态给 status;调用方按 index 落到对应行。
      onFile?: (index: number, update: { pct?: number; status?: 'done' | 'error' }) => void
    }) => {
      // 单文件成败:allSettled 独立跑,失败的不拖累其余;只把成功的 content_id 批量登记。
      const settled = await Promise.allSettled(
        files.map((f, i) =>
          uploadAttachment(f, undefined, (bytes) => onFile?.(i, { pct: f.size ? Math.min(1, bytes / f.size) : 1 }))
            .then((contentId) => {
              onFile?.(i, { pct: 1, status: 'done' })
              return contentId
            })
            .catch((e) => {
              onFile?.(i, { status: 'error' })
              throw e
            }),
        ),
      )
      const items = settled.flatMap((r, i) => (r.status === 'fulfilled' ? [{ contentId: r.value, name: files[i].name }] : []))
      const failed = settled.length - items.length
      let added = 0
      if (items.length) {
        const res = await requestJson<{ id: string; added: number }>(`/bff/projects/${projectId}/agent-assets`, {
          method: 'POST',
          json: { contentIds: items.map((it) => it.contentId) },
        })
        added = res.added
      }
      return { added, failed, items }
    },
    onSuccess: ({ added, failed, items }, { projectId }) => {
      if (items.length) {
        // 乐观:成功的直接插进详情缓存的 agent 组(url 走 /bff/content 内容解析,即时可显),clipCount +N。
        // 只标记过期、不立刻重拉(refetchType:'none')—— 免得刚插的乐观条目被回填闪一下;下次 mount 再同步
        // 真身(真实 id/海报)。按 content_id 去重,与 useDeleteProjectAsset 同套路。
        const key = queryKeys.projects.detail(projectId)
        queryClient.setQueryData<BffProject>(key, (old) => {
          if (!old?.detail) return old
          const existing = new Set((old.detail.assets ?? []).map((a) => a.contentId ?? a.id))
          const fresh: BffProjectAsset[] = items
            .filter((it) => !existing.has(it.contentId))
            .map((it) => ({
              id: it.contentId,
              contentId: it.contentId,
              group: 'agent',
              url: `/bff/content/${it.contentId}`,
              kind: 'image',
              name: it.name,
              commentCount: 0,
              thumbnailUrl: null,
            }))
          if (!fresh.length) return old
          return {
            ...old,
            detail: {
              ...old.detail,
              assets: [...(old.detail.assets ?? []), ...fresh],
              clipCount: old.detail.clipCount + fresh.length,
            },
          }
        })
        toast.success(t('projects.agentAssetsUploaded', { count: added }))
        void queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' })
      }
      if (failed) toast.error(t('projects.agentAssetsPartialFailed', { count: failed }))
    },
    // 登记(replaceProjectAgentAssets)失败才到这;逐文件上传失败已在上面就地标记、不 throw。
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('projects.agentAssetUploadFailed')),
  })
}

// 删除项目资产(上游无单删,BFF 用整表替换实现)。乐观:从 detail.assets 摘掉该条 + 资源/片段计数减一,
// 失败回滚。端点走 requestJson(未进生成 client,同 publish/deliver)。列表卡片缩略图可能取自它 →
// 标记过期,下次 mount 再同步(不立刻重拉,免得缩略图闪)。
export function useDeleteProjectAsset() {
  const { t } = useTranslation()
  return useMutation({
    // assetKey = content_id(稳定):整表替换会重建资产 id,按 id 删第二次起会 404(见 BFF 注释)。
    mutationFn: ({ projectId, assetKey }: { projectId: string; assetKey: string }) =>
      requestJson<{ id: string; assetId: string }>(`/bff/projects/${projectId}/assets/${assetKey}`, {
        method: 'DELETE',
      }),
    onMutate: async ({ projectId, assetKey }) => {
      const key = queryKeys.projects.detail(projectId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BffProject>(key)
      queryClient.setQueryData<BffProject>(key, (old) => {
        const target = old?.detail?.assets?.find((a) => (a.contentId ?? a.id) === assetKey)
        if (!old || !target) return old
        return {
          ...old,
          detail: {
            ...old.detail,
            assets: (old.detail.assets ?? []).filter((a) => (a.contentId ?? a.id) !== assetKey),
            resourceCount:
              target.group === 'creator' ? Math.max(0, old.detail.resourceCount - 1) : old.detail.resourceCount,
            clipCount: target.group === 'agent' ? Math.max(0, old.detail.clipCount - 1) : old.detail.clipCount,
          },
        }
      })
      return { key, previous }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      toast.error(error instanceof Error && error.message ? error.message : t('projects.assetDeleteFailed'))
    },
    onSettled: (_d, _e, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists(), refetchType: 'none' })
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId), refetchType: 'none' })
    },
  })
}

// 排序项目 agent-asset(「Clips」组):上游无「移动」,BFF 用整表替换实现。乐观:把 detail.assets 里 agent 组
// 按新 content_id 顺序就地重排(creator 组原位不动),失败回滚。按 content_id 定序(整表替换会重建 id)。
// contentIds 必须是当前 agent 组的完整排列 —— BFF 校验集合一致,对不上回 409(并发增删)→ 回滚 + 提示。
export function useReorderAgentAssets() {
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({ projectId, contentIds }: { projectId: string; contentIds: string[] }) =>
      requestJson<{ id: string }>(`/bff/projects/${projectId}/agent-assets/order`, {
        method: 'PUT',
        json: { contentIds },
      }),
    onMutate: async ({ projectId, contentIds }) => {
      const key = queryKeys.projects.detail(projectId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BffProject>(key)
      queryClient.setQueryData<BffProject>(key, (old) => {
        if (!old?.detail?.assets) return old
        const keyOf = (a: BffProjectAsset) => a.contentId ?? a.id
        const rank = new Map(contentIds.map((c, i) => [c, i]))
        const agents = old.detail.assets
          .filter((a) => a.group === 'agent')
          .slice()
          .sort((x, y) => (rank.get(keyOf(x)) ?? 0) - (rank.get(keyOf(y)) ?? 0))
        // 把重排后的 agent 组按原有 agent 槽位倒回扁平数组(creator 槽位保持不动)
        let ai = 0
        const assets = old.detail.assets.map((a) => (a.group === 'agent' ? agents[ai++] : a))
        return { ...old, detail: { ...old.detail, assets } }
      })
      return { key, previous }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      toast.error(error instanceof Error && error.message ? error.message : t('projects.assetReorderFailed'))
    },
    // 整表替换会重建每个 agent 资产的 id → 必须真重拉,否则缓存里的旧 id 一失效,点开预览拉 comments 就 404。
    // order 只存 content_id(稳定),重拉后顺序照旧、只把对象/ id 换成新的。
    onSettled: (_d, _e, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId), refetchType: 'active' })
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
  const { t } = useTranslation()
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
      toast.error(error instanceof Error && error.message ? error.message : t('projects.statusChangeFailed'))
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
