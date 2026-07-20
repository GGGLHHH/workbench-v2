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
  getProjectWorkbenchTimeline,
  listProjects,
  upsertProjectWorkbenchTimeline,
} from './generated/client';
import { forwardAuth } from './xchange-client';

// 产品项目面:BFF 用 typed xchangeai client 调下游。
// 权威时间轴模型 = UndoableState(编辑器原生);xchangeai 的 workbench-timeline 是
// schema-agnostic 的不透明 JSON(Go: map[string]interface{})→ 直接原样存取,零翻译。
// 前端只认下面 4 个 /bff/* 端点,看不到 xchangeai 的 100+ 端点。

const projectName = (p: { address?: string; id: string }): string => p.address || p.id;

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
    required: ['id', 'name', 'updatedAt'],
    properties: { id: { type: 'string' }, name: { type: 'string' }, updatedAt: { type: 'string' } },
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

  // 列表（分页,供前端下拉加载）：xchangeai 项目 → 摘要 + total/limit/offset。
  // dev:首页(offset 0)全空时播一个,保证编辑器有目标可存取。
  app.get<{ Querystring: { limit?: number; offset?: number } }>(
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
          },
        },
        response: { 200: { $ref: 'BffProjectPage#' } },
      },
    },
    async (req) => {
      const auth = forwardAuth(req);
      const limit = req.query.limit ?? 20;
      const offset = req.query.offset ?? 0;
      let page = await listProjects({ query: { limit, offset } }, auth);
      if (offset === 0 && (page.total ?? 0) === 0) {
        await createProject({ body: { price: 0, address: 'Dev Project' } }, auth);
        page = await listProjects({ query: { limit, offset } }, auth);
      }
      const items = (page.items ?? []).map((p) => ({ id: p.id, name: projectName(p), updatedAt: p.updated_at }));
      return { items, total: page.total ?? items.length, limit, offset };
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
        name: projectName(proj),
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
