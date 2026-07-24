// 6 个 HTTP provider 的声明式描述符(工厂:同族多 id 复用一份逻辑,如 Runway/Luma 各两档)。
// 请求体逐字端口自 xchangeai-workbench/server/providers.js,保真不漂移。
import type { HttpDescriptor } from './http-provider';
import { classifyState, findFileId, findVideoUrl } from './http-engine';
import { normalizeClipDurationSeconds, snapDuration } from './constants';
import { envBool, envInt, envStr, trimTrailingSlash } from './env';

const enc = encodeURIComponent;
/** {id} 模板 → 具体状态路径。 */
const statusPath = (envName: string, def: string, jobId: string): string =>
  envStr(envName, def).replace('{id}', enc(jobId));

/** Seedance:public-url,hero + ≤2 同房间参考角度(max 3);单 GET 轮询。 */
export const seedanceDescriptor = (id: string): HttpDescriptor => ({
  id,
  inputMode: 'public-url',
  auth: 'bearer',
  apiKeyEnv: 'SEEDANCE_API_KEY',
  baseUrl: () => trimTrailingSlash(envStr('SEEDANCE_BASE_URL', 'https://api.seedance2.ai')),
  timeoutMs: () => envInt('SEEDANCE_TIMEOUT_MS', 600000),
  pollIntervalMs: () => envInt('SEEDANCE_POLL_INTERVAL_MS', 10000),
  buildSubmit: (ctx) => {
    const imageUrls = [ctx.image.publicUrl!, ...ctx.referenceImages.map((r) => r.publicUrl!)].slice(0, 3);
    return {
      path: envStr('SEEDANCE_SUBMIT_PATH', '/v1/videos/generations'),
      body: {
        model: envStr('SEEDANCE_MODEL', 'seedance-2-0'),
        callback_url: process.env.SEEDANCE_CALLBACK_URL || undefined,
        input: {
          prompt: ctx.prompt,
          generation_type: 'image-to-video',
          image_urls: imageUrls,
          duration: normalizeClipDurationSeconds(ctx.durationSeconds ?? process.env.SEEDANCE_DURATION_SECONDS),
          aspect_ratio: ctx.aspectRatio,
          resolution: envStr('SEEDANCE_RESOLUTION', '720p'),
          generate_audio: envBool('SEEDANCE_GENERATE_AUDIO', false),
          watermark: envBool('SEEDANCE_WATERMARK', false),
          web_search: envBool('SEEDANCE_WEB_SEARCH', false),
          return_last_frame: envBool('SEEDANCE_RETURN_LAST_FRAME', false),
          seed: envInt('SEEDANCE_SEED', -1),
        },
      },
    };
  },
  getStatus: ({ jobId, http }) => http(statusPath('SEEDANCE_STATUS_PATH_TEMPLATE', '/v1/tasks/{id}', jobId)),
});

/** Runway Gen-4:public-url,X-Runway-Version 头,5/10 秒。 */
export const runwayDescriptor = (id: string): HttpDescriptor => ({
  id,
  inputMode: 'public-url',
  auth: 'bearer',
  apiKeyEnv: 'RUNWAY_API_KEY',
  baseUrl: () => trimTrailingSlash(envStr('RUNWAY_BASE_URL', 'https://api.dev.runwayml.com')),
  extraHeaders: () => ({ 'X-Runway-Version': envStr('RUNWAY_API_VERSION', '2024-11-06') }),
  timeoutMs: () => envInt('RUNWAY_TIMEOUT_MS', 900000),
  pollIntervalMs: () => envInt('RUNWAY_POLL_INTERVAL_MS', 10000),
  buildSubmit: (ctx) => ({
    path: envStr('RUNWAY_SUBMIT_PATH', '/v1/image_to_video'),
    body: {
      model: ctx.model,
      promptImage: ctx.image.publicUrl,
      promptText: ctx.prompt,
      ratio: envStr('RUNWAY_RATIO', '1280:720'),
      duration: snapDuration(ctx.durations, ctx.durationSeconds ?? process.env.RUNWAY_DURATION_SECONDS ?? 5),
    },
  }),
  getStatus: ({ jobId, http }) => http(statusPath('RUNWAY_STATUS_PATH_TEMPLATE', '/v1/tasks/{id}', jobId)),
});

/** fal Kling:data-uri(或公网 url),Key 鉴权,时长是字符串枚举;状态两段(status → result)。 */
export const falKlingDescriptor = (id: string): HttpDescriptor => ({
  id,
  inputMode: 'data-uri',
  auth: 'key',
  apiKeyEnv: 'FAL_KEY',
  baseUrl: () => trimTrailingSlash(envStr('FAL_QUEUE_BASE_URL', 'https://queue.fal.run')),
  timeoutMs: () => envInt('FAL_TIMEOUT_MS', 900000),
  pollIntervalMs: () => envInt('FAL_POLL_INTERVAL_MS', 5000),
  buildSubmit: (ctx) => {
    const modelPath = ctx.model.replace(/^\/+/, '');
    return {
      path: `/${modelPath}`,
      body: {
        prompt: ctx.prompt,
        image_url: ctx.image.publicUrl || ctx.image.dataUri,
        // 关键帧模式 A:末帧作 tail_image_url(Kling 首尾帧),缺省则普通单图 i2v。
        ...(ctx.endImage ? { tail_image_url: ctx.endImage.publicUrl || ctx.endImage.dataUri } : {}),
        duration: String(snapDuration(ctx.durations, ctx.durationSeconds ?? process.env.FAL_KLING_DURATION ?? 5)),
        aspect_ratio: ctx.aspectRatio,
        negative_prompt: envStr(
          'FAL_KLING_NEGATIVE_PROMPT',
          'blur, distortion, warping, flicker, unrealistic motion, extra furniture, people, text, watermark',
        ),
      },
    };
  },
  getStatus: async ({ jobId, model, http }) => {
    const modelPath = model.replace(/^\/+/, '');
    const status = await http(`/${modelPath}/requests/${enc(jobId)}/status`);
    if (classifyState(status.status ?? status.state) === 'completed') {
      // 合并 result 到 status:result 无 status 字段,保留 completed 标记 →
      // pollTask 能对「completed 但结果无视频 URL」立即快速失败,而非空转到超时。
      const result = await http(`/${modelPath}/requests/${enc(jobId)}`);
      return { ...status, ...result };
    }
    return status;
  },
});

