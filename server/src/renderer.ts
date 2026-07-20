import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { newId, type UndoableState } from '@gedatou/shared';
import { writeBuffer } from './storage';

// 渲染入口：@gedatou/shared 的 Remotion composition（registerRoot，id="Main"）。
// 经 pnpm link: 消费源码，解析其 '.' 导出（src/index.ts）再定位同级 composition/entry.tsx。
const require = createRequire(import.meta.url);
const ENTRY = path.join(path.dirname(require.resolve('@gedatou/shared')), 'composition/entry.tsx');

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

export const enqueueRender = (state: UndoableState, codec: 'mp4' | 'webm'): string => {
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
      task.url = await writeBuffer(`renders/${taskId}.${codec}`, await fs.readFile(outputLocation));
      task.progress = 1;
      task.status = 'done';
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
