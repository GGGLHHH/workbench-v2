import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { probeVideo } from './probe';

const runFfmpeg = (args: string[]): Promise<boolean> =>
  new Promise((resolve) => {
    const p = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });

describe('probeVideo', () => {
  it('reads width/height/duration/fps/size from a real clip', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'clip-probe-'));
    const file = path.join(dir, 'test.mp4');
    try {
      const ok = await runFfmpeg([
        '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=30', '-pix_fmt', 'yuv420p', file,
      ]);
      if (!ok) {
        console.warn('[probe.test] ffmpeg unavailable — skipping real-file probe');
        return;
      }
      const r = await probeVideo(file);
      expect(r.width).toBe(320);
      expect(r.height).toBe(240);
      expect(r.durationSeconds).toBeGreaterThan(0.8);
      expect(r.durationSeconds).toBeLessThan(1.3);
      expect(r.fps).toBe(30);
      expect(r.sizeBytes).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('returns all-null for a missing file without throwing', async () => {
    expect(await probeVideo('/no/such/clip.mp4')).toEqual({
      width: null,
      height: null,
      fps: null,
      durationSeconds: null,
      sizeBytes: null,
    });
  });
});
