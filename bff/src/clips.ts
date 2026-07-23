// 图生视频归一层:前端 /bff/clip* ↔ server /api 底层互译。server 负责实现,BFF 负责出入参归一:
// ①图片引用解析(/bff/content/<id> → xchangeai 公网 download_url)②prompt 合成 ③provider 目录/任务态归一。
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getUpload } from './generated/client';
import { config } from './config';
import { forwardAuth } from './xchange-client';
import { compileClipPrompt, type CameraMove, type LightTransition } from './clip-prompt';

/* eslint-disable @typescript-eslint/no-explicit-any */

// 前端手里的图片引用 → server 能用的绝对 URL。/bff/content/<id> 现解析成 xchangeai 当前预签名地址
// (公网,外部 provider 可直取);其余原样(须已公网可达)。
const resolveImageUrl = async (url: string, auth: ReturnType<typeof forwardAuth>): Promise<string> => {
  const m = url.match(/^\/bff\/content\/(.+)$/);
  if (!m) return url;
  const details = await getUpload({ path: { content_id: m[1] } }, auth).catch(() => null);
  const dl = details?.download_url || details?.preview_url;
  if (!dl) throw Object.assign(new Error('content not ready'), { statusCode: 404 });
  return new URL(dl, `${config.xchangeUpstream}/`).toString();
};

// 图片引用 → 稳定绑定 ref:/bff/content/<id> 取 content_id(跨会话稳定),否则用 URL 本身。
const refOf = (url: string): string => url.match(/^\/bff\/content\/(.+)$/)?.[1] ?? url;

type GenerateBody = {
  imageUrl: string;
  projectId?: string; // 齐全(+ 可从 imageUrl 派生 sourceImageRef)时生成成功后写本机 clip 索引
  provider?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  promptBody?: string;
  cameraMove?: CameraMove;
  focusSubject?: string;
  lightTransition?: LightTransition;
  referenceImageUrls?: string[];
};

