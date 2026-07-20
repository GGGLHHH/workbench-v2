import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_COMPOSITION_HEIGHT,
  DEFAULT_COMPOSITION_WIDTH,
  createEmptyState,
  type UndoableState,
} from '@gedatou/shared';

// 产品项目面（桩，内存存储）。
// 权威时间轴模型 = UndoableState（编辑器原生），产品专属字段挂 metadata sidecar，
// BFF 不做模型翻译——这是绿地相对旧 ListingCut 最大的去牵掣红利。
// TODO: 下游换 XChangeAI（projects/assets），仅换取数实现；契约与 sidecar 边界不变。
type Project = {
  id: string;
  name: string;
  updatedAt: string;
  state: UndoableState;
  metadata: Record<string, unknown>;
};

const store = new Map<string, Project>();
store.set('demo', {
  id: 'demo',
  name: 'Demo Project',
  updatedAt: new Date().toISOString(),
  state: createEmptyState({ width: DEFAULT_COMPOSITION_WIDTH, height: DEFAULT_COMPOSITION_HEIGHT }),
  metadata: {},
});

export const registerProjectRoutes = (app: FastifyInstance): void => {
  // 列表：只返回摘要，不带 state
  app.get('/bff/projects', async () =>
    [...store.values()].map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
  );

  // 取单个：完整 state + metadata（前端直接喂给 EditorRoot）
  app.get<{ Params: { id: string } }>('/bff/projects/:id', async (req, reply) => {
    const p = store.get(req.params.id);
    return p ?? reply.code(404).send({ error: 'unknown project' });
  });

  // 保存：直接存 UndoableState，无翻译
  app.put<{
    Params: { id: string };
    Body: { name?: string; state: UndoableState; metadata?: Record<string, unknown> };
  }>('/bff/projects/:id', async (req, reply) => {
    const { state, name, metadata } = req.body ?? {};
    if (!state) return reply.code(400).send({ error: 'state required' });
    const prev = store.get(req.params.id);
    const next: Project = {
      id: req.params.id,
      name: name ?? prev?.name ?? req.params.id,
      updatedAt: new Date().toISOString(),
      state,
      metadata: metadata ?? prev?.metadata ?? {},
    };
    store.set(next.id, next);
    return { id: next.id, updatedAt: next.updatedAt };
  });
};
