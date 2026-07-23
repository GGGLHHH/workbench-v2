import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike, ProviderDeps } from './types';
import {
  createProvider,
  formatProviderError,
  getProviderConfigurationIssue,
  getProviderDurations,
  getProviderName,
  getProviderOptions,
  getProviderReferenceSupport,
  isProviderConfigured,
  normalizeProviderName,
  snapProviderDuration,
} from './registry';

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

type Routed = Record<string, unknown | Buffer>;
const mockFetch = (requests: { url: string; opts: RequestInit }[], routes: Routed): FetchLike =>
  (async (url: string, opts: RequestInit = {}) => {
    const key = `${opts.method || 'GET'} ${url}`;
    requests.push({ url, opts });
    if (!(key in routes)) throw new Error(`Unexpected URL ${key}`);
    const payload = routes[key];
    if (Buffer.isBuffer(payload)) return new Response(payload, { status: 200 });
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as FetchLike;

const deps = (requests: { url: string; opts: RequestInit }[], routes: Routed): ProviderDeps => ({
  fetch: mockFetch(requests, routes),
  sleep: () => Promise.resolve(),
});

let tmp: string;
const tempOut = async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'clip-prov-'));
  return path.join(tmp, 'clip.mp4');
};
afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const bodyOf = (requests: { opts: RequestInit }[]) => JSON.parse(requests[0].opts.body as string);

describe('provider registry', () => {
  it('defaults to LTX when VIDEO_PROVIDER is unset', () => {
    delete process.env.VIDEO_PROVIDER;
    expect(getProviderName()).toBe('ltx-2-3-fast');
  });

  it('normalizes env / UI aliases', () => {
    expect(normalizeProviderName('veo-fast')).toBe('veo-3.1-fast');
    expect(normalizeProviderName('runway-gen45')).toBe('runway-gen4.5');
    expect(normalizeProviderName('kling')).toBe('fal-kling-2.1-standard');
    expect(normalizeProviderName('ray-flash-2')).toBe('luma-ray-2-flash');
    expect(normalizeProviderName('hailuo')).toBe('minimax-i2v-direct');
    expect(normalizeProviderName('ltx2-fast')).toBe('ltx-2-3-fast');
    expect(normalizeProviderName('garbage')).toBeNull();
  });

  it('reports configuration issues by required env key', () => {
    delete process.env.RUNWAY_API_KEY;
    delete process.env.LTX_API_KEY;
    expect(isProviderConfigured('mock')).toBe(true);
    expect(getProviderConfigurationIssue('runway-gen4-turbo')).toBe('needs RUNWAY_API_KEY');
    expect(getProviderConfigurationIssue('ltx-2-3-fast')).toBe('needs LTX_API_KEY');
    expect(getProviderConfigurationIssue('nonexistent')).toBe('unsupported provider');

    process.env.RUNWAY_API_KEY = 'r';
    process.env.LTX_API_KEY = 'l';
    expect(isProviderConfigured('runway-gen4-turbo')).toBe(true);
    expect(isProviderConfigured('ltx-2-3-fast')).toBe(true);
  });

  it('publishes the provider catalog in order', () => {
    expect(getProviderOptions().map((o) => o.id)).toEqual([
      'mock',
      'gemini-omni',
      'veo-3.1',
      'veo-3.1-fast',
      'veo-3.1-lite',
      'seedance',
      'runway-gen4-turbo',
      'runway-gen4.5',
      'fal-kling-2.1-standard',
      'luma-ray-2',
      'luma-ray-2-flash',
      'minimax-i2v-direct',
      'ltx-2-3-fast',
    ]);
    const first = getProviderOptions()[0];
    expect(first).toHaveProperty('inputMode');
    expect(first).toHaveProperty('model');
    expect(first).toHaveProperty('durations');
  });

  it('reports reference-image support only for Veo + Seedance', () => {
    expect(getProviderReferenceSupport('veo-3.1')).toEqual({ supported: true, max: 3 });
    expect(getProviderReferenceSupport('seedance')).toEqual({ supported: true, max: 3 });
    expect(getProviderReferenceSupport('ltx-2-3-fast')).toEqual({ supported: false, max: 0 });
    expect(getProviderReferenceSupport('nonexistent')).toEqual({ supported: false, max: 0 });
  });

  it('snaps requested durations to each model', () => {
    expect(snapProviderDuration('ltx-2-3-fast', 7)).toBe(6);
    expect(snapProviderDuration('ltx-2-3-fast', 9)).toBe(8);
    expect(snapProviderDuration('ltx-2-3-fast', 60)).toBe(20);
    expect(snapProviderDuration('runway-gen4-turbo', 8)).toBe(10);
    expect(snapProviderDuration('runway-gen4-turbo', 6)).toBe(5);
    expect(getProviderDurations('veo-3.1').adjustable).toBe(false);
    expect(snapProviderDuration('veo-3.1', 7)).toBe(7);
  });

  it('restricts LTX durations at high fps / above 1080p', () => {
    process.env.LTX_RESOLUTION = '3840x2160';
    expect(getProviderDurations('ltx-2-3-fast').values).toEqual([6, 8, 10]);
    delete process.env.LTX_RESOLUTION;
    process.env.LTX_FPS = '48';
    expect(getProviderDurations('ltx-2-3-fast').values).toEqual([6, 8, 10]);
  });

  it('creates a configured provider instance via the factory', () => {
    process.env.RUNWAY_API_KEY = 'r';
    const provider = createProvider('runway-gen4-turbo', { fetch: (() => {}) as unknown as FetchLike, sleep: () => Promise.resolve() });
    expect(provider.id).toBe('runway-gen4-turbo');
    expect(provider.inputMode).toBe('public-url');
    expect(provider.model).toBe('gen4_turbo');
  });

  it('throws when creating an unconfigured provider', () => {
    delete process.env.RUNWAY_API_KEY;
    expect(() => createProvider('runway-gen4-turbo')).toThrow('is not configured: needs RUNWAY_API_KEY');
  });
});

