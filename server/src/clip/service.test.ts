import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ClipInput, ClipResult, FetchLike, VideoProvider } from './types';
import { config } from '../config';
import { clipTasks, enqueueClip } from './service';
import { readClipIndex } from './clip-index';

// 索引写盘到 config.dataDir → 指到临时目录,避免污染真 .data。
let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'clip-svc-'));
  config.dataDir = tmp;
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});
// 大多数用例不传 projectId/sourceImageRef → 不写索引;仍注入假 probe,避免对假字节跑真 mediabunny。
const nullProbe = async () => ({ width: null, height: null, fps: null, durationSeconds: null, sizeBytes: null });

const throwingFetch: FetchLike = (async () => {
  throw new Error('image fetch should not run for public-url provider');
}) as unknown as FetchLike;

// 假 provider:写点字节到 outputPath + 报进度,不打真 API。
const fakeProvider = (impl?: (input: ClipInput) => Promise<ClipResult>): VideoProvider => ({
  id: 'fake',
  inputMode: 'public-url',
  generateClip:
    impl ??
    (async ({ outputPath, onProgress }) => {
      await onProgress?.(0.5);
      await writeFile(outputPath, 'FAKE-VIDEO');
      return { provider: 'fake', providerJobId: 'job-1', outputPath, duration: 7 };
    }),
});

afterEach(() => clipTasks.clear());

