// 单一 HTTP provider 实现:吃一份声明式描述符,跑 提交→轮询→下载。
// 取代 xchangeai providers.js 里 6 个 80% 雷同的 class(只差 endpoint 字符串与 body 字段名)。
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ClipInput, ClipResult, Durations, InputMode, ProviderDeps, ResolvedImage, VideoProvider } from './types';
import {
  bearerHeaders,
  jsonRequest,
  keyHeaders,
  pollTask,
  reportProgress,
  validateHttpsImageUrl,
} from './http-engine';
import { envBool } from './env';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;

/** buildSubmit 拿到的一切:已解析的图 + 运镜 prompt + 该 provider 的 model/时长表。 */
export type SubmitContext = {
  image: ResolvedImage;
  referenceImages: ResolvedImage[];
  /** 末帧(关键帧模式 A):支持关键帧的 descriptor 在 buildSubmit 里按各家字段挂上(Kling tail_image_url / Luma frame1) */
  endImage?: ResolvedImage;
  prompt: string;
  aspectRatio: string;
  durationSeconds: number | undefined;
  model: string;
  durations: Durations;
};

/** getStatus 拿到的一切:jobId + model + 一个已带鉴权、以 baseUrl 为根的请求器。 */
export type StatusContext = {
  jobId: string;
  model: string;
  http: (pathAndQuery: string, opts?: { method?: string; body?: unknown }) => Promise<Json>;
};

export type SubmitSpec = { path: string; body: object; headers?: Record<string, string> };

/** 每个 HTTP provider 的全部差异,收敛成一份数据 + 几个小函数。 */
export type HttpDescriptor = {
  id: string;
  inputMode: InputMode;
  auth: 'bearer' | 'key';
  apiKeyEnv: string;
  baseUrl: () => string;
  extraHeaders?: () => Record<string, string>; // 如 Runway 的 X-Runway-Version(提交+轮询都带)
  buildSubmit: (ctx: SubmitContext) => SubmitSpec;
  getStatus: (ctx: StatusContext) => Promise<Json>; // 单 GET;fal/MiniMax 在此做两段
  timeoutMs: () => number;
  pollIntervalMs: () => number;
  postProcess?: (outputPath: string) => Promise<void>; // 如 LTX 可寻址预览重编码
};

export class HttpVideoProvider implements VideoProvider {
  readonly id: string;
  readonly inputMode: InputMode;
  readonly model: string;
  private readonly descriptor: HttpDescriptor;
  private readonly durations: Durations;
  private readonly deps: ProviderDeps;

  constructor(descriptor: HttpDescriptor, meta: { model: string; durations: Durations }, deps: ProviderDeps) {
    this.descriptor = descriptor;
    this.id = descriptor.id;
    this.inputMode = descriptor.inputMode;
    this.model = meta.model;
    this.durations = meta.durations;
    this.deps = deps;
  }

  async generateClip(input: ClipInput): Promise<ClipResult> {
    const {
      image,
      prompt,
      referenceImages = [],
      endImage,
      outputPath,
      aspectRatio = '16:9',
      durationSeconds,
      onProgress,
    } = input;
    await mkdir(path.dirname(outputPath), { recursive: true });
    const d = this.descriptor;

    // public-url:校验输入图(含各参考图、末帧)为公网 https,否则外部 provider 拉不到。
    if (d.inputMode === 'public-url') {
      const allowHttp = envBool('ALLOW_HTTP_IMAGE_URLS', false);
      validateHttpsImageUrl(image.publicUrl, d.id, allowHttp);
      referenceImages.forEach((r) => validateHttpsImageUrl(r.publicUrl, d.id, allowHttp));
      if (endImage) validateHttpsImageUrl(endImage.publicUrl, d.id, allowHttp);
    }

    const apiKey = process.env[d.apiKeyEnv];
    const authHeaders = d.auth === 'key' ? keyHeaders(apiKey) : bearerHeaders(apiKey);
    const extra = d.extraHeaders?.() ?? {};
    const baseUrl = d.baseUrl();

    const submit = d.buildSubmit({
      image,
      referenceImages,
      endImage,
      prompt,
      aspectRatio,
      durationSeconds,
      model: this.model,
      durations: this.durations,
    });
    const submitted = await jsonRequest(this.deps.fetch, `${baseUrl}${submit.path}`, {
      method: 'POST',
      headers: { ...authHeaders, ...extra, ...(submit.headers ?? {}) },
      body: submit.body,
    });
    await reportProgress(onProgress, 0.45);

    const http = (pathAndQuery: string, opts?: { method?: string; body?: unknown }): Promise<Json> =>
      jsonRequest(this.deps.fetch, `${baseUrl}${pathAndQuery}`, {
        method: opts?.method ?? 'GET',
        headers: { ...authHeaders, ...extra },
        body: opts?.body,
      });

    const providerJobId = await pollTask({
      deps: this.deps,
      providerId: d.id,
      submitted,
      outputPath,
      onProgress,
      timeoutMs: d.timeoutMs(),
      pollIntervalMs: d.pollIntervalMs(),
      getStatus: (jobId) => d.getStatus({ jobId, model: this.model, http }),
    });

    if (d.postProcess) await d.postProcess(outputPath);
    return { provider: d.id, providerJobId, outputPath, duration: null };
  }
}
