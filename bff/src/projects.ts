import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_COMPOSITION_HEIGHT,
  DEFAULT_COMPOSITION_WIDTH,
  createEmptyState,
  type UndoableState,
} from '@gedatou/shared';
import {
  createProject,
  getProject,
  getProjectStatistics,
  getProjectWorkbenchTimeline,
  listProjects,
  upsertProjectWorkbenchTimeline,
} from './generated/client';
import { forwardAuth } from './xchange-client';

// 产品项目面:BFF 用 typed xchangeai client 调下游。
// 权威时间轴模型 = UndoableState(编辑器原生);xchangeai 的 workbench-timeline 是
// schema-agnostic 的不透明 JSON(Go: map[string]interface{})→ 直接原样存取,零翻译。
// 前端只认下面 4 个 /bff/* 端点,看不到 xchangeai 的 100+ 端点。

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

const isUndoable = (v: unknown): v is UndoableState =>
  !!v && typeof v === 'object' && Array.isArray((v as { tracks?: unknown }).tracks);

const emptyState = (): UndoableState =>
  createEmptyState({ width: DEFAULT_COMPOSITION_WIDTH, height: DEFAULT_COMPOSITION_HEIGHT });

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
  app.addSchema({
    $id: 'BffProject',
    type: 'object',
    required: ['id', 'name', 'updatedAt', 'state'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      updatedAt: { type: 'string' },
      state: opaque,
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
  const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } };

  // 列表（分页 + 搜索 + 状态过滤,供前端下拉加载）：xchangeai 项目 → 富摘要。
  // dev:无过滤的首页全空时播一个,保证编辑器有目标可存取。
  app.get<{ Querystring: { limit?: number; offset?: number; search?: string; status?: string } }>(
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
          },
        },
        response: { 200: { $ref: 'BffProjectPage#' } },
      },
    },
    async (req) => {
      const auth = forwardAuth(req);
      const limit = req.query.limit ?? 20;
      const offset = req.query.offset ?? 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = { limit, offset };
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
      const proj = await getProject({ path: { id } }, auth);
      const timeline = await getProjectWorkbenchTimeline({ path: { id } }, auth).catch(() => null);
      return {
        id,
        name: title(proj),
        updatedAt: proj.updated_at,
        state: isUndoable(timeline) ? timeline : emptyState(),
        metadata: {},
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
