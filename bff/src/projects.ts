import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_COMPOSITION_HEIGHT,
  DEFAULT_COMPOSITION_WIDTH,
  createEmptyState,
  type UndoableState,
} from '@gedatou/shared';
import {
  approveProject,
  assignProjectToSelf,
  completeUpload,
  createProject,
  createProjectAssetsComment,
  createProjectComment,
  createUpload,
  deleteComment,
  failProject,
  generateProject,
  getProject,
  getProjectAnalyticsMetrics,
  getProjectStatistics,
  getProjectWorkbenchTimeline,
  listAgencyOptions,
  listProjectAssetsComments,
  listProjectComments,
  listProjects,
  listUserOptions,
  prepareProject,
  publishProject,
  reassignProject,
  rejectProject,
  replaceProjectAssetTagsBatch,
  resubmitProject,
  revertProject,
  startProjectReview,
  startProjectWork,
  submitProjectReview,
  updateComment,
  updateProject,
  updateProjectAssignee,
  updateProjectVisibility,
  upsertProjectWorkbenchTimeline,
} from './generated/client';
import { config } from './config';
import { mediaKind, type MediaKind } from './media';
import { forwardAuth } from './xchange-client';

// FSM 状态动作 → xchangeai 端点。start_work 为复合:created/prepared 先认领(assign)
// 再 startWork(xchangeai 只接受 assigned→in_progress);其余均为单次调用。
async function performStatusAction(
  id: string,
  action: string,
  auth: ReturnType<typeof forwardAuth>,
): Promise<void> {
  const p = { path: { id } };
  switch (action) {
    case 'prepare':
      return prepareProject(p, auth);
    case 'assign':
      return assignProjectToSelf(p, auth);
    case 'start_work': {
      const proj = await getProject(p, auth);
      if (proj.status === 'created' || proj.status === 'prepared') await assignProjectToSelf(p, auth);
      return startProjectWork(p, auth);
    }
    case 'generate':
      return generateProject(p, auth);
    case 'fail':
      return failProject(p, auth);
    case 'submit_review':
      return submitProjectReview(p, auth);
    case 'start_review':
      return startProjectReview(p, auth);
    case 'approve':
      return approveProject(p, auth);
    case 'reject':
      return rejectProject(p, auth);
    case 'publish':
      return publishProject(p, auth);
    case 'revert':
      return revertProject(p, auth);
    case 'reassign':
      return reassignProject(p, auth);
    case 'resubmit':
      return resubmitProject(p, auth);
    default:
      throw Object.assign(new Error(`unknown status action: ${action}`), { statusCode: 400 });
  }
}

// 产品项目面:BFF 用 typed xchangeai client 调下游。
// 权威时间轴模型 = UndoableState(编辑器原生);xchangeai 的 workbench-timeline 是
// schema-agnostic 的不透明 JSON(Go: map[string]interface{})→ 直接原样存取,零翻译。
// 前端只认下面 4 个 /bff/* 端点,看不到 xchangeai 的 100+ 端点。

// xchangeai 的固定角色 id(与 xchangeai-workbench 的 listAgents / listAssignees 同源)
const AGENT_ROLE_ID = '00000000-0000-0000-0000-000000000002'
const CREATOR_ROLE_ID = '00000000-0000-0000-0000-000000000003'

// 标题 = 地址(+address2)+ 城市/州,回退 "Project <id8>"(对齐 xchangeai-workbench)
const title = (p: {
  address?: string
  address2?: string
  city?: string
  state?: string
  id: string
}): string => {
  const line = [p.address, p.address2].filter(Boolean).join(' ')
  const locality = [p.city, p.state].filter(Boolean).join(', ')
  return [line, locality].filter(Boolean).join(', ') || `Project ${p.id.slice(0, 8)}`
}

// 单个 asset → {url 原件, thumbnailUrl 海报, kind 真实媒体类型}。
// url 与 thumbnailUrl 必须分开:视频带海报时,网格要的是海报,灯箱和下载要的是视频本体 ——
// 早先只返回一个 url 且视频有海报时把 kind 记成 image,网格没事,一放大就露馅。
// kind 一律按 mime 判定,不受有没有海报影响。
// kind 三态而非两态:评论附件可以是任意文件(pdf/txt/zip),当成图片塞进 <img> 只会得到一个碎图。
// 项目资产实际上只有 image/video,所以对它这第三态是死路 —— 但判定规则只该有一份。
type Media = { url: string; thumbnailUrl: string | null; kind: MediaKind }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const assetMedia = (a: any): Media | null => {
  const c = a?.content
  if (!c) return null
  const url = c.preview_url || c.download_url || c.thumbnail_url
  if (!url) return null
  return {
    url,
    thumbnailUrl: c.thumbnail_url ?? null,
    kind: mediaKind(c.mime_type),
  }
}

// 项目缩略图:首个 creator_asset,回退 agent_asset。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const firstThumb = (p: any): Media | null => {
  for (const a of [...(p.creator_assets ?? []), ...(p.agent_assets ?? [])]) {
    const m = assetMedia(a)
    if (m) return m
  }
  return null
}

