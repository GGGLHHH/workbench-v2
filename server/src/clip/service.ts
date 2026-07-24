// 图生视频异步任务:enqueueClip → taskId,内存 clipTasks 表轮询。镜像 server/src/renderer.ts 的
// FIFO 单 worker 模式;provider 产出的临时文件读进来 → storage.writeBuffer('clips/…') → /media 绝对 URL。
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newId } from '@gedatou/shared';
import { writeBuffer } from '../storage';
import type { ClipTask, FetchLike, VideoProvider } from './types';
import { createProvider, formatProviderError, getProviderKeyframeSupport, getProviderName, getProviderReferenceSupport } from './registry';
import { resolveImageInput, resolveReferenceImages } from './image-input';
import { appendClip } from './clip-index';
import { probeVideo, type ProbeResult } from './probe';

export const clipTasks = new Map<string, ClipTask>();

export type EnqueueClipInput = {
  provider?: string;
  imageUrl: string;
  prompt: string; // 已编译好的运镜 prompt(BFF 合成)
  durationSeconds?: number;
  aspectRatio?: string;
  referenceImageUrls?: string[];
  /** 末帧(关键帧模式 A):设了且 provider 支持关键帧时,image=首帧、endImageUrl=末帧 → 一条穿越视频 */
  endImageUrl?: string;
  // —— 绑定 + 元数据(A 方案):齐全时生成成功后写本机 clip 索引;缺则退化为无状态生成 ——
  projectId?: string;
  sourceImageRef?: string; // 主源图(单图/批量=该图;序列=首图)
  sourceImageRefs?: string[]; // 归属的全部源图 ref(序列=全组成员;缺省视为 [sourceImageRef])
  referenceImageRefs?: string[]; // 用到的参考角度的稳定 id
  promptBody?: string; // 前端运镜参数(存进记录,可回填再生)
  cameraMove?: string;
  focusSubject?: string;
  lightTransition?: string;
};

// 注入点:测试传假 provider / fetch / persist / probe,不打真 API、不落真盘、不解码真视频。
export type ClipServiceDeps = {
  createProvider?: (name: string) => VideoProvider;
  fetchImpl?: FetchLike;
  persist?: (key: string, buf: Buffer) => Promise<string>;
  probe?: (filePath: string) => Promise<ProbeResult>;
};

// ponytail: 内存 FIFO 单 worker,任务表随进程重启丢失;要持久化/并发时换正式队列。
const queue: (() => Promise<void>)[] = [];
let running = false;
const pump = async (): Promise<void> => {
  if (running) return;
  running = true;
  while (queue.length > 0) await queue.shift()!();
  running = false;
};

export const enqueueClip = (input: EnqueueClipInput, deps: ClipServiceDeps = {}): string => {
  const create = deps.createProvider ?? ((name: string) => createProvider(name));
  const fetchImpl = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const persist = deps.persist ?? writeBuffer;
  const probe = deps.probe ?? probeVideo;

  const taskId = newId();
  clipTasks.set(taskId, { status: 'queued', progress: 0 });
  queue.push(async () => {
    const task = clipTasks.get(taskId)!;
    const outputPath = path.join(tmpdir(), `clip-${taskId}.mp4`);
    const providerName = input.provider || getProviderName();
    try {
      task.status = 'generating';
      const provider = create(providerName);
      const image = await resolveImageInput(input.imageUrl, provider.inputMode, fetchImpl);
      // 只有支持参考图的 provider 才解析参考图,且封顶到 max-1(hero 占一位)。防止:
      // ①对不支持参考图的 provider 白解析/硬失败 ②任意条数 URL 一把 Promise.all 扇出(SSRF 放大/DoS)。
      const refSupport = getProviderReferenceSupport(providerName);
      const maxRefs = refSupport.supported ? Math.max(0, refSupport.max - 1) : 0; // hero 占一位
      const refUrls = (input.referenceImageUrls ?? []).slice(0, maxRefs);
      // 记录里的 refs 与实际喂给 provider 的用量对齐(否则「用到的参考角度」会过报未用到的)。
      const usedRefRefs = (input.referenceImageRefs ?? []).slice(0, maxRefs);
      const referenceImages = refUrls.length
        ? await resolveReferenceImages(refUrls, provider.inputMode, fetchImpl)
        : [];
      // 关键帧模式 A:仅当传了末帧且 provider 支持关键帧时解析(否则忽略,退化为普通单图 i2v)
      const endImage =
        input.endImageUrl && getProviderKeyframeSupport(providerName).supported
          ? await resolveImageInput(input.endImageUrl, provider.inputMode, fetchImpl)
          : undefined;
      const result = await provider.generateClip({
        image,
        prompt: input.prompt,
        referenceImages,
        endImage,
        outputPath,
        aspectRatio: input.aspectRatio,
        durationSeconds: input.durationSeconds,
        onProgress: (p) => {
          if (task.status === 'generating') task.progress = p;
        },
      });
      // 探测成片媒体属性(时长/宽高/fps/大小)——补上服务层原来 duration 恒 null 的缺口。
      const media = await probe(result.outputPath);
      const url = await persist(`clips/${taskId}.mp4`, await readFile(result.outputPath));
      task.url = url;
      task.provider = result.provider;
      task.providerJobId = result.providerJobId;
      task.durationSeconds = media.durationSeconds ?? result.duration ?? undefined;
      task.progress = 1;
      task.status = 'done';

      // 绑定齐全 → 写本机 clip 索引(A 方案)。索引出错不影响生成成功(clip URL 已可用),仅记日志。
      if (input.projectId && input.sourceImageRef) {
        await appendClip(input.projectId, {
          clipId: taskId,
          projectId: input.projectId,
          sourceImageRef: input.sourceImageRef,
          sourceImageRefs: input.sourceImageRefs?.length ? input.sourceImageRefs : undefined,
          referenceImageRefs: usedRefRefs.length ? usedRefRefs : undefined,
          url,
          provider: result.provider,
          model: provider.model ?? providerName,
          providerJobId: result.providerJobId,
          aspectRatio: input.aspectRatio ?? '16:9',
          requestedDurationSeconds: input.durationSeconds ?? null,
          durationSeconds: media.durationSeconds ?? result.duration ?? null,
          width: media.width,
          height: media.height,
          fps: media.fps,
          sizeBytes: media.sizeBytes,
          compiledPrompt: input.prompt,
          promptBody: input.promptBody,
          cameraMove: input.cameraMove,
          focusSubject: input.focusSubject,
          lightTransition: input.lightTransition,
          createdAt: new Date().toISOString(),
        }).catch((e) => console.error('[clip-index] append failed', e));
      }
    } catch (err) {
      task.status = 'error';
      task.error = formatProviderError(err, providerName);
    } finally {
      await rm(outputPath, { force: true });
    }
  });
  void pump();
  return taskId;
};
