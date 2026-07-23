import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, ProviderDeps } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
// 注入点:@google/genai SDK 被 mock;provider 内部 `await import('@google/genai')` 命中它。
const g = vi.hoisted(() => ({ veoRequest: null as any, omniRequest: null as any, omniMode: 'inline' as 'inline' | 'uri' }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateVideos: async (req: any) => {
        g.veoRequest = req;
        return { done: true, name: 'veo-op', response: { generatedVideos: [{ video: { uri: 'files/v' } }] } };
      },
    };
    operations = { getVideosOperation: async ({ operation }: any) => operation };
    files = {
      get: async () => ({ state: 'ACTIVE' }),
      download: async ({ downloadPath }: any) => {
        await writeFile(downloadPath, 'downloaded');
      },
    };
    interactions = {
      create: async (req: any) => {
        g.omniRequest = req;
        return g.omniMode === 'inline'
          ? { id: 'int-1', output_video: { data: Buffer.from('omni-inline').toString('base64') } }
          : { id: 'int-2', output_video: { uri: 'files/abc' } };
      },
    };
  },
}));

import { GeminiOmniProvider, VeoProvider } from './gemini';

const deps: ProviderDeps = { fetch: (() => {}) as unknown as FetchLike, sleep: () => Promise.resolve() };

let tmp: string;
const tempOut = async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'clip-gemini-'));
  return path.join(tmp, 'clip.mp4');
};
afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe('VeoProvider', () => {
  it('sends the hero image as first-frame when there are no reference angles', async () => {
    const outputPath = await tempOut();
    const provider = new VeoProvider({ id: 'veo-3.1', model: 'veo-3.1-generate-preview' }, deps);
    const result = await provider.generateClip({
      image: { base64: 'aGVybw==', mimeType: 'image/jpeg' },
      prompt: 'p',
      outputPath,
    });
    expect(g.veoRequest.image).toEqual({ imageBytes: 'aGVybw==', mimeType: 'image/jpeg' });
    expect(g.veoRequest.config).toBeUndefined();
    expect(result.provider).toBe('veo-3.1');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('downloaded');
  });

  it('sends hero + reference angles as reference images (hero first, capped at 3)', async () => {
    const outputPath = await tempOut();
    const provider = new VeoProvider({ id: 'veo-3.1', model: 'veo-3.1-generate-preview' }, deps);
    await provider.generateClip({
      image: { base64: 'hero', mimeType: 'image/jpeg' },
      referenceImages: [
        { base64: 'r2', mimeType: 'image/png' },
        { base64: 'r3', mimeType: 'image/png' },
        { base64: 'r4', mimeType: 'image/png' }, // dropped (max 3 incl hero)
      ],
      prompt: 'p',
      outputPath,
    });
    expect(g.veoRequest.image).toBeUndefined();
    const refs = g.veoRequest.config.referenceImages;
    expect(refs).toHaveLength(3);
    expect(refs[0]).toEqual({ image: { imageBytes: 'hero', mimeType: 'image/jpeg' }, referenceType: 'asset' });
    expect(refs[1].image.imageBytes).toBe('r2');
    expect(refs[2].image.imageBytes).toBe('r3');
  });
});

describe('GeminiOmniProvider', () => {
  it('writes an inline video payload directly', async () => {
    g.omniMode = 'inline';
    const outputPath = await tempOut();
    const provider = new GeminiOmniProvider('gemini-omni-flash-preview', deps);
    const result = await provider.generateClip({ image: { base64: 'img', mimeType: 'image/jpeg' }, prompt: 'p', outputPath });
    expect(result.providerJobId).toBe('int-1');
    expect(g.omniRequest.input[1]).toEqual({ type: 'text', text: 'p' });
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('omni-inline');
  });

  it('polls the file then downloads when the payload is a URI', async () => {
    g.omniMode = 'uri';
    const outputPath = await tempOut();
    const provider = new GeminiOmniProvider('gemini-omni-flash-preview', deps);
    const result = await provider.generateClip({ image: { base64: 'img', mimeType: 'image/jpeg' }, prompt: 'p', outputPath });
    expect(result.providerJobId).toBe('int-2');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('downloaded');
  });
});