// ProjectReadModel → 卡片富摘要。列表对有 asset 的项目会返回 assets,故 resources/clips/
// 缩略图能取真值(早先误判"恒 0"是因为首页样本恰好都无 asset)。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toSummary = (p: any) => {
  const thumb = firstThumb(p)
  return {
    id: p.id,
    title: title(p),
    assignee: p.assignee?.name ?? null,
    agency: p.agency?.display_name ?? p.agency?.name ?? null,
    status: p.status,
    resourceCount: p.creator_assets?.length ?? 0,
    clipCount: p.agent_assets?.length ?? 0,
    durationSeconds: p.workflow_duration_seconds ?? 0,
    // 有海报就用海报(一张图比拉 <video> metadata 便宜),没有才退回本体让前端按 kind 渲染
    thumbnailUrl: thumb?.thumbnailUrl ?? thumb?.url ?? null,
    thumbnailKind: thumb ? (thumb.thumbnailUrl ? 'image' : thumb.kind) : null,
    updatedAt: p.updated_at,
  }
}

// ProjectReadModel → 详情面板字段(对齐 xchangeai-workbench 的 "Project details" 弹窗 +
// TopBar 摘要:listing 三段 / 三格 beds-baths-sqft / 人员三选 / 统计 / 时间)。
// 单独成 detail 子对象:BffProject 顶层的 state 是时间轴,而 listing 的 state 是「州」,平铺会撞名。
// 只读:xchangeai 那套 PATCH meta 这里还没开,编辑要另开端点。
// 资产列表 → 缩略图网格用的扁平项。tags 取名字数组(对齐 workbench 图库瓦片上的标签)。
// 拿不到 URL 的也照样返回(url 为空串):以前 flatMap 把它们静默丢了,于是网格标题的
// "Resources (10)" 和统计行的 "12 resources" 互相打脸。前端 Thumb 对空 url 本就有占位。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toAssets = (list: any[] | null | undefined, kind: 'creator' | 'agent') =>
  (list ?? []).map((a) => {
    const m = assetMedia(a)
    return {
      id: a.id ?? a.content_id,
      group: kind,
      url: m?.url ?? '',
      thumbnailUrl: m?.thumbnailUrl ?? null,
      kind: m?.kind ?? 'image',
      name: a.content?.file_name ?? null,
      commentCount: a.comment_count ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tags: (a.tags ?? []).map((tag: any) => tag.name).filter(Boolean),
      // 审核双签:管理员与被指派创作者各投一票,两者都 approved 才算过。
      // 只有 agent_assets 有这两栏 —— creator 上传的原始素材不进审核。
      adminReview: a.admin_review_status ?? null,
      assigneeReview: a.assignee_review_status ?? null,
      sizeBytes: a.content?.file_size ?? null,
      durationSeconds: a.content?.duration ?? null,
    }
  })

// CommentModel → 时间线一条。author 下游只给 {name},附件复用 assetThumb 的 url/kind 判定。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toComment = (c: any) => ({
  id: c.id,
  author: c.author?.name ?? 'Unknown',
  // 前端拿它跟会话用户比,决定给不给编辑/删除入口(后端仍会再校验一次权限)
  authorId: c.author_id ?? null,
  content: c.content ?? '',
  createdAt: c.created_at,
  // 改过的评论标一下,否则别人看到内容变了却无从察觉
  editedAt: c.updated_at && c.updated_at !== c.created_at ? c.updated_at : null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachments: (c.attachments ?? []).flatMap((a: any) => {
    const m = assetMedia(a)
    return m
      ? [{ url: m.url, kind: m.kind, name: a.content?.file_name ?? null, sizeBytes: a.content?.file_size ?? null }]
      : []
  }),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toDetail = (p: any, commentCount: number) => {
  const thumb = firstThumb(p)
  return {
    status: p.status,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    listingUrl: p.listing_url ?? null,
    address: p.address ?? null,
    address2: p.address2 ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    postalCode: p.postal_code ?? null,
    propertyType: p.property_type ?? null,
    videoStyle: p.video_style ?? null,
    price: p.price ?? null,
    bedrooms: p.bedrooms ?? null,
    bathrooms: p.bathrooms ?? null,
    livingAreaSqft: p.living_area_sqft ?? null,
    agency: p.agency?.display_name ?? p.agency?.name ?? null,
    agent: p.owner?.name ?? null,
    assignee: p.assignee?.name ?? null,
    createdBy: p.created_by?.name ?? null,
    // 「现在这个状态是谁推过来的」—— 状态徽章旁边最想知道的一件事,上游一直有,之前没映射
    statusUpdatedBy: p.status_updated_by?.name ?? null,
    // 被拒项目直达 xchangeai 评审页看驳回意见(对齐 workbench 的 xchangeaiReviewUrl)。
    // 链接在 BFF 拼好:baseUrl 是部署配置,没必要泄给前端再让它拼一遍。
    reviewUrl:
      p.status === 'rejected'
        ? `${config.xchangeUpstream.replace(/\/+$/, '')}/admin/project/${encodeURIComponent(p.id)}/review`
        : null,
    // 编辑表单的下拉要按 id 选中,光有名字不够
    agencyId: p.agency_id ?? p.agency?.id ?? null,
    agentId: p.owner_id ?? p.owner?.id ?? null,
    assigneeId: p.assignee_id ?? p.assignee?.id ?? null,
    visibility: p.visibility ?? null,
    forwardCount: p.analytics?.forward_count ?? 0,
    commentCount,
    resourceCount: p.creator_assets?.length ?? 0,
    clipCount: p.agent_assets?.length ?? 0,
    durationSeconds: p.workflow_duration_seconds ?? 0,
    thumbnailUrl: thumb?.url ?? null,
    thumbnailKind: thumb?.kind ?? null,
    assets: [...toAssets(p.creator_assets, 'creator'), ...toAssets(p.agent_assets, 'agent')],
  }
}

