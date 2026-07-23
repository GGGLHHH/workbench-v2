// 单一 HTTP 引擎:所有异步轮询类 provider(Seedance/Runway/Kling/Luma/MiniMax/LTX)共用。
// 取代 xchangeai providers.js 里 4 套各自为政的轮询循环 + 26 分支猜谜 findVideoUrl。
// fetch/sleep 依赖注入 → 测试零网络零延迟;超时用 timeoutMs:0 确定性触发。
import { writeFile } from 'node:fs/promises';
import type { FetchLike, ProgressFn, SleepFn } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;

/** 递归剔除 undefined(JSON body 里 undefined 会被 JSON.stringify 丢掉,这里显式对齐)。 */
export const removeUndefined = (value: any): any => {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, removeUndefined(v)]),
  );
};

/** JSON 请求;!ok 抛出结构化消息(code: message)。 */
export const jsonRequest = async (
  fetchImpl: FetchLike,
  url: string,
  opts: { method: string; headers?: Record<string, string>; body?: unknown },
): Promise<Json> => {
  const response = await fetchImpl(url, {
    method: opts.method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(removeUndefined(opts.body)) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as Json;
  if (!response.ok) {
    const code = payload.error?.code ? `${payload.error.code}: ` : '';
    throw new Error(`${code}${payload.error?.message || payload.message || `Request failed (${response.status})`}`);
  }
  return payload;
};

/** 下载远程视频到本地路径。 */
export const downloadVideo = async (fetchImpl: FetchLike, url: string, outputPath: string): Promise<void> => {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Video download failed (${response.status})`);
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
};

export const bearerHeaders = (apiKey: string | undefined): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`,
});
export const keyHeaders = (apiKey: string | undefined): Record<string, string> => ({
  Authorization: `Key ${apiKey}`,
});

/** public-url provider 的输入图必须是公网 https(除非 ALLOW_HTTP_IMAGE_URLS)。 */
export const validateHttpsImageUrl = (imageUrl: string | undefined, label: string, allowHttp = false): string => {
  if (!imageUrl) throw new Error(`${label} image-to-video requires a public image URL`);
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error(`${label} image URL is invalid`);
  }
  if (parsed.protocol !== 'https:' && !allowHttp) {
    throw new Error(`${label} image-to-video requires an HTTPS image URL`);
  }
  return parsed.toString();
};

/** 从各家响应里找视频 URL(合并各 vendor 字段名;已去掉 xchangeai 的 video.url 死重复)。 */
export const findVideoUrl = (p: Json): string | undefined =>
  p.video_url ||
  p.videoUrl ||
  p.output_url ||
  p.outputUrl ||
  p.url ||
  p.video?.url ||
  p.video?.file?.url ||
  p.data?.video_url ||
  p.data?.videoUrl ||
  p.data?.output_url ||
  p.data?.outputUrl ||
  p.data?.url ||
  p.data?.results?.[0] ||
  p.data?.video?.url ||
  p.output?.video_url ||
  p.output?.videoUrl ||
  p.output?.url ||
  p.output?.[0] ||
  p.result?.video_url ||
  p.result?.videoUrl ||
  p.result?.url ||
  p.assets?.video ||
  p.retrievedFile?.file?.download_url ||
  p.retrievedFile?.file?.url ||
  p.retrievedFile?.download_url ||
  p.retrievedFile?.url ||
  undefined;

export const findJobId = (p: Json): string | undefined =>
  p.id ||
  p.taskId ||
  p.task_id ||
  p.job_id ||
  p.request_id ||
  p.generation_id ||
  p.data?.id ||
  p.data?.taskId ||
  p.data?.task_id ||
  p.data?.job_id ||
  p.data?.request_id ||
  p.output?.task_id ||
  undefined;

export const findFileId = (p: Json): string | undefined =>
  p.file_id ||
  p.fileId ||
  p.output_file_id ||
  p.output?.file_id ||
  p.data?.file_id ||
  p.data?.output_file_id ||
  undefined;

/** 单一状态分类器(取代 xchangeai 两套重叠的 normalizeState / isFailureState)。 */
export type TaskState = 'completed' | 'failed' | 'pending';
export const classifyState = (raw: unknown): TaskState => {
  const s = String(raw ?? '').toLowerCase();
  if (['complete', 'completed', 'succeeded', 'success', 'done', 'finished'].includes(s)) return 'completed';
  if (['failed', 'failure', 'error', 'canceled', 'cancelled'].includes(s)) return 'failed';
  return 'pending';
};

const readState = (status: Json): unknown =>
  status.status ?? status.state ?? status.data?.status ?? status.task_status ?? status.output?.status;

const failureMessage = (status: Json, providerId: string): string =>
  status.error?.message ||
  status.failed_reason ||
  status.data?.failed_reason ||
  status.message ||
  `${providerId} generation failed`;

export const reportProgress = async (onProgress: ProgressFn | undefined, progress: number): Promise<void> => {
  if (typeof onProgress === 'function') await onProgress(progress);
};

/** 进度曲线(0-1):提交后从 0.45 起匀速爬到 0.88,拿到视频前 0.92。 */
const pollProgress = (pollCount: number): number => Math.min(0.88, 0.48 + pollCount * 0.04);

export type PollArgs = {
  deps: { fetch: FetchLike; sleep: SleepFn; now?: () => number };
  providerId: string;
  submitted: Json;
  outputPath: string;
  onProgress?: ProgressFn;
  timeoutMs: number;
  pollIntervalMs: number;
  getStatus: (jobId: string) => Promise<Json>;
  extractVideoUrl?: (p: Json) => string | undefined;
  extractJobId?: (p: Json) => string | undefined;
};

/**
 * 提交后统一轮询到成片:立即视频 → 下载;否则拿 jobId 轮询到 completed(带视频)/失败/超时。
 * 返回下载后的 providerJobId(供上层记录)。
 */
export const pollTask = async (args: PollArgs): Promise<string> => {
  const {
    deps,
    providerId,
    submitted,
    outputPath,
    onProgress,
    timeoutMs,
    pollIntervalMs,
    getStatus,
    extractVideoUrl = findVideoUrl,
    extractJobId = findJobId,
  } = args;
  const now = deps.now ?? Date.now;

  const immediate = extractVideoUrl(submitted);
  if (immediate) {
    await reportProgress(onProgress, 0.92);
    await downloadVideo(deps.fetch, immediate, outputPath);
    return extractJobId(submitted) || `${providerId}-immediate`;
  }

  const jobId = extractJobId(submitted);
  if (!jobId) throw new Error(`${providerId} response did not include a video URL or job id`);

  const startedAt = now();
  let pollCount = 0;
  while (now() - startedAt < timeoutMs) {
    await reportProgress(onProgress, pollProgress(pollCount));
    await deps.sleep(Math.max(0, pollIntervalMs));
    const status = await getStatus(jobId);
    pollCount += 1;

    const raw = readState(status);
    const state = classifyState(raw);
    const videoUrl = extractVideoUrl(status);
    // 有视频且「状态缺失或已完成」才下载;状态明确 pending 时即便出现 url 也继续等,避免半成品。
    if (videoUrl && (!raw || state === 'completed')) {
      await reportProgress(onProgress, 0.92);
      await downloadVideo(deps.fetch, videoUrl, outputPath);
      return jobId;
    }
    if (state === 'completed' && !videoUrl) {
      throw new Error(`${providerId} completed without a video URL`);
    }
    if (state === 'failed') {
      throw new Error(failureMessage(status, providerId));
    }
  }
  throw new Error(`Timed out waiting for ${providerId} generation`);
};
