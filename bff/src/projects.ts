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
  createProject,
  failProject,
  generateProject,
  getProject,
  getProjectStatistics,
  getProjectWorkbenchTimeline,
  listAgencyOptions,
  listProjectComments,
  listProjects,
  listUserOptions,
  prepareProject,
  publishProject,
  reassignProject,
  rejectProject,
  resubmitProject,
  revertProject,
  startProjectReview,
  startProjectWork,
  submitProjectReview,
  updateProject,
  upsertProjectWorkbenchTimeline,
} from './generated/client';
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

// 单个 asset → 缩略图 {url, kind}:优先真·thumbnail_url(图片海报),否则用 preview_url/
// download_url(minio 预签名、浏览器可直取);按 mime 标记 image/video 让前端用 <img>/<video>。
type Thumb = { url: string; kind: 'image' | 'video' }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const assetThumb = (a: any): Thumb | null => {
  const c = a?.content
  if (!c) return null
  if (c.thumbnail_url) return { url: c.thumbnail_url, kind: 'image' }
  const url = c.preview_url || c.download_url
  if (!url) return null
  return { url, kind: String(c.mime_type || '').startsWith('video/') ? 'video' : 'image' }
}

// 项目缩略图:首个 creator_asset,回退 agent_asset。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const firstThumb = (p: any): Thumb | null => {
  for (const a of [...(p.creator_assets ?? []), ...(p.agent_assets ?? [])]) {
    const t = assetThumb(a)
    if (t) return t
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
    thumbnailUrl: thumb?.url ?? null,
    thumbnailKind: thumb?.kind ?? null,
    updatedAt: p.updated_at,
  }
}

// ProjectReadModel → 详情面板字段(对齐 xchangeai-workbench 的 "Project details" 弹窗 +
// TopBar 摘要:listing 三段 / 三格 beds-baths-sqft / 人员三选 / 统计 / 时间)。
// 单独成 detail 子对象:BffProject 顶层的 state 是时间轴,而 listing 的 state 是「州」,平铺会撞名。
// 只读:xchangeai 那套 PATCH meta 这里还没开,编辑要另开端点。
// 资产列表 → 缩略图网格用的扁平项。tags 取名字数组(对齐 workbench 图库瓦片上的标签)。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toAssets = (list: any[] | null | undefined, kind: 'creator' | 'agent') =>
  (list ?? []).flatMap((a) => {
    const t = assetThumb(a)
    return t
      ? [
          {
            id: a.id ?? a.content_id,
            group: kind,
            url: t.url,
            kind: t.kind,
            name: a.content?.file_name ?? null,
            commentCount: a.comment_count ?? 0,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tags: (a.tags ?? []).map((tag: any) => tag.name).filter(Boolean),
          },
        ]
      : []
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
      url: { type: 'string' },
      kind: { type: 'string' }, // image | video
      name: nullable('string'),
      commentCount: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
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
