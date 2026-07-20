import type { FastifyInstance, FastifyRequest } from 'fastify';

// 会话/鉴权边界（桩）：现在恒返回 dev 用户。
// 这是接 XChangeAI 登录的 seam——届时 getSession 读真实会话（cookie/token→XChangeAI），
// 未登录时由 index.ts 的 onRequest 钩子拦 401。契约（/bff/session 形状）保持不变。
export type Session = { user: { id: string; name: string }; authenticated: boolean };

export const getSession = (_req: FastifyRequest): Session => ({
  user: { id: 'dev', name: 'Dev User' },
  authenticated: true,
});

export const registerSessionRoutes = (app: FastifyInstance): void => {
  app.get('/bff/session', async (req) => getSession(req));
  app.post('/bff/session', async (req) => getSession(req)); // TODO: XChangeAI 登录
  app.delete('/bff/session', async () => ({ ok: true })); // TODO: XChangeAI 登出
};
