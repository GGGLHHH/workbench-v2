// 本地 mock provider:ffmpeg zoompan 把输入图做成缓推 clip —— 免花钱、无网络地打通全链路。
// 端口自 xchangeai providers.js 的 MockVideoProvider;v2 输入是 base64,先落临时图再喂 ffmpeg。
// 需要 PATH 上有 ffmpeg(或 FFMPEG_PATH)。真 provider(Gemini/Veo 等)不依赖它。
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ClipInput, ClipResult, InputMode, ProviderDeps, VideoProvider } from './types';
import { normalizeClipDurationSeconds } from './constants';

const runFfmpeg = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const bin = process.env.FFMPEG_PATH || 'ffmpeg';
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += String(d);
    });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))));
  });

export class MockVideoProvider implements VideoProvider {
  readonly id = 'mock';
  readonly inputMode: InputMode = 'base64';

  // deps 只为签名一致(mock 不用 fetch/sleep)。
  constructor(_deps?: ProviderDeps) {
    void _deps;
  }

  async generateClip(input: ClipInput): Promise<ClipResult> {
    const { image, outputPath, durationSeconds } = input;
    await mkdir(path.dirname(outputPath), { recursive: true });
    const seconds = normalizeClipDurationSeconds(durationSeconds);
    const fps = 30;
    const frameCount = seconds * fps;

    const tmp = await mkdtemp(path.join(os.tmpdir(), 'clip-mock-'));
    const srcPath = path.join(tmp, `src.${(image.mimeType || 'image/jpeg').split('/')[1] || 'jpg'}`);
    try {
      await writeFile(srcPath, Buffer.from(image.base64 ?? '', 'base64'));
      await runFfmpeg([
        '-y',
        '-loop', '1',
        '-framerate', String(fps),
        '-i', srcPath,
        '-vf',
        [
          'scale=1920:1080:force_original_aspect_ratio=increase',
          'crop=1920:1080',
          `zoompan=z='1+0.045*on/${frameCount - 1}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=1920x1080:fps=${fps}`,
          'format=yuv420p',
        ].join(','),
        '-frames:v', String(frameCount),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-r', String(fps),
        '-movflags', '+faststart',
        outputPath,
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    return { provider: this.id, providerJobId: `mock-${seconds}s`, outputPath, duration: seconds };
  }
}