export const registerClipRoutes = (app: FastifyInstance): void => {
  app.addSchema({
    $id: 'BffDurations',
    type: 'object',
    required: ['adjustable'],
    properties: {
      adjustable: { type: 'boolean' },
      values: { type: ['array', 'null'], items: { type: 'number' } },
      min: { type: ['number', 'null'] },
      max: { type: ['number', 'null'] },
    },
  });
  app.addSchema({
    $id: 'BffReferenceSupport',
    type: 'object',
    required: ['supported', 'max'],
    properties: { supported: { type: 'boolean' }, max: { type: 'integer' } },
  });
  app.addSchema({
    $id: 'BffClipProvider',
    type: 'object',
    required: ['id', 'label', 'durations', 'referenceImages', 'configured'],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      durations: { $ref: 'BffDurations#' },
      referenceImages: { $ref: 'BffReferenceSupport#' },
      configured: { type: 'boolean' },
      configurationIssue: { type: ['string', 'null'] },
    },
  });
  app.addSchema({
    $id: 'BffClipProviderList',
    type: 'object',
    required: ['providers'],
    properties: { providers: { type: 'array', items: { $ref: 'BffClipProvider#' } } },
  });
  app.addSchema({
    $id: 'BffGenerateClipRequest',
    type: 'object',
    required: ['imageUrl'],
    properties: {
      imageUrl: { type: 'string' }, // /bff/content/<id> 或已公网的 URL
      projectId: { type: 'string' }, // 传了才写绑定索引;sourceImageRef 由 imageUrl 派生
      provider: { type: 'string' },
      durationSeconds: { type: 'number' },
      aspectRatio: { type: 'string' },
      promptBody: { type: 'string' },
      cameraMove: { type: 'string' },
      focusSubject: { type: 'string' },
      lightTransition: { type: 'string' },
      referenceImageUrls: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    },
  });
  app.addSchema({
    $id: 'BffClipTask',
    type: 'object',
    required: ['taskId', 'status', 'progress'],
    properties: {
      taskId: { type: 'string' },
      status: { type: 'string' }, // queued | generating | done | error
      progress: { type: 'number' }, // 0-1
      url: { type: ['string', 'null'] },
      provider: { type: ['string', 'null'] },
      durationSeconds: { type: ['number', 'null'] },
      error: { type: ['string', 'null'] },
    },
  });
  // 一条已生成的 take(绑定索引项)。丢掉 server-only 的 compiledPrompt/providerJobId。
  const nn = (t: 'string' | 'number') => ({ type: [t, 'null'] } as const);
  app.addSchema({
    $id: 'BffClipRecord',
    type: 'object',
    required: ['clipId', 'sourceImageRef', 'url', 'provider', 'createdAt'],
    properties: {
      clipId: { type: 'string' },
      sourceImageRef: { type: 'string' },
      referenceImageRefs: { type: 'array', items: { type: 'string' } },
      url: { type: 'string' },
      provider: { type: 'string' },
      model: nn('string'),
      aspectRatio: nn('string'),
      requestedDurationSeconds: nn('number'),
      durationSeconds: nn('number'),
      width: nn('number'),
      height: nn('number'),
      fps: nn('number'),
      sizeBytes: nn('number'),
      promptBody: nn('string'),
      cameraMove: nn('string'),
      focusSubject: nn('string'),
      lightTransition: nn('string'),
      createdAt: { type: 'string' },
    },
  });
  app.addSchema({
    $id: 'BffClipList',
    type: 'object',
    required: ['clips'],
    properties: { clips: { type: 'array', items: { $ref: 'BffClipRecord#' } } },
  });

  // provider 目录:server 实现视角(含 inputMode/model/requiredEnv)→ 前端只需 id/label/durations/参考图/配置态。
  app.get(
    '/bff/clip-providers',
    { schema: { operationId: 'listBffClipProviders', tags: ['bff'], response: { 200: { $ref: 'BffClipProviderList#' } } } },
    async () => {
      const res = await fetch(`${config.renderUpstream}/api/clip-providers`);
      const data = (await res.json().catch(() => ({ providers: [] }))) as { providers?: any[] };
      return {
        providers: (data.providers ?? []).map((p) => ({
          id: p.id,
          label: p.label,
          durations: p.durations,
          referenceImages: p.referenceImages,
          configured: p.configured,
          configurationIssue: p.configurationIssue ?? null,
        })),
      };
    },
  );

  // 发起生成:解析图片引用 + 合成 prompt → server /api/generate-clip。返回 queued 态,前端轮询 GET。
  app.post<{ Body: GenerateBody }>(
    '/bff/clips',
    {
      schema: {
        operationId: 'generateBffClip',
        tags: ['bff'],
        body: { $ref: 'BffGenerateClipRequest#' },
        response: { 200: { $ref: 'BffClipTask#' } },
      },
    },
    async (req: FastifyRequest<{ Body: GenerateBody }>, reply) => {
      const b = req.body;
      const auth = forwardAuth(req);
      const imageUrl = await resolveImageUrl(b.imageUrl, auth);
      // schema 已 maxItems:8 封顶;这里再 slice 兜底,避免解析扇出到 xchangeai。server 会按 provider 能力再裁剪。
      const referenceImageUrls = b.referenceImageUrls?.length
        ? await Promise.all(b.referenceImageUrls.slice(0, 8).map((u) => resolveImageUrl(u, auth)))
        : undefined;
      const prompt = compileClipPrompt({
        promptBody: b.promptBody,
        cameraMove: b.cameraMove,
        focusSubject: b.focusSubject,
        lightTransition: b.lightTransition,
      });
      const res = await fetch(`${config.renderUpstream}/api/generate-clip`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: b.provider,
          imageUrl,
          prompt,
          durationSeconds: b.durationSeconds,
          aspectRatio: b.aspectRatio,
          referenceImageUrls,
          // 绑定:projectId 由前端传,sourceImageRef/referenceImageRefs 从原始引用派生;
          // 运镜参数原样带上,存进索引记录(compiledPrompt 已在上面的 prompt)。
          projectId: b.projectId,
          sourceImageRef: b.projectId ? refOf(b.imageUrl) : undefined,
          referenceImageRefs: b.projectId ? b.referenceImageUrls?.slice(0, 8).map(refOf) : undefined,
          promptBody: b.promptBody,
          cameraMove: b.cameraMove,
          focusSubject: b.focusSubject,
          lightTransition: b.lightTransition,
        }),
      });
      if (!res.ok) return reply.code(res.status).send(await res.json().catch(() => ({ error: 'generate failed' })));
      const { taskId } = (await res.json()) as { taskId: string };
      return {
        taskId,
        status: 'queued',
        progress: 0,
        url: null,
        provider: b.provider ?? null,
        durationSeconds: b.durationSeconds ?? null,
        error: null,
      };
    },
  );

  // 轮询:server /api/clip-progress → 归一 BffClipTask
  app.get<{ Params: { taskId: string } }>(
    '/bff/clips/:taskId',
    {
      schema: {
        operationId: 'getBffClip',
        tags: ['bff'],
        params: { type: 'object', required: ['taskId'], properties: { taskId: { type: 'string' } } },
        response: { 200: { $ref: 'BffClipTask#' } },
      },
    },
    async (req, reply) => {
      const { taskId } = req.params;
      const res = await fetch(`${config.renderUpstream}/api/clip-progress`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      if (res.status === 404) return reply.code(404).send({ error: 'unknown taskId' });
      const t = (await res.json()) as {
        status: string;
        progress: number;
        url?: string;
        provider?: string;
        durationSeconds?: number;
        error?: string;
      };
      return {
        taskId,
        status: t.status,
        progress: t.progress,
        url: t.url ?? null,
        provider: t.provider ?? null,
        durationSeconds: t.durationSeconds ?? null,
        error: t.error ?? null,
      };
    },
  );

  // 列某项目的 take(可按源图过滤 = 单图的多个视频)。归一 server 记录,丢 server-only 的 compiledPrompt/jobId。
  app.get<{ Querystring: { projectId: string; sourceImageRef?: string } }>(
    '/bff/clips',
    {
      schema: {
        operationId: 'listBffClips',
        tags: ['bff'],
        querystring: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string' }, sourceImageRef: { type: 'string' } },
        },
        response: { 200: { $ref: 'BffClipList#' } },
      },
    },
    async (req) => {
      const qs = new URLSearchParams({ projectId: req.query.projectId });
      if (req.query.sourceImageRef) qs.set('sourceImageRef', req.query.sourceImageRef);
      const res = await fetch(`${config.renderUpstream}/api/clips?${qs.toString()}`);
      const data = (await res.json().catch(() => ({ clips: [] }))) as { clips?: any[] };
      return {
        clips: (data.clips ?? []).map((c) => ({
          clipId: c.clipId,
          sourceImageRef: c.sourceImageRef,
          referenceImageRefs: c.referenceImageRefs,
          url: c.url,
          provider: c.provider,
          model: c.model ?? null,
          aspectRatio: c.aspectRatio ?? null,
          requestedDurationSeconds: c.requestedDurationSeconds ?? null,
          durationSeconds: c.durationSeconds ?? null,
          width: c.width ?? null,
          height: c.height ?? null,
          fps: c.fps ?? null,
          sizeBytes: c.sizeBytes ?? null,
          promptBody: c.promptBody ?? null,
          cameraMove: c.cameraMove ?? null,
          focusSubject: c.focusSubject ?? null,
          lightTransition: c.lightTransition ?? null,
          createdAt: c.createdAt,
        })),
      };
    },
  );

  // 删一条 take(索引记录 + 盘文件)
  app.delete<{ Params: { clipId: string }; Querystring: { projectId: string } }>(
    '/bff/clips/:clipId',
    {
      schema: {
        operationId: 'deleteBffClip',
        tags: ['bff'],
        params: { type: 'object', required: ['clipId'], properties: { clipId: { type: 'string' } } },
        querystring: { type: 'object', required: ['projectId'], properties: { projectId: { type: 'string' } } },
        response: { 200: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } },
      },
    },
    async (req, reply) => {
      const res = await fetch(
        `${config.renderUpstream}/api/clips/${encodeURIComponent(req.params.clipId)}?projectId=${encodeURIComponent(
          req.query.projectId,
        )}`,
        { method: 'DELETE' },
      );
      if (res.status === 404) return reply.code(404).send({ error: 'unknown clipId' });
      if (!res.ok) return reply.code(res.status).send(await res.json().catch(() => ({ error: 'delete failed' })));
      return { ok: true };
    },
  );
};
