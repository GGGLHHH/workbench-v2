import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { appendClip, listClips, readClipIndex, removeClip, type ClipRecord } from './clip-index';

let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'clip-index-'));
  config.dataDir = tmp;
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(path.join(tmp, 'clips-index'), { recursive: true, force: true });
});

const rec = (over: Partial<ClipRecord>): ClipRecord => ({
  clipId: 'c1',
  projectId: 'p1',
  sourceImageRef: 'img-a',
  url: 'http://x/media/clips/c1.mp4',
  provider: 'ltx-2-3-fast',
  model: 'ltx-2-3-fast',
  providerJobId: 'job-1',
  aspectRatio: '16:9',
  requestedDurationSeconds: 6,
  durationSeconds: 6,
  width: 1920,
  height: 1080,
  fps: 24,
  sizeBytes: 1234,
  compiledPrompt: 'guardrail... push in.',
  createdAt: '2026-07-23T00:00:00.000Z',
  ...over,
});

describe('clip index', () => {
  it('appends newest-first and dedupes by clipId', async () => {
    await appendClip('p1', rec({ clipId: 'c1' }));
    await appendClip('p1', rec({ clipId: 'c2' }));
    await appendClip('p1', rec({ clipId: 'c1', provider: 'veo-3.1' })); // re-append c1 → moves to front, replaces
    const all = await readClipIndex('p1');
    expect(all.map((r) => r.clipId)).toEqual(['c1', 'c2']);
    expect(all[0].provider).toBe('veo-3.1');
  });

  it('lists multiple videos per source image (the one-image-many-clips query)', async () => {
    await appendClip('p1', rec({ clipId: 'a1', sourceImageRef: 'img-a' }));
    await appendClip('p1', rec({ clipId: 'a2', sourceImageRef: 'img-a' }));
    await appendClip('p1', rec({ clipId: 'b1', sourceImageRef: 'img-b' }));
    const forA = await listClips('p1', 'img-a');
    expect(forA.map((r) => r.clipId).sort()).toEqual(['a1', 'a2']);
    expect((await listClips('p1')).length).toBe(3); // no filter = all
    expect(await listClips('p1', 'nope')).toEqual([]);
  });

  it('序列 clip 挂全组成员 → 在每个成员名下都出现(sourceImageRefs 命中)', async () => {
    await appendClip('p1', rec({ clipId: 'seq', sourceImageRef: 'img-a', sourceImageRefs: ['img-a', 'img-b', 'img-c'] }));
    await appendClip('p1', rec({ clipId: 'solo', sourceImageRef: 'img-b' })); // 单图/旧记录:无 sourceImageRefs
    expect((await listClips('p1', 'img-a')).map((r) => r.clipId)).toEqual(['seq']);
    expect((await listClips('p1', 'img-b')).map((r) => r.clipId).sort()).toEqual(['seq', 'solo']);
    expect((await listClips('p1', 'img-c')).map((r) => r.clipId)).toEqual(['seq']); // 拆散/删了首图也还能从别的成员看到
    expect(await listClips('p1', 'img-z')).toEqual([]);
  });

  it('removeClip drops the record and deletes the clip file', async () => {
    await mkdir(path.join(tmp, 'clips'), { recursive: true });
    const clipFile = path.join(tmp, 'clips', 'c9.mp4');
    await writeFile(clipFile, 'video');
    await appendClip('p1', rec({ clipId: 'c9' }));

    expect(await removeClip('p1', 'c9')).toBe(true);
    expect(await readClipIndex('p1')).toEqual([]);
    expect(existsSync(clipFile)).toBe(false);
    expect(await removeClip('p1', 'missing')).toBe(false);
  });

  it('isolates indexes per project', async () => {
    await appendClip('p1', rec({ clipId: 'x' }));
    expect(await readClipIndex('p2')).toEqual([]);
  });

  it('refuses a path-traversal clipId on delete', async () => {
    expect(await removeClip('p1', '../../etc/passwd')).toBe(false);
    expect(await removeClip('p1', 'a/b')).toBe(false);
  });
});
