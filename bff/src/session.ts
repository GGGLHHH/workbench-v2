import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthMeResponse } from './generated/api-types';
import { getMe } from './generated/client';
import { forwardAuth, loginRaw, refreshRaw } from './xchange-client';

// 会话面(按用户鉴权):
//   POST  /bff/session          = 登录:转发凭据到 xchangeai → 回传 Set-Cookie 给浏览器 → 返回用户
//   GET   /bff/session          = 取当前用户:用浏览器带来的 cookie 调 getMe(未登录 → xchangeai 401)
//   POST  /bff/session/refresh  = 刷新:转发 refresh_token → 回传轮换后的 Set-Cookie → 返回用户
//   DELETE/bff/session          = 登出:清浏览器会话 cookie
// 契约(BffSession)对前端稳定,不暴露 xchangeai 的 AuthMeResponse 全貌。
export type Session = { user: { id: string; name: string }; authenticated: boolean };

const toSession = (me: AuthMeResponse): Session => ({
  user: { id: me.id, name: me.name ?? me.email },
  authenticated: true,
});

export const registerSessionRoutes = (app: FastifyInstance): void => {
  app.addSchema({
    $id: 'BffSession',
    type: 'object',
    required: ['user', 'authenticated'],
    properties: {
      user: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
      authenticated: { type: 'boolean' },
    },
  });
  app.addSchema({
    $id: 'BffLoginRequest',
    type: 'object',
    required: ['identifier', 'password'],
    properties: { identifier: { type: 'string' }, password: { type: 'string' } },
  });

  app.get(
    '/bff/session',
    { schema: { operationId: 'getBffSession', tags: ['bff'], response: { 200: { $ref: 'BffSession#' } } } },
    async (req) => toSession(await getMe({}, forwardAuth(req))),
  );

  app.post<{ Body: { identifier: string; password: string } }>(
    '/bff/session',
    {
      schema: {
        operationId: 'loginBffSession',
        tags: ['bff'],
        body: { $ref: 'BffLoginRequest#' },
        response: { 200: { $ref: 'BffSession#' } },
      },
    },
    async (req: FastifyRequest<{ Body: { identifier: string; password: string } }>, reply) => {
      const { identifier, password } = req.body;
      const setCookies = await loginRaw(identifier, password);
      // 回传 xchangeai 的会话 cookie 给浏览器(access_token / refresh_token)
      reply.header('set-cookie', setCookies);
      // 用刚拿到的 access_token 立即取用户(此刻浏览器 cookie 还没回来)
      const accessToken = setCookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('access_token='));
      const me = await getMe({}, { headers: accessToken ? { cookie: accessToken } : {} });
      return toSession(me);
    },
  );

  app.post(
    '/bff/session/refresh',
    { schema: { operationId: 'refreshBffSession', tags: ['bff'], response: { 200: { $ref: 'BffSession#' } } } },
    async (req, reply) => {
      // 转发浏览器的 refresh_token cookie 换新 access_token,回传轮换后的 Set-Cookie 给浏览器
      const setCookies = await refreshRaw(req.headers.cookie);
      reply.header('set-cookie', setCookies);
      // 用刚拿到的 access_token 立即取用户(此刻浏览器 cookie 还没回来)
      const accessToken = setCookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('access_token='));
      const me = await getMe({}, { headers: accessToken ? { cookie: accessToken } : {} });
      return toSession(me);
    },
  );

  app.delete(
    '/bff/session',
    {
      schema: {
        operationId: 'logoutBffSession',
        tags: ['bff'],
        response: { 200: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } },
      },
    },
    async (_req, reply) => {
      reply.header('set-cookie', [
        'access_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
        'refresh_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
      ]);
      return { ok: true };
    },
  );
};
