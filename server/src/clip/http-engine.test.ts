import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FetchLike } from './types';
import {
  classifyState,
  findFileId,
  findJobId,
  findVideoUrl,
  jsonRequest,
  pollTask,
  removeUndefined,
} from './http-engine';

// 路由表 mock fetch:key = "METHOD url";捕获请求供断言 body/headers。Buffer → 二进制响应。
type Routed = Record<string, unknown | Buffer | { __status: number; body: unknown }>;
const mockFetch = (requests: { url: string; opts: RequestInit }[], routes: Routed): FetchLike =>
  (async (url: string, opts: RequestInit = {}) => {
    const method = opts.method || 'GET';
    const key = `${method} ${url}`;
    requests.push({ url, opts });
    if (!(key in routes)) throw new Error(`Unexpected URL ${key}`);
    const payload = routes[key];
    if (Buffer.isBuffer(payload)) return new Response(payload, { status: 200 });
    if (payload && typeof payload === 'object' && '__status' in payload) {
      const p = payload as { __status: number; body: unknown };
      return new Response(JSON.stringify(p.body), { status: p.__status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as FetchLike;

const noSleep = () => Promise.resolve();
const deps = (requests: { url: string; opts: RequestInit }[], routes: Routed) => ({
  fetch: mockFetch(requests, routes),
  sleep: noSleep,
});

let tmp: string;
const tempOut = async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'clip-engine-'));
  return path.join(tmp, 'clip.mp4');
};
afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe('removeUndefined', () => {
  it('drops undefined recursively but keeps null/0/false', () => {
    expect(removeUndefined({ a: 1, b: undefined, c: { d: undefined, e: 0 }, f: null })).toEqual({
      a: 1,
      c: { e: 0 },
      f: null,
    });
  });
});

describe('jsonRequest', () => {
  it('sends JSON body + merged headers and returns parsed payload', async () => {
    const requests: { url: string; opts: RequestInit }[] = [];
    const routes = { 'POST https://api.test/submit': { id: 'job-1' } };
    const payload = await jsonRequest(mockFetch(requests, routes), 'https://api.test/submit', {
      method: 'POST',
      headers: { Authorization: 'Bearer k' },
      body: { a: 1, skip: undefined },
    });
    expect(payload).toEqual({ id: 'job-1' });
    expect(JSON.parse(requests[0].opts.body as string)).toEqual({ a: 1 });
    const headers = requests[0].opts.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer k');
  });

  it('throws structured message on non-ok', async () => {
    const routes = { 'POST https://api.test/x': { __status: 429, body: { error: { code: 429, message: 'quota hit' } } } };
    await expect(
      jsonRequest(mockFetch([], routes), 'https://api.test/x', { method: 'POST' }),
    ).rejects.toThrow('429: quota hit');
  });
});

describe('field extractors', () => {
  it('findVideoUrl covers nested vendor shapes', () => {
    expect(findVideoUrl({ video_url: 'a' })).toBe('a');
    expect(findVideoUrl({ data: { results: ['b'] } })).toBe('b');
    expect(findVideoUrl({ assets: { video: 'c' } })).toBe('c');
    expect(findVideoUrl({ output: ['d'] })).toBe('d');
    expect(findVideoUrl({ retrievedFile: { file: { download_url: 'e' } } })).toBe('e');
    expect(findVideoUrl({ nope: 1 })).toBeUndefined();
  });
  it('findJobId + findFileId', () => {
    expect(findJobId({ task_id: 't1' })).toBe('t1');
    expect(findJobId({ data: { request_id: 'r1' } })).toBe('r1');
    expect(findFileId({ file_id: 'f1' })).toBe('f1');
  });
});

describe('classifyState', () => {
  it('maps vendor states to completed/failed/pending', () => {
    expect(classifyState('SUCCEEDED')).toBe('completed');
    expect(classifyState('done')).toBe('completed');
    expect(classifyState('canceled')).toBe('failed');
    expect(classifyState('error')).toBe('failed');
    expect(classifyState('processing')).toBe('pending');
    expect(classifyState(undefined)).toBe('pending');
  });
});

describe('pollTask', () => {
  const args = (over: Partial<Parameters<typeof pollTask>[0]>) => ({
    deps: deps([], {}),
    providerId: 'seedance',
    submitted: {} as Record<string, unknown>,
    outputPath: '',
    onProgress: undefined,
    timeoutMs: 600000,
    pollIntervalMs: 0,
    getStatus: async () => ({}),
    ...over,
  });

  it('downloads immediately when submit already returns a video URL', async () => {
    const outputPath = await tempOut();
    const requests: { url: string; opts: RequestInit }[] = [];
    const d = deps(requests, { 'GET https://cdn.test/v.mp4': Buffer.from('immediate') });
    const jobId = await pollTask(
      args({ deps: d, submitted: { id: 'job-x', video_url: 'https://cdn.test/v.mp4' }, outputPath }),
    );
    expect(jobId).toBe('job-x');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('immediate');
  });

  it('polls until completed, then downloads (multi-poll ramp)', async () => {
    const outputPath = await tempOut();
    const requests: { url: string; opts: RequestInit }[] = [];
    const d = deps(requests, { 'GET https://cdn.test/done.mp4': Buffer.from('polled') });
    const progress: number[] = [];
    let call = 0;
    const jobId = await pollTask(
      args({
        deps: d,
        submitted: { id: 'job-2' },
        outputPath,
        onProgress: (p) => {
          progress.push(p);
        },
        getStatus: async () => {
          call += 1;
          return call < 2 ? { status: 'processing' } : { status: 'completed', video_url: 'https://cdn.test/done.mp4' };
        },
      }),
    );
    expect(jobId).toBe('job-2');
    expect(call).toBe(2);
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('polled');
    expect(progress.at(-1)).toBe(0.92);
    expect(progress.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps polling when a URL appears while status is still pending (no half-baked download)', async () => {
    const outputPath = await tempOut();
    const requests: { url: string; opts: RequestInit }[] = [];
    // 只路由最终成片;若守卫失效去下 partial.mp4,mockFetch 会因未注册路由抛错 → 测试失败。
    const d = deps(requests, { 'GET https://cdn.test/final.mp4': Buffer.from('final') });
    let call = 0;
    await pollTask(
      args({
        deps: d,
        submitted: { id: 'j' },
        outputPath,
        getStatus: async () => {
          call += 1;
          return call < 2
            ? { status: 'processing', video_url: 'https://cdn.test/partial.mp4' }
            : { status: 'completed', video_url: 'https://cdn.test/final.mp4' };
        },
      }),
    );
    expect(call).toBe(2);
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('final');
  });

  it('throws when the task completes without a video URL', async () => {
    const outputPath = await tempOut();
    await expect(
      pollTask(args({ deps: deps([], {}), submitted: { id: 'j' }, outputPath, getStatus: async () => ({ status: 'completed' }) })),
    ).rejects.toThrow('completed without a video URL');
  });

  it('throws the provider failure message on a failed state', async () => {
    const outputPath = await tempOut();
    await expect(
      pollTask(
        args({
          deps: deps([], {}),
          submitted: { id: 'j' },
          outputPath,
          getStatus: async () => ({ status: 'failed', error: { message: 'boom' } }),
        }),
      ),
    ).rejects.toThrow('boom');
  });

  it('throws when the submit response has neither URL nor job id', async () => {
    const outputPath = await tempOut();
    await expect(pollTask(args({ deps: deps([], {}), submitted: {}, outputPath }))).rejects.toThrow(
      'did not include a video URL or job id',
    );
  });

  it('throws on timeout (timeoutMs 0 = no polls)', async () => {
    const outputPath = await tempOut();
    let polled = false;
    await expect(
      pollTask(
        args({
          deps: deps([], {}),
          submitted: { id: 'j' },
          outputPath,
          timeoutMs: 0,
          getStatus: async () => {
            polled = true;
            return {};
          },
        }),
      ),
    ).rejects.toThrow('Timed out waiting for seedance generation');
    expect(polled).toBe(false);
  });
});
