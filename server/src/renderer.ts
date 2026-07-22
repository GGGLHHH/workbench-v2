import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { newId, sanitizeFileName, type UndoableState } from '@gedatou/shared';
import { writeBuffer } from './storage';
import { appendRender, isValidProjectId } from './render-index';

// 渲染入口：v2 自己的 render-entry.tsx（先注册业务 custom item 渲染器，再 registerRoot 库的
// CompositionRoot，id="Main"）——bundle 库内 entry 会缺 lowerThird/cover 渲染器。
const ENTRY = fileURLToPath(new URL('../../src/render-entry.tsx', import.meta.url));

export type RenderTask = {
  status: 'queued' | 'rendering' | 'done' | 'error';
  progress: number; // 0-1
  url?: string;
  error?: string;
};

export const tasks = new Map<string, RenderTask>();

// 懒初始化：首次渲染才 bundle + 下载 headless 浏览器，进程内缓存 serveUrl
let serveUrlPromise: Promise<string> | null = null;
const getServeUrl = (): Promise<string> => {
  serveUrlPromise ??= (async () => {
    await ensureBrowser();
    return bundle({ entryPoint: ENTRY });
  })();
  return serveUrlPromise;
};

// ponytail: 内存 FIFO 单 worker，任务表随进程重启丢失；要持久化/并发时换 BullMQ
const queue: (() => Promise<void>)[] = [];
let running = false;
const pump = async (): Promise<void> => {
  if (running) return;
  running = true;
  while (queue.length > 0) await queue.shift()!();
  running = false;
};

export const enqueueRender = (
  state: UndoableState,
  codec: 'mp4' | 'webm',
  fileName?: string,
  projectId?: string,
): string => {
  const taskId = newId();
  tasks.set(taskId, { status: 'queued', progress: 0 });
  queue.push(async () => {
    const task = tasks.get(taskId)!;
    const outputLocation = path.join(tmpdir(), `render-${taskId}.${codec}`);
    try {
      task.status = 'rendering';
      const serveUrl = await getServeUrl();
      const inputProps = { state };
      const composition = await selectComposition({ serveUrl, id: 'Main', inputProps });
      await renderMedia({
        composition,
        serveUrl,
        inputProps,
        codec: codec === 'mp4' ? 'h264' : 'vp8',
        outputLocation,
        onProgress: ({ progress }) => {
          task.progress = progress;
        },
      });
      // 磁盘名保持 taskId（唯一、纯 ASCII）；给人看的下载名走 URL 上的 ?filename=，
      // 由 /media 静态路由据此发 Content-Disposition（见 index.ts 的 onSend 钩子）。
      // 编进 URL 而非存内存：无状态，任务表随进程重启丢了也不影响已发出的下载链接。
      // 名字由前端组装传入，这里只做防御性清洗——客户端输入不可信；给不出就回退 taskId 名。
      const url = await writeBuffer(`renders/${taskId}.${codec}`, await fs.readFile(outputLocation));
      const downloadName = sanitizeFileName(fileName ?? '') || `${taskId}.${codec}`;
      task.url = `${url}?filename=${encodeURIComponent(downloadName)}`;
      task.progress = 1;
      task.status = 'done';
      // 关联落本机索引(留历史):完成即写盘,不依赖浏览器还开着 → 抗刷新。
      // 索引出错不影响渲染成功(产物 URL 已可用),仅记日志。
      if (projectId && isValidProjectId(projectId)) {
        await appendRender(projectId, {
          taskId,
          url: task.url,
          fileName: downloadName,
          codec,
          createdAt: new Date().toISOString(),
          width: composition.width,
          height: composition.height,
          durationInFrames: composition.durationInFrames,
          fps: composition.fps,
        }).catch((e) => console.error('[render-index] append failed', e));
      }
    } catch (err) {
      task.status = 'error';
      task.error = err instanceof Error ? err.message : String(err);
    } finally {
      await fs.rm(outputLocation, { force: true });
    }
  });
  void pump();
  return taskId;
};
