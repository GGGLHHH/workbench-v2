import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { contentDisposition, type UndoableState } from '@gedatou/shared';
import { config } from './config';
import { createUploadUrl, deleteObject, isSafeKey, writeStream } from './storage';
import { enqueueRender, tasks } from './renderer';
import { isValidProjectId, readIndex, removeRender } from './render-index';
import { transcribeAudio } from './whisper';

// bodyLimit: /render 携带完整工程 state；素材 PUT 走原始流（本地视频可较大）
const app = Fastify({ logger: true, bodyLimit: 512 * 1024 * 1024 });

// 素材上传是跨源 PUT（浏览器 :5273 → 本服务）：CORS 必须放行 PUT，否则预检挡下、上传失败
await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'] });
await app.register(multipart, { limits: { fileSize: 64 * 1024 * 1024 } });

// 素材/产物落盘目录 + 静态提供（浏览器与服务端渲染进程都从此取，publicUrl 为绝对地址）
await mkdir(config.dataDir, { recursive: true });
await app.register(fastifyStatic, { root: config.dataDir, prefix: '/media/' });

// 渲染产物的下载文件名：产物 URL 跨源（浏览器 :5273 → 本服务），此时 <a download> 的文件名
// 会被浏览器忽略，只能由服务端发 Content-Disposition。名字由 renderer 编进 URL 的 ?filename=
// （无状态，重启不丢）。contentDisposition() 会转义非 ASCII 与控制字符，故不存在头注入。
app.addHook('onSend', async (req, reply) => {
  const name = (req.query as { filename?: string } | null)?.filename;
  if (name && req.url.startsWith('/media/')) {
    reply.header('content-disposition', contentDisposition(name));
  }
});

// 素材 PUT 用原始二进制流入盘：为未注册的 content-type 提供“透传流”解析器
// （JSON 仍走内置解析，multipart/form-data 仍走 @fastify/multipart）
app.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

app.get('/healthz', async () => ({ ok: true }));

// 1) 签发上传地址（本地版：uploadUrl 指向本服务的 /api/blob/*）
app.post<{ Body: { filename: string; contentType: string } }>('/api/upload', async (req, reply) => {
  const { filename } = req.body ?? {};
  if (!filename) return reply.code(400).send({ error: 'filename required' });
  const safe = filename.replace(/[^\w.\-一-龥]/g, '_').slice(-80);
  const key = `assets/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  return { ...createUploadUrl(key), key };
});

// 2) 接收素材原始流入盘（替代 S3 预签名 PUT）
app.put<{ Params: { '*': string } }>('/api/blob/*', async (req, reply) => {
  const key = req.params['*'];
  if (!isSafeKey(key)) return reply.code(400).send({ error: 'invalid key' });
  await writeStream(key, req.body as IncomingMessage);
  return { ok: true };
});

// 3) 删除素材
app.post<{ Body: { key: string } }>('/api/delete-asset', async (req, reply) => {
  const { key } = req.body ?? {};
  if (!key || !isSafeKey(key)) return reply.code(400).send({ error: 'invalid key' });
  await deleteObject(key);
  return { ok: true };
});

// 4) 发起渲染。projectId 由消费方(workbench transport)从当前项目注入,渲染完成后据此写本机索引。
app.post<{ Body: { state: UndoableState; codec: 'mp4' | 'webm'; fileName?: string; projectId?: string } }>(
  '/api/render',
  async (req, reply) => {
    const { state, codec, fileName, projectId } = req.body ?? {};
    if (!state || (codec !== 'mp4' && codec !== 'webm')) {
      return reply.code(400).send({ error: 'state and codec (mp4|webm) required' });
    }
    return { taskId: enqueueRender(state, codec, fileName, projectId) };
  },
);

// 4b) 某项目的渲染历史(本机索引,留历史)。产物与关联都在本机,不涉远程。
app.get<{ Querystring: { projectId?: string } }>('/api/renders', async (req, reply) => {
  const projectId = req.query?.projectId;
  if (!projectId || !isValidProjectId(projectId)) return reply.code(400).send({ error: 'projectId required' });
  return { renders: await readIndex(projectId) };
});

// 4c) 删一条渲染历史(并删磁盘产物)
app.delete<{ Params: { taskId: string }; Querystring: { projectId?: string } }>(
  '/api/renders/:taskId',
  async (req, reply) => {
    const projectId = req.query?.projectId;
    if (!projectId || !isValidProjectId(projectId)) return reply.code(400).send({ error: 'projectId required' });
    await removeRender(projectId, req.params.taskId);
    return { ok: true };
  },
);

// 5) 轮询渲染进度
app.post<{ Body: { taskId: string } }>('/api/progress', async (req, reply) => {
  const task = tasks.get(req.body?.taskId ?? '');
  if (!task) return reply.code(404).send({ error: 'unknown taskId' });
  return task;
});

// 字幕转录：接收 16kHz 单声道 WAV（客户端已转好）→ whisper.cpp。
// 首次调用校验/安装 whisper.cpp + 模型（默认复用 Remotion-demo 已构建，通常秒回）。
app.post('/api/captions', async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: 'audio file required' });
  const tmpPath = path.join(os.tmpdir(), `captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  try {
    await pipeline(file.file, createWriteStream(tmpPath));
    return { captions: await transcribeAudio(tmpPath) };
  } finally {
    await rm(tmpPath, { force: true });
  }
});

await app.listen({ port: config.port, host: '0.0.0.0' });