describe('provider error formatting', () => {
  it('turns JSON quota errors into readable advice', () => {
    const formatted = formatProviderError(
      new Error(JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota', status: 'RESOURCE_EXHAUSTED' } })),
      'veo-3.1-fast',
    );
    expect(formatted).toContain('Veo 3.1 Fast quota/rate limit hit');
    expect(formatted).not.toContain('{"error"');
  });
});

describe('HTTP provider adapters', () => {
  it('builds the Seedance request and downloads the completed clip', async () => {
    const outputPath = await tempOut();
    const requests: { url: string; opts: RequestInit }[] = [];
    process.env.SEEDANCE_API_KEY = 'seed-key';
    process.env.SEEDANCE_BASE_URL = 'https://api.seedance.test';
    process.env.SEEDANCE_POLL_INTERVAL_MS = '0';
    const provider = createProvider(
      'seedance',
      deps(requests, {
        'POST https://api.seedance.test/v1/videos/generations': { taskId: 'task-123' },
        'GET https://api.seedance.test/v1/tasks/task-123': { id: 'task-123', status: 'completed', data: { results: ['https://cdn.seedance.test/x.mp4'] } },
        'GET https://cdn.seedance.test/x.mp4': Buffer.from('seed-video'),
      }),
    );
    const result = await provider.generateClip({
      image: { publicUrl: 'https://cdn.example.com/front.jpg' },
      prompt: 'Slow push-in.',
      outputPath,
      aspectRatio: '16:9',
      durationSeconds: 8,
    });
    expect(result.provider).toBe('seedance');
    expect(bodyOf(requests).input).toMatchObject({
      image_urls: ['https://cdn.example.com/front.jpg'],
      duration: 8,
      aspect_ratio: '16:9',
    });
    expect((requests[0].opts.headers as Record<string, string>).Authorization).toBe('Bearer seed-key');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('seed-video');
  });

  it('appends same-room reference angles to Seedance image_urls (max 3)', async () => {
    const outputPath = await tempOut();
    const requests: { url: string; opts: RequestInit }[] = [];
    process.env.SEEDANCE_API_KEY = 'seed-key';
    process.env.SEEDANCE_BASE_URL = 'https://api.seedance.test';
    process.env.SEEDANCE_POLL_INTERVAL_MS = '0';
    const provider = createProvider(
      'seedance',
      deps(requests, {
        'POST https://api.seedance.test/v1/videos/generations': { taskId: 't9' },
        'GET https://api.seedance.test/v1/tasks/t9': { id: 't9', status: 'completed', data: { results: ['https://cdn.seedance.test/t9.mp4'] } },
        'GET https://cdn.seedance.test/t9.mp4': Buffer.from('v'),
      }),
    );
    await provider.generateClip({
      image: { publicUrl: 'https://cdn.example.com/hero.jpg' },
      referenceImages: [
        { publicUrl: 'https://cdn.example.com/a2.jpg' },
        { publicUrl: 'https://cdn.example.com/a3.jpg' },
        { publicUrl: 'https://cdn.example.com/a4.jpg' }, // 4th dropped
      ],
      prompt: 'p',
      outputPath,
      durationSeconds: 8,
    });
    expect(bodyOf(requests).input.image_urls).toEqual([
      'https://cdn.example.com/hero.jpg',
      'https://cdn.example.com/a2.jpg',
      'https://cdn.example.com/a3.jpg',
    ]);
  });

  it('builds the Runway request (ratio + snapped duration)', async () => {
    const outputPath = await tempOut();
    const requests: { url: string; opts: RequestInit }[] = [];
    process.env.RUNWAY_API_KEY = 'rw';
    process.env.RUNWAY_BASE_URL = 'https://api.runway.test';
    process.env.RUNWAY_POLL_INTERVAL_MS = '0';
    const provider = createProvider(
      'runway-gen4-turbo',
      deps(requests, {
        'POST https://api.runway.test/v1/image_to_video': { id: 'rw-task' },
        'GET https://api.runway.test/v1/tasks/rw-task': { status: 'SUCCEEDED', output: ['https://cdn.runway.test/v.mp4'] },
        'GET https://cdn.runway.test/v.mp4': Buffer.from('rw-video'),
      }),
    );
    const result = await provider.generateClip({
      image: { publicUrl: 'https://cdn.example.com/front.jpg' },
      prompt: 'p',
      outputPath,
      durationSeconds: 9,
    });
    expect(result.provider).toBe('runway-gen4-turbo');
    expect(bodyOf(requests)).toMatchObject({ model: 'gen4_turbo', promptImage: 'https://cdn.example.com/front.jpg', ratio: '1280:720', duration: 10 });
    expect((requests[0].opts.headers as Record<string, string>)['X-Runway-Version']).toBe('2024-11-06');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('rw-video');
  });

  it('builds the fal Kling queue request (dataUri + 3-hop) ', async () => {
    const outputPath = await tempOut();
    const requests: { url: string; opts: RequestInit }[] = [];
    process.env.FAL_KEY = 'fk';
    process.env.FAL_QUEUE_BASE_URL = 'https://queue.fal.test';
    process.env.FAL_POLL_INTERVAL_MS = '0';
    const provider = createProvider(
      'fal-kling-2.1-standard',
      deps(requests, {
        'POST https://queue.fal.test/fal-ai/kling-video/v2.1/standard/image-to-video': { request_id: 'fal-task' },
        'GET https://queue.fal.test/fal-ai/kling-video/v2.1/standard/image-to-video/requests/fal-task/status': { status: 'COMPLETED' },
        'GET https://queue.fal.test/fal-ai/kling-video/v2.1/standard/image-to-video/requests/fal-task': { video: { url: 'https://cdn.fal.test/v.mp4' } },
        'GET https://cdn.fal.test/v.mp4': Buffer.from('fal-video'),
      }),
    );
    await provider.generateClip({
      image: { dataUri: 'data:image/jpeg;base64,abc' },
      prompt: 'p',
      outputPath,
      aspectRatio: '16:9',
    });
    expect(bodyOf(requests).image_url).toBe('data:image/jpeg;base64,abc');
    expect(bodyOf(requests).duration).toBe('5'); // fal 要求时长是字符串枚举,不是数字
    expect((requests[0].opts.headers as Record<string, string>).Authorization).toBe('Key fk');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('fal-video');
  });

  it('builds the Luma request', async () => {
    const outputPath = await tempOut();
    const requests: { url: string; opts: RequestInit }[] = [];
    process.env.LUMA_API_KEY = 'lu';
    process.env.LUMA_BASE_URL = 'https://api.luma.test';
    process.env.LUMA_POLL_INTERVAL_MS = '0';
    const provider = createProvider(
      'luma-ray-2',
      deps(requests, {
        'POST https://api.luma.test/dream-machine/v1/generations': { id: 'luma-task' },
        'GET https://api.luma.test/dream-machine/v1/generations/luma-task': { id: 'luma-task', state: 'completed', assets: { video: 'https://cdn.luma.test/v.mp4' } },
        'GET https://cdn.luma.test/v.mp4': Buffer.from('luma-video'),
      }),
    );
    await provider.generateClip({ image: { publicUrl: 'https://cdn.example.com/front.jpg' }, prompt: 'p', outputPath });
    expect(bodyOf(requests).keyframes.frame0.url).toBe('https://cdn.example.com/front.jpg');
    expect(bodyOf(requests).model).toBe('ray-2');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('luma-video');
  });

  it('builds the MiniMax request + retrieves the file result', async () => {
    const outputPath = await tempOut();
    const requests: { url: string; opts: RequestInit }[] = [];
    process.env.MINIMAX_API_KEY = 'mm';
    process.env.MINIMAX_BASE_URL = 'https://api.minimax.test';
    process.env.MINIMAX_POLL_INTERVAL_MS = '0';
    const provider = createProvider(
      'minimax-i2v-direct',
      deps(requests, {
        'POST https://api.minimax.test/v1/video_generation': { task_id: 'mm-task' },
        'GET https://api.minimax.test/v1/query/video_generation?task_id=mm-task': { task_id: 'mm-task', status: 'success', file_id: 'file-1' },
        'GET https://api.minimax.test/v1/files/retrieve?file_id=file-1': { file: { download_url: 'https://cdn.minimax.test/v.mp4' } },
        'GET https://cdn.minimax.test/v.mp4': Buffer.from('mm-video'),
      }),
    );
    await provider.generateClip({ image: { publicUrl: 'https://cdn.example.com/front.jpg' }, prompt: 'p', outputPath });
    expect(bodyOf(requests)).toMatchObject({ model: 'video-01', first_frame_image: 'https://cdn.example.com/front.jpg' });
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('mm-video');
  });

  it('builds the LTX request and sends the requested (snapped) duration', async () => {
    const outputPath = await tempOut();
    const requests: { url: string; opts: RequestInit }[] = [];
    process.env.LTX_API_KEY = 'lt';
    process.env.LTX_BASE_URL = 'https://api.ltx.test';
    process.env.LTX_POLL_INTERVAL_MS = '0';
    const provider = createProvider(
      'ltx-2-3-fast',
      deps(requests, {
        'POST https://api.ltx.test/v2/image-to-video': { id: 'ltx-task' },
        'GET https://api.ltx.test/v2/image-to-video/ltx-task': { id: 'ltx-task', status: 'completed', result: { video_url: 'https://cdn.ltx.test/v.mp4' } },
        'GET https://cdn.ltx.test/v.mp4': Buffer.from('ltx-video'),
      }),
    );
    const result = await provider.generateClip({
      image: { publicUrl: 'https://cdn.example.com/front.jpg' },
      prompt: 'Slow push-in.',
      outputPath,
      durationSeconds: 10,
    });
    expect(result.provider).toBe('ltx-2-3-fast');
    expect(bodyOf(requests)).toMatchObject({
      image_uri: 'https://cdn.example.com/front.jpg',
      prompt: 'Slow push-in.',
      model: 'ltx-2-3-fast',
      duration: 10,
      resolution: '1920x1080',
      fps: 24,
      generate_audio: false,
    });
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('ltx-video');
  });
});