/** Luma Ray:public-url,keyframes.frame0.url;单 GET 轮询。 */
export const lumaDescriptor = (id: string): HttpDescriptor => ({
  id,
  inputMode: 'public-url',
  auth: 'bearer',
  apiKeyEnv: 'LUMA_API_KEY',
  baseUrl: () => trimTrailingSlash(envStr('LUMA_BASE_URL', 'https://api.lumalabs.ai')),
  timeoutMs: () => envInt('LUMA_TIMEOUT_MS', 900000),
  pollIntervalMs: () => envInt('LUMA_POLL_INTERVAL_MS', 10000),
  buildSubmit: (ctx) => ({
    path: envStr('LUMA_SUBMIT_PATH', '/dream-machine/v1/generations'),
    body: {
      prompt: ctx.prompt,
      model: ctx.model,
      aspect_ratio: ctx.aspectRatio,
      // 关键帧模式 A:frame0=首帧、frame1=末帧(Luma keyframes);缺末帧则仅 frame0(普通 i2v)。
      keyframes: {
        frame0: { type: 'image', url: ctx.image.publicUrl },
        ...(ctx.endImage ? { frame1: { type: 'image', url: ctx.endImage.publicUrl } } : {}),
      },
    },
  }),
  getStatus: ({ jobId, http }) =>
    http(statusPath('LUMA_STATUS_PATH_TEMPLATE', '/dream-machine/v1/generations/{id}', jobId)),
});

/** MiniMax:public-url,first_frame_image;状态两段(query → file retrieve)。 */
export const minimaxDescriptor = (id: string): HttpDescriptor => ({
  id,
  inputMode: 'public-url',
  auth: 'bearer',
  apiKeyEnv: 'MINIMAX_API_KEY',
  baseUrl: () => trimTrailingSlash(envStr('MINIMAX_BASE_URL', 'https://api.minimax.io')),
  timeoutMs: () => envInt('MINIMAX_TIMEOUT_MS', 900000),
  pollIntervalMs: () => envInt('MINIMAX_POLL_INTERVAL_MS', 10000),
  buildSubmit: (ctx) => ({
    path: envStr('MINIMAX_SUBMIT_PATH', '/v1/video_generation'),
    body: { model: ctx.model, prompt: ctx.prompt, first_frame_image: ctx.image.publicUrl },
  }),
  getStatus: async ({ jobId, http }) => {
    const status = await http(statusPath('MINIMAX_STATUS_PATH_TEMPLATE', '/v1/query/video_generation?task_id={id}', jobId));
    const fileId = findFileId(status);
    if (fileId && !findVideoUrl(status)) {
      const file = await http(statusPath('MINIMAX_RETRIEVE_PATH_TEMPLATE', '/v1/files/retrieve?file_id={id}', fileId));
      return { ...status, retrievedFile: file };
    }
    return status;
  },
});

/** LTX 2.3 Fast:public-url,image_uri + 分辨率/fps;单 GET 轮询。
 *  ponytail:xchangeai 会在下载后重编码成可寻址预览(optimizeClipForSeekablePreview);
 *  v2 暂无该 ffmpeg helper,step 1 略过 postProcess —— clip 可用,仅时间线拖动预览可能略卡。 */
export const ltxDescriptor = (id: string): HttpDescriptor => ({
  id,
  inputMode: 'public-url',
  auth: 'bearer',
  apiKeyEnv: 'LTX_API_KEY',
  baseUrl: () => trimTrailingSlash(envStr('LTX_BASE_URL', 'https://api.ltx.video')),
  timeoutMs: () => envInt('LTX_TIMEOUT_MS', 900000),
  pollIntervalMs: () => envInt('LTX_POLL_INTERVAL_MS', 10000),
  buildSubmit: (ctx) => ({
    path: envStr('LTX_SUBMIT_PATH', '/v2/image-to-video'),
    body: {
      image_uri: ctx.image.publicUrl,
      prompt: ctx.prompt,
      model: ctx.model,
      duration: snapDuration(ctx.durations, ctx.durationSeconds ?? process.env.LTX_DURATION_SECONDS ?? 6),
      resolution: envStr('LTX_RESOLUTION', '1920x1080'),
      fps: envInt('LTX_FPS', 24),
      generate_audio: envBool('LTX_GENERATE_AUDIO', false),
    },
  }),
  getStatus: ({ jobId, http }) => http(statusPath('LTX_STATUS_PATH_TEMPLATE', '/v2/image-to-video/{id}', jobId)),
});
