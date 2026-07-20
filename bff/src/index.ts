import Fastify from 'fastify';
import cors from '@fastify/cors';
import proxy from '@fastify/http-proxy';
import swagger from '@fastify/swagger';
import { config } from './config';
import { registerSessionRoutes } from './session';
import { registerProjectRoutes } from './projects';

const app = Fastify({ logger: true });

// 浏览器（:5273）跨源访问 BFF；放行 PUT；credentials 让会话 cookie 可跨源携带
await app.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

// 下游 xchangeai(ky HTTPError)的状态透给前端——尤其 401 让前端跳登录,而非一律 500。
// 不读上游 body(ky 已消费),仅转发状态码 + 概要 message。
app.setErrorHandler((error, req, reply) => {
  const status = (error as { response?: { status?: number } }).response?.status;
  if (status) return reply.code(status).send({ error: 'Upstream error', message: error.message });
  req.log.error(error);
  return reply.code(500).send({ error: 'Internal Server Error', message: error.message });
});

// BFF 自有契约来源：@fastify/swagger 从带 schema 的 /bff/* 路由生成 OpenAPI 3.1 文档；
// $id 作为 components/schemas 名(否则默认 def-N)。这就是前端 codegen 的唯一 input——
// 前端只认 /bff/*,看不到 xchangeai;xchangeai 由 BFF 服务端 typed client 调(bff/src/generated)。
await app.register(swagger, {
  openapi: { openapi: '3.1.0', info: { title: 'workbench-v2 BFF', version: '0.0.0' } },
  refResolver: {
    buildLocalReference: (json, _base, _fragment, i) =>
      typeof (json as { $id?: unknown }).$id === 'string' ? (json as { $id: string }).$id : `def-${i}`,
  },
  // 产品契约只暴露 /bff/*;隐藏基础设施路由(/healthz、/openapi.yaml、/api 渲染代理)
  transform: ({ schema, url }: { schema?: Record<string, unknown>; url: string }) =>
    url.startsWith('/bff')
      ? { schema: (schema ?? {}) as never, url }
      : { schema: { ...(schema ?? {}), hide: true } as never, url },
});

app.get('/healthz', async () => ({ ok: true, role: 'bff' }));

// BFF 自有契约(仅 /bff/*)。@fastify/swagger 直接吐 YAML,无需合并下游。
app.get('/openapi.yaml', async (_req, reply) => {
  reply.header('content-type', 'application/yaml; charset=utf-8');
  return app.swagger({ yaml: true });
});

// 产品面（BFF 自有；handler 内部用 typed client 调 xchangeai + 翻译）
registerSessionRoutes(app);
registerProjectRoutes(app);

// 编辑器 transport 契约：/api/* 透明代理到下游渲染服务（server/）。
// 数据面（/media、/api/blob 的绝对 URL）由渲染服务直供，不经此——BFF 不搬运大文件。
// 注意：xchangeai 不再走代理(前端不认 /api/v1)，改由 handler 内 typed client 直调。
await app.register(proxy, {
  upstream: config.renderUpstream,
  prefix: '/api',
  rewritePrefix: '/api',
});

await app.listen({ port: config.port, host: '0.0.0.0' });