describe('enqueueClip', () => {
  it('runs queued → generating → done and persists the clip', async () => {
    const persisted: { key: string; bytes: string }[] = [];
    const taskId = enqueueClip(
      { imageUrl: 'https://cdn.test/a.jpg', prompt: 'p', provider: 'fake' },
      {
        createProvider: () => fakeProvider(),
        fetchImpl: throwingFetch,
        persist: async (key, buf) => {
          persisted.push({ key, bytes: buf.toString('utf8') });
          return `http://localhost:3011/media/${key}`;
        },
      },
    );
    // queued 是瞬态(pump 同步推进到 generating);只断言最终态。
    await vi.waitFor(() => expect(clipTasks.get(taskId)?.status).toBe('done'));
    const task = clipTasks.get(taskId)!;
    expect(task.progress).toBe(1);
    expect(task.provider).toBe('fake');
    expect(task.providerJobId).toBe('job-1');
    expect(task.durationSeconds).toBe(7);
    expect(task.url).toBe(`http://localhost:3011/media/clips/${taskId}.mp4`);
    expect(persisted).toEqual([{ key: `clips/${taskId}.mp4`, bytes: 'FAKE-VIDEO' }]);
  });

  it('writes a clip-index record (with probed media) when projectId + sourceImageRef are given', async () => {
    const taskId = enqueueClip(
      {
        imageUrl: 'https://cdn.test/a.jpg',
        prompt: 'GUARDRAIL... push in.',
        provider: 'fake',
        projectId: 'proj-1',
        sourceImageRef: 'img-9',
        durationSeconds: 8,
        aspectRatio: '9:16',
        promptBody: 'push in',
        cameraMove: 'slowPushIn',
      },
      {
        createProvider: () => fakeProvider(),
        fetchImpl: throwingFetch,
        persist: async (key) => `http://x/media/${key}`,
        probe: async () => ({ width: 1080, height: 1920, fps: 24, durationSeconds: 7.5, sizeBytes: 999 }),
      },
    );
    await vi.waitFor(() => expect(clipTasks.get(taskId)?.status).toBe('done'));
    expect(clipTasks.get(taskId)?.durationSeconds).toBe(7.5); // 探测时长回填 task

    const records = await readClipIndex('proj-1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      clipId: taskId,
      sourceImageRef: 'img-9',
      provider: 'fake',
      width: 1080,
      height: 1920,
      fps: 24,
      durationSeconds: 7.5,
      requestedDurationSeconds: 8,
      aspectRatio: '9:16',
      compiledPrompt: 'GUARDRAIL... push in.',
      promptBody: 'push in',
      cameraMove: 'slowPushIn',
      url: `http://x/media/clips/${taskId}.mp4`,
    });
  });

  it('records only the reference refs actually used (capped to max-1), not the full input', async () => {
    const taskId = enqueueClip(
      {
        imageUrl: 'https://cdn.test/a.jpg',
        prompt: 'p',
        provider: 'seedance', // REF_3 → hero + 2 used
        projectId: 'proj-refs',
        sourceImageRef: 'img-h',
        referenceImageUrls: ['https://cdn.test/r1', 'https://cdn.test/r2', 'https://cdn.test/r3', 'https://cdn.test/r4'],
        referenceImageRefs: ['r1', 'r2', 'r3', 'r4'],
      },
      { createProvider: () => fakeProvider(), fetchImpl: throwingFetch, persist: async () => 'u', probe: nullProbe },
    );
    await vi.waitFor(() => expect(clipTasks.get(taskId)?.status).toBe('done'));
    const rec = (await readClipIndex('proj-refs'))[0];
    expect(rec.referenceImageRefs).toEqual(['r1', 'r2']); // 只记实际喂给 provider 的 2 个
  });

  it('does NOT write an index record when projectId/sourceImageRef are absent (stateless mode)', async () => {
    const taskId = enqueueClip(
      { imageUrl: 'https://cdn.test/a.jpg', prompt: 'p', provider: 'fake' },
      { createProvider: () => fakeProvider(), fetchImpl: throwingFetch, persist: async () => 'u', probe: nullProbe },
    );
    await vi.waitFor(() => expect(clipTasks.get(taskId)?.status).toBe('done'));
    expect(await readClipIndex('proj-none')).toEqual([]);
  });

  it('marks the task error (formatted) when the provider throws', async () => {
    const taskId = enqueueClip(
      { imageUrl: 'https://cdn.test/a.jpg', prompt: 'p', provider: 'fake' },
      {
        createProvider: () =>
          fakeProvider(async () => {
            throw new Error('provider exploded');
          }),
        fetchImpl: throwingFetch,
        persist: async () => 'x',
      },
    );
    await vi.waitFor(() => expect(clipTasks.get(taskId)?.status).toBe('error'));
    expect(clipTasks.get(taskId)?.error).toBe('provider exploded');
  });

  it('resolves references only up to (max-1) for a reference-capable provider', async () => {
    let refCount = -1;
    const taskId = enqueueClip(
      {
        imageUrl: 'https://cdn.test/a.jpg',
        prompt: 'p',
        provider: 'seedance', // REF_3 → hero + 2
        referenceImageUrls: ['https://cdn.test/r1', 'https://cdn.test/r2', 'https://cdn.test/r3', 'https://cdn.test/r4'],
      },
      {
        createProvider: () =>
          fakeProvider(async ({ referenceImages, outputPath }) => {
            refCount = referenceImages?.length ?? 0;
            await writeFile(outputPath, 'X');
            return { provider: 'seedance', providerJobId: 'j', outputPath, duration: null };
          }),
        fetchImpl: throwingFetch,
        persist: async () => 'u',
      },
    );
    await vi.waitFor(() => expect(clipTasks.get(taskId)?.status).toBe('done'));
    expect(refCount).toBe(2);
  });

  it('skips references entirely for a no-reference provider', async () => {
    let refCount = -1;
    const taskId = enqueueClip(
      {
        imageUrl: 'https://cdn.test/a.jpg',
        prompt: 'p',
        provider: 'mock', // NO_REFERENCE
        referenceImageUrls: ['https://cdn.test/r1', 'https://cdn.test/r2'],
      },
      {
        createProvider: () =>
          fakeProvider(async ({ referenceImages, outputPath }) => {
            refCount = referenceImages?.length ?? 0;
            await writeFile(outputPath, 'X');
            return { provider: 'mock', providerJobId: 'j', outputPath, duration: null };
          }),
        fetchImpl: throwingFetch,
        persist: async () => 'u',
      },
    );
    await vi.waitFor(() => expect(clipTasks.get(taskId)?.status).toBe('done'));
    expect(refCount).toBe(0);
  });

  it('cleans up the temp output file after success', async () => {
    let capturedTmp = '';
    const taskId = enqueueClip(
      { imageUrl: 'https://cdn.test/a.jpg', prompt: 'p', provider: 'fake' },
      {
        createProvider: () =>
          fakeProvider(async ({ outputPath, onProgress }) => {
            capturedTmp = outputPath;
            await onProgress?.(0.5);
            await writeFile(outputPath, 'X');
            return { provider: 'fake', providerJobId: 'j', outputPath, duration: null };
          }),
        fetchImpl: throwingFetch,
        persist: async () => 'url',
      },
    );
    await vi.waitFor(() => expect(clipTasks.get(taskId)?.status).toBe('done'));
    await expect(readFile(capturedTmp)).rejects.toThrow(); // 临时文件已删
  });
});