const isUndoable = (v: unknown): v is UndoableState =>
  !!v && typeof v === 'object' && Array.isArray((v as { tracks?: unknown }).tracks);

const emptyState = (): UndoableState =>
  createEmptyState({ width: DEFAULT_COMPOSITION_WIDTH, height: DEFAULT_COMPOSITION_HEIGHT });

// 前端 sort id → xchangeai sort_by/sort_at(仅时间字段服务端可排;name 由前端在已加载项上排)。
const SORT_MAP: Record<string, [string, string]> = {
  created_desc: ['created_at', 'desc'],
  updated_desc: ['updated_at', 'desc'],
}

export const registerProjectRoutes = (app: FastifyInstance): void => {
  // state 作为不透明 object 过 spec(编辑器 state 太富,不逐字段建模);前端从
  // @gedatou/shared 拿 UndoableState 类型自行 cast。
  const opaque = { type: 'object', additionalProperties: true } as const;
  app.addSchema({
    $id: 'BffProjectSummary',
    type: 'object',
    required: ['id', 'title', 'status', 'resourceCount', 'clipCount', 'durationSeconds', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      assignee: { type: ['string', 'null'] },
      agency: { type: ['string', 'null'] },
      status: { type: 'string' },
      resourceCount: { type: 'integer' },
      clipCount: { type: 'integer' },
      durationSeconds: { type: 'number' },
      thumbnailUrl: { type: ['string', 'null'] },
      thumbnailKind: { type: ['string', 'null'] },
      updatedAt: { type: 'string' },
    },
  });
  app.addSchema({
    $id: 'BffProjectStats',
    type: 'object',
    required: ['total', 'statusCounts'],
    properties: {
      total: { type: 'integer' },
      statusCounts: { type: 'object', additionalProperties: { type: 'integer' } },
    },
  });
  const nullable = (type: 'string' | 'number') => ({ type: [type, 'null'] } as const);
  app.addSchema({
    $id: 'BffProjectAsset',
    type: 'object',
    required: ['id', 'group', 'url', 'kind', 'commentCount'],
    properties: {
      id: { type: 'string' },
      group: { type: 'string' }, // creator | agent
      url: { type: 'string' }, // 原件(灯箱/下载);拿不到时为空串
      thumbnailUrl: nullable('string'), // 海报,仅视频有;网格优先用它
      kind: { type: 'string' }, // image | video(按 mime 判,与有无海报无关)
      name: nullable('string'),
      commentCount: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
      adminReview: nullable('string'), // pending | approved | rejected(仅 agent 资产)
      assigneeReview: nullable('string'),
      sizeBytes: nullable('number'),
      durationSeconds: nullable('number'),
    },
  });
  app.addSchema({
    $id: 'BffOption',
    type: 'object',
    required: ['id', 'name'],
    properties: { id: { type: 'string' }, name: { type: 'string' } },
  });
  app.addSchema({
    $id: 'BffProjectOptions',
    type: 'object',
    required: ['agencies', 'agents', 'assignees'],
    properties: {
      agencies: { type: 'array', items: { $ref: 'BffOption#' } },
      agents: { type: 'array', items: { $ref: 'BffOption#' } },
      assignees: { type: 'array', items: { $ref: 'BffOption#' } },
    },
  });
  app.addSchema({
    $id: 'BffProjectMetaRequest',
    type: 'object',
    // 下游 updateProject 是整体替换(PUT),故表单必须把全量字段一起发回
    required: ['address', 'address2', 'city', 'state', 'postalCode', 'listingUrl', 'propertyType', 'videoStyle', 'price'],
    properties: {
      address: { type: 'string' },
      address2: { type: 'string' },
      city: { type: 'string' },
      state: { type: 'string' },
      postalCode: { type: 'string' },
      listingUrl: { type: 'string' },
      propertyType: { type: 'string' },
      videoStyle: { type: 'string' },
      price: { type: 'number' },
      bedrooms: nullable('number'),
      bathrooms: nullable('number'),
      livingAreaSqft: nullable('number'),
      agencyId: nullable('string'),
      agentId: nullable('string'),
      assigneeId: nullable('string'),
    },
  });
  // 保存元数据返回 name + detail:name(= 标题)由地址字段派生,拼法只该有 BFF 的 title() 一份,
  // 前端自己再拼一遍迟早两边漂移(xchangeai-workbench 就吃过 settings.listing 与 meta.listing 同名不同值的亏)。
  app.addSchema({
    $id: 'BffProjectMetaResponse',
    type: 'object',
    required: ['name', 'detail'],
    properties: { name: { type: 'string' }, detail: { $ref: 'BffProjectDetail#' } },
  });
  app.addSchema({
    $id: 'BffProjectDetail',
    type: 'object',
    required: ['status', 'createdAt', 'updatedAt', 'resourceCount', 'clipCount', 'durationSeconds'],
    properties: {
      status: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      listingUrl: nullable('string'),
      address: nullable('string'),
      address2: nullable('string'),
      city: nullable('string'),
      state: nullable('string'),
      postalCode: nullable('string'),
      propertyType: nullable('string'),
      videoStyle: nullable('string'),
      price: nullable('number'),
      bedrooms: nullable('number'),
      bathrooms: nullable('number'),
      livingAreaSqft: nullable('number'),
      agency: nullable('string'),
      agent: nullable('string'),
      assignee: nullable('string'),
      createdBy: nullable('string'),
      statusUpdatedBy: nullable('string'),
      reviewUrl: nullable('string'),
      agencyId: nullable('string'),
      agentId: nullable('string'),
      assigneeId: nullable('string'),
      visibility: nullable('string'),
      forwardCount: { type: 'integer' },
      commentCount: { type: 'integer' },
      resourceCount: { type: 'integer' },
      clipCount: { type: 'integer' },
      durationSeconds: { type: 'number' },
      thumbnailUrl: nullable('string'),
      thumbnailKind: nullable('string'),
      assets: { type: 'array', items: { $ref: 'BffProjectAsset#' } },
    },
  });
  app.addSchema({
    $id: 'BffProject',
    type: 'object',
    required: ['id', 'name', 'updatedAt', 'state', 'detail'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      updatedAt: { type: 'string' },
      state: opaque,
      detail: { $ref: 'BffProjectDetail#' },
      metadata: opaque,
    },
  });
  app.addSchema({
    $id: 'BffProjectSaveRequest',
    type: 'object',
    required: ['state'],
    properties: { name: { type: 'string' }, state: opaque, metadata: opaque },
  });
  app.addSchema({
    $id: 'BffProjectSaveResponse',
    type: 'object',
    required: ['id', 'updatedAt'],
    properties: { id: { type: 'string' }, updatedAt: { type: 'string' } },
  });
  app.addSchema({
    $id: 'BffProjectPage',
    type: 'object',
    required: ['items', 'total', 'limit', 'offset'],
    properties: {
      items: { type: 'array', items: { $ref: 'BffProjectSummary#' } },
      total: { type: 'integer' },
      limit: { type: 'integer' },
      offset: { type: 'integer' },
    },
  });
  // 评论:项目级与资产级同一条时间线形态(下游也是同一个 CommentModel,只是 entity_type 不同),
  // 故共用一套 schema —— 两处 UI 也就能共用一个 CommentThread。
  app.addSchema({
    $id: 'BffComment',
    type: 'object',
    required: ['id', 'author', 'content', 'createdAt'],
    properties: {
      id: { type: 'string' },
      author: { type: 'string' },
      authorId: nullable('string'),
      content: { type: 'string' },
      createdAt: { type: 'string' },
      editedAt: nullable('string'),
      // 附件下游是 content 对象,这里只留前端能直接渲染的两件事
      attachments: {
        type: 'array',
        items: {
          type: 'object',
          required: ['url', 'kind'],
          properties: {
            url: { type: 'string' },
            kind: { type: 'string' }, // image | video | file
            name: nullable('string'),
            sizeBytes: nullable('number'),
          },
        },
      },
    },
  });
  app.addSchema({
    $id: 'BffCommentPage',
    type: 'object',
    required: ['items', 'total', 'offset'],
    properties: {
      items: { type: 'array', items: { $ref: 'BffComment#' } },
      total: { type: 'integer' },
      // 回显 offset:前端上拉取更旧的一页要靠它算下一个 offset(向后分页)
      offset: { type: 'integer' },
    },
  });
  app.addSchema({
    $id: 'BffCommentRequest',
    type: 'object',
    required: ['content'],
    properties: {
      // 不设 minLength:只发附件不写字是合法的(一张图本身就是内容)。
      // 「正文和附件不能同时为空」这条由调用方把关 —— schema 表达不了跨字段约束。
      content: { type: 'string' },
      // 已完成上传的 content id;走 /bff/uploads 那两步先拿到
      attachmentContentIds: { type: 'array', items: { type: 'string' } },
    },
  });
  // 项目分析。三个指标同形(当前值 + 环比),故共用一个 metric schema。
  app.addSchema({
    $id: 'BffMetric',
    type: 'object',
    required: ['value', 'previous'],
    properties: {
      value: { type: 'integer' },
      previous: { type: 'integer' },
      changePercent: nullable('number'),
    },
  });
  app.addSchema({
    $id: 'BffProjectAnalytics',
    type: 'object',
    required: ['views', 'uniqueVisitors', 'shares'],
    properties: {
      views: { $ref: 'BffMetric#' },
      uniqueVisitors: { $ref: 'BffMetric#' },
      shares: { $ref: 'BffMetric#' },
    },
  });
  app.addSchema({
    $id: 'BffUploadRequest',
    type: 'object',
    required: ['fileName', 'contentType'],
    properties: {
      fileName: { type: 'string' },
      contentType: { type: 'string' },
      fileSize: { type: 'integer' },
    },
  });
  app.addSchema({
    $id: 'BffUploadTicket',
    type: 'object',
    required: ['contentId', 'uploadUrl'],
    properties: { contentId: { type: 'string' }, uploadUrl: { type: 'string' } },
  });
  app.addSchema({
    $id: 'BffAssigneeRequest',
    type: 'object',
    required: ['assigneeId'],
    // 'me' 是个哨兵值:等价「认领给我」,由服务端解析成当前会话用户
    properties: { assigneeId: { type: ['string', 'null'] } },
  });
  app.addSchema({
    $id: 'BffAssigneeResponse',
    type: 'object',
    required: ['assignee', 'assigneeId'],
    properties: { assignee: nullable('string'), assigneeId: nullable('string') },
  });
  app.addSchema({
    $id: 'BffAssetTagsRequest',
    type: 'object',
    required: ['tags'],
    properties: { tags: { type: 'array', items: { type: 'string' } } },
  });
  app.addSchema({
    $id: 'BffVisibilityRequest',
    type: 'object',
    required: ['visibility'],
    properties: { visibility: { type: 'string', enum: ['public', 'agency', 'owner_private'] } },
  });
  app.addSchema({
    $id: 'BffStatusActionRequest',
    type: 'object',
    required: ['action'],
    properties: { action: { type: 'string' } },
  });
  app.addSchema({
    $id: 'BffProjectStatusResponse',
    type: 'object',
    required: ['id', 'status'],
    properties: { id: { type: 'string' }, status: { type: 'string' } },
  });
  const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } };

  // 列表（分页 + 搜索 + 状态过滤,供前端下拉加载）：xchangeai 项目 → 富摘要。
  // dev:无过滤的首页全空时播一个,保证编辑器有目标可存取。
  app.get<{ Querystring: { limit?: number; offset?: number; search?: string; status?: string; sort?: string } }>(
    '/bff/projects',
    {
      schema: {
        operationId: 'listBffProjects',
        tags: ['bff'],
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
            search: { type: 'string' },
            status: { type: 'string' },
            sort: { type: 'string' },
          },
        },
        response: { 200: { $ref: 'BffProjectPage#' } },
      },
    },
    async (req) => {
      const auth = forwardAuth(req);
      const limit = req.query.limit ?? 20;
      const offset = req.query.offset ?? 0;
      // 默认按创建时间倒序
      const [sortBy, sortAt] = SORT_MAP[req.query.sort ?? 'created_desc'] ?? SORT_MAP.created_desc;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = { limit, offset, sort_by: sortBy, sort_at: sortAt };
      if (req.query.search) query.search = req.query.search;
      if (req.query.status) query.status = [req.query.status]; // xchangeai status 是数组
      let page = await listProjects({ query }, auth);
      if (offset === 0 && !req.query.search && !req.query.status && (page.total ?? 0) === 0) {
        await createProject({ body: { price: 0, address: 'Dev Project' } }, auth);
        page = await listProjects({ query }, auth);
      }
      return { items: (page.items ?? []).map(toSummary), total: page.total ?? 0, limit, offset };
    },
  );

  // 状态计数(供状态筛选 tab 的数字):getProjectStatistics → { total, statusCounts }
  app.get(
    '/bff/projects/stats',
    { schema: { operationId: 'getBffProjectStats', tags: ['bff'], response: { 200: { $ref: 'BffProjectStats#' } } } },
    async (req) => {
      const stats = await getProjectStatistics({}, forwardAuth(req));
      return { total: stats.total ?? 0, statusCounts: stats.status_counts ?? {} };
    },
  );

  // 状态转换(FSM):action → xchangeai 端点,返回更新后的状态
  app.post<{ Params: { id: string }; Body: { action: string } }>(
    '/bff/projects/:id/status',
    {
      schema: {
        operationId: 'changeBffProjectStatus',
        tags: ['bff'],
        params: idParams,
        body: { $ref: 'BffStatusActionRequest#' },
        response: { 200: { $ref: 'BffProjectStatusResponse#' } },
      },
    },
    async (req) => {
      const { id } = req.params;
      const auth = forwardAuth(req);
      await performStatusAction(id, req.body.action, auth);
      const proj = await getProject({ path: { id } }, auth);
      return { id, status: proj.status };
    },
  );

  // 取单个：项目元数据 + workbench 时间线(= 存过的 UndoableState；未存过则空白态）
  app.get<{ Params: { id: string } }>(
    '/bff/projects/:id',
    {
      schema: {
        operationId: 'getBffProject',
        tags: ['bff'],
        params: idParams,
        response: { 200: { $ref: 'BffProject#' } },
      },
    },
    async (req) => {
      const { id } = req.params;
      const auth = forwardAuth(req);
      // 三路并发:项目本体 / 时间线 / 评论数。后两者失败不该拖垮详情 → 各自兜底。
      const [proj, timeline, comments] = await Promise.all([
        getProject({ path: { id } }, auth),
        getProjectWorkbenchTimeline({ path: { id } }, auth).catch(() => null),
        listProjectComments({ path: { id }, query: { limit: 1 } }, auth).catch(() => null),
      ]);
      return {
        id,
        name: title(proj),
        updatedAt: proj.updated_at,
        state: isUndoable(timeline) ? timeline : emptyState(),
        detail: toDetail(proj, comments?.total ?? 0),
        metadata: {},
      };
    },
  );

  // 项目元数据编辑(对齐 xchangeai-workbench 的 "Project details" 表单)。
  // 下游是 PUT 整体替换,故 body 必须全量;返回更新后的 detail 让前端直接落缓存,不用再拉一次。
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/bff/projects/:id/meta',
    {
      schema: {
        operationId: 'saveBffProjectMeta',
        tags: ['bff'],
        params: idParams,
        body: { $ref: 'BffProjectMetaRequest#' },
        response: { 200: { $ref: 'BffProjectMetaResponse#' } },
      },
    },
    async (req) => {
      const { id } = req.params;
      const auth = forwardAuth(req);
      const b = req.body as {
        address: string; address2: string; city: string; state: string; postalCode: string
        listingUrl: string; propertyType: string; videoStyle: string; price: number
        bedrooms?: number | null; bathrooms?: number | null; livingAreaSqft?: number | null
        agencyId?: string | null; agentId?: string | null; assigneeId?: string | null
      };
      await updateProject(
        {
          path: { id },
          body: {
            address: b.address,
            address2: b.address2,
            city: b.city,
            state: b.state,
            postal_code: b.postalCode,
            listing_url: b.listingUrl,
            property_type: b.propertyType,
            video_style: b.videoStyle,
            price: b.price,
            bedrooms: b.bedrooms ?? null,
            bathrooms: b.bathrooms ?? null,
            living_area_sqft: b.livingAreaSqft ?? null,
            agency_id: b.agencyId ?? null,
            owner_id: b.agentId ?? null,
            assignee_id: b.assigneeId ?? null,
          },
        },
        auth,
      );
      const [proj, comments] = await Promise.all([
        getProject({ path: { id } }, auth),
        listProjectComments({ path: { id }, query: { limit: 1 } }, auth).catch(() => null),
      ]);
      return { name: title(proj), detail: toDetail(proj, comments?.total ?? 0) };
    },
  );

  // 评论。项目级与资产级只差下游端点 —— 用同一对 handler 工厂生成,免得两份几乎一样的路由。
  // ponytail: 只取首页 100 条(评论天然少);真出现长线程再补分页。
  const commentRoutes = (
    kind: 'project' | 'asset',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    list: (o: any, a: any) => Promise<any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (o: any, a: any) => Promise<any>,
  ) => {
    const path = kind === 'project' ? '/bff/projects/:id/comments' : '/bff/project-assets/:id/comments'
    const Op = kind === 'project' ? 'BffProjectComment' : 'BffAssetComment'
    app.get<{ Params: { id: string }; Querystring: { limit?: number; offset?: number } }>(
      path,
      {
        schema: {
          operationId: `list${Op}s`,
          tags: ['bff'],
          params: idParams,
          // 分页:资产评论用 Message Scroller 上拉取更旧的一页。上游按时间正序,offset 0 = 最旧。
          querystring: {
            type: 'object',
            properties: {
              limit: { type: 'integer', minimum: 1, maximum: 100 },
              offset: { type: 'integer', minimum: 0 },
            },
          },
          response: { 200: { $ref: 'BffCommentPage#' } },
        },
      },
      async (req) => {
        const limit = req.query.limit ?? 20
        const offset = req.query.offset ?? 0
        const page = await list({ path: { id: req.params.id }, query: { limit, offset } }, forwardAuth(req))
        return { items: (page.items ?? []).map(toComment), total: page.total ?? 0, offset }
      },
    )
    app.post<{ Params: { id: string }; Body: { content: string; attachmentContentIds?: string[] } }>(
      path,
      {
        schema: {
          operationId: `create${Op}`,
          tags: ['bff'],
          params: idParams,
          body: { $ref: 'BffCommentRequest#' },
          response: { 200: { $ref: 'BffComment#' } },
        },
      },
      async (req) =>
        toComment(
          await create(
            {
              path: { id: req.params.id },
              body: {
                content: req.body.content,
                attachment_content_ids: req.body.attachmentContentIds?.length
                  ? req.body.attachmentContentIds
                  : null,
              },
            },
            forwardAuth(req),
          ),
        ),
    )
  }
  commentRoutes('project', listProjectComments, createProjectComment)
  commentRoutes('asset', listProjectAssetsComments, createProjectAssetsComment)

  // 项目分析(浏览/独立访客/分享,各带环比)。只有发布过的项目才有意义,故单独端点而不并进
  // detail —— 每次开详情都白拉一次分析不值,前端按状态决定要不要问。
  app.get<{ Params: { id: string } }>(
    '/bff/projects/:id/analytics',
    {
      schema: {
        operationId: 'getBffProjectAnalytics',
        tags: ['bff'],
        params: idParams,
        response: { 200: { $ref: 'BffProjectAnalytics#' } },
      },
    },
    async (req) => {
      const a = await getProjectAnalyticsMetrics({ path: { id: req.params.id } }, forwardAuth(req))
      const m = (x: { value: number; previous: number; change_percent?: number }) => ({
        value: x.value,
        previous: x.previous,
        changePercent: x.change_percent ?? null,
      })
      return { views: m(a.views), uniqueVisitors: m(a.unique_visitors), shares: m(a.shares) }
    },
  )

  // 附件上传的两端。中间那步(把字节 PUT 到 uploadUrl)由浏览器直传 minio 预签名地址 ——
  // 不经 BFF:文件最大 50MB,让它在 Node 里过一遍纯属白费一次内存拷贝和一倍带宽。
  // 资产 URL 本来就是同一批预签名地址,浏览器已经在直连了。
  app.post<{ Body: { fileName: string; contentType: string; fileSize?: number } }>(
    '/bff/uploads',
    {
      schema: {
        operationId: 'createBffUpload',
        tags: ['bff'],
        body: { $ref: 'BffUploadRequest#' },
        response: { 200: { $ref: 'BffUploadTicket#' } },
      },
    },
    async (req) => {
      const t = await createUpload(
        {
          body: {
            file_name: req.body.fileName,
            content_type: req.body.contentType,
            file_size: req.body.fileSize,
          },
        },
        forwardAuth(req),
      )
      return { contentId: t.content_id, uploadUrl: t.upload_url }
    },
  )
  app.post<{ Params: { id: string } }>(
    '/bff/uploads/:id/complete',
    {
      schema: {
        operationId: 'completeBffUpload',
        tags: ['bff'],
        params: idParams,
        response: { 200: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } },
      },
    },
    async (req) => {
      await completeUpload({ path: { content_id: req.params.id } }, forwardAuth(req))
      return { ok: true }
    },
  )

  // 编辑 / 删除评论。上游按全局 comment id 寻址(admin/comments/:id),不分项目还是资产,
  // 所以这两条不进上面的工厂 —— 它是按 entity 分的。权限由上游校验(comment:update/delete)。
  app.put<{ Params: { id: string }; Body: { content: string } }>(
    '/bff/comments/:id',
    {
      schema: {
        operationId: 'saveBffComment',
        tags: ['bff'],
        params: idParams,
        body: { $ref: 'BffCommentRequest#' },
        response: { 200: { $ref: 'BffComment#' } },
      },
    },
    async (req) =>
      toComment(
        await updateComment(
          { path: { id: req.params.id }, body: { content: req.body.content } },
          forwardAuth(req),
        ),
      ),
  )
  app.delete<{ Params: { id: string } }>(
    '/bff/comments/:id',
    {
      schema: {
        operationId: 'deleteBffComment',
        tags: ['bff'],
        params: idParams,
        response: { 200: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } },
      },
    },
    async (req) => {
      await deleteComment({ path: { id: req.params.id } }, forwardAuth(req))
      return { ok: true }
    },
  )

  // 指派。两件事一个端点:assigneeId 给 'me' 走 assignProjectToSelf(免得前端先去问自己的 id),
  // 给具体 id 或 null 走 updateProjectAssignee(null = 取消指派)。
  // 与 meta 表单的下拉不冲突:那条是「编辑态里连同其它 14 个字段一起存」,这条是「就地一键改」。
  app.put<{ Params: { id: string }; Body: { assigneeId: string | null } }>(
    '/bff/projects/:id/assignee',
    {
      schema: {
        operationId: 'saveBffProjectAssignee',
        tags: ['bff'],
        params: idParams,
        body: { $ref: 'BffAssigneeRequest#' },
        response: { 200: { $ref: 'BffAssigneeResponse#' } },
      },
    },
    async (req) => {
      const { id } = req.params
      const auth = forwardAuth(req)
      if (req.body.assigneeId === 'me') await assignProjectToSelf({ path: { id } }, auth)
      else await updateProjectAssignee({ path: { id }, body: { assignee_id: req.body.assigneeId } }, auth)
      // 回真实的 assignee:'me' 的落点只有服务端知道,取消指派也要把名字清掉
      const proj = await getProject({ path: { id } }, auth)
      return { assignee: proj.assignee?.name ?? null, assigneeId: proj.assignee_id ?? proj.assignee?.id ?? null }
    },
  )

  // 资产房间标签(对齐 workbench 的 TagEditor)。走 batch 端点是因为它按 **名字** 全量覆盖并
  // 自动建标签;单资产那个 (PUT .../assets/:id/tags) 只收 tag_ids,前端还得先查目录换 id。
  app.put<{ Params: { id: string; assetId: string }; Body: { tags: string[] } }>(
    '/bff/projects/:id/assets/:assetId/tags',
    {
      schema: {
        operationId: 'saveBffAssetTags',
        tags: ['bff'],
        params: {
          type: 'object',
          required: ['id', 'assetId'],
          properties: { id: { type: 'string' }, assetId: { type: 'string' } },
        },
        body: { $ref: 'BffAssetTagsRequest#' },
        response: { 200: { $ref: 'BffAssetTagsRequest#' } },
      },
    },
    async (req) => {
      const { id, assetId } = req.params
      const result = await replaceProjectAssetTagsBatch(
        { path: { id }, body: { assets: [{ asset_id: assetId, tag_names: req.body.tags }] } },
        forwardAuth(req),
      )
      // 回服务端的规范名而不是入参:上游会把 "living room" 折成 "living_room",
      // 回显入参的话前端乐观值就一直停在未规范的写法,直到下次拉详情才悄悄变样。
      const tags = (result.assets ?? []).find((a) => a.asset_id === assetId)?.tags
      return { tags: tags ? tags.map((t) => t.name) : req.body.tags }
    },
  )

  // 可见性。下游 PUT 只回 204,故这里回显入参 —— 前端拿它就地改缓存,不用再拉一次详情。
  app.put<{ Params: { id: string }; Body: { visibility: 'public' | 'agency' | 'owner_private' } }>(
    '/bff/projects/:id/visibility',
    {
      schema: {
        operationId: 'saveBffProjectVisibility',
        tags: ['bff'],
        params: idParams,
        body: { $ref: 'BffVisibilityRequest#' },
        response: { 200: { $ref: 'BffVisibilityRequest#' } },
      },
    },
    async (req) => {
      await updateProjectVisibility(
        { path: { id: req.params.id }, body: { visibility: req.body.visibility } },
        forwardAuth(req),
      )
      return { visibility: req.body.visibility }
    },
  )

  // 表单三个下拉的候选。xchangeai 分了 agencies/users 两套 options 端点,users 按 role_id 区分
  // agent 与 creator(角色 id 见 xchangeai-workbench server/xchangeaiIntegration.js)。
  // ponytail: 只取首页 100 条,超了再补分页。
  app.get(
    '/bff/project-options',
    {
      schema: {
        operationId: 'getBffProjectOptions',
        tags: ['bff'],
        response: { 200: { $ref: 'BffProjectOptions#' } },
      },
    },
    async (req) => {
      const auth = forwardAuth(req);
      const query = { limit: 100, offset: 0 };
      const [agencies, agents, assignees] = await Promise.all([
        listAgencyOptions({ query }, auth),
        listUserOptions({ query: { ...query, role_id: AGENT_ROLE_ID } }, auth),
        listUserOptions({ query: { ...query, role_id: CREATOR_ROLE_ID } }, auth),
      ]);
      const users = (page: { items?: { id: string; full_name: string }[] | null }) =>
        (page.items ?? []).map((u) => ({ id: u.id, name: u.full_name || 'Unnamed' }));
      return {
        agencies: (agencies.items ?? []).map((a) => ({ id: a.id, name: a.display_name || 'Unnamed agency' })),
        agents: users(agents),
        assignees: users(assignees),
      };
    },
  );

  // 保存：UndoableState 原样写回 workbench 时间线（不透明存储，无翻译）
  app.put<{
    Params: { id: string };
    Body: { name?: string; state: UndoableState; metadata?: Record<string, unknown> };
  }>(
    '/bff/projects/:id',
    {
      schema: {
        operationId: 'saveBffProject',
        tags: ['bff'],
        params: idParams,
        body: { $ref: 'BffProjectSaveRequest#' },
        response: { 200: { $ref: 'BffProjectSaveResponse#' } },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const { state } = req.body ?? {};
      if (!state) return reply.code(400).send({ error: 'state required' });
      await upsertProjectWorkbenchTimeline(
        { path: { id }, body: state as unknown as Record<string, unknown> },
        forwardAuth(req),
      );
      return { id, updatedAt: new Date().toISOString() };
    },
  );
};
