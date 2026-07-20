import Fastify from 'fastify';
import cors from '@fastify/cors';
import proxy from '@fastify/http-proxy';
import { config } from './config';
import { getSession, registerSessionRoutes } from './session';
import { registerProjectRoutes } from './projects';

const app = Fastify({ logger: true });

// 浏览器（:5273）跨源访问 BFF
await app.register(cors, { origin: true });

app.get('/healthz', async () => ({ ok: true, role: 'bff' }));

// 鉴权 seam（桩）：所有请求先过会话解析。现在恒放行——接 XChangeAI 时在此对未登录返 401。
app.decorateRequest('session', null);
app.addHook('onRequest', async (req) => {
  (req as { session?: unknown }).session = getSession(req); // TODO: 未登录拦截
});

// 产品面（BFF 自有；下游 XChangeAI 先桩）
registerSessionRoutes(app);
registerProjectRoutes(app);

// 编辑器 transport 契约：/api/* 透明代理到下游渲染服务（server/）。
// 数据面（/media、/api/blob 的绝对 URL）由渲染服务直供，不经此——BFF 不搬运大文件。
await app.register(proxy, {
  upstream: config.renderUpstream,
  prefix: '/api',
  rewritePrefix: '/api',
});

await app.listen({ port: config.port, host: '0.0.0.0' });
