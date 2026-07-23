// 下载后探测成片的媒体属性(mediabunny Node FilePathSource,无需 ffprobe 二进制;编辑器客户端也用它)。
// 探测失败不抛(clip 已生成成功)→ 拿到多少填多少,拿不到的为 null。补齐了服务层原来 duration 恒 null 的缺口。
import { stat } from 'node:fs/promises';
import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny';

export type ProbeResult = {
  width: number | null;
  height: number | null;
  fps: number | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
};

const EMPTY: ProbeResult = { width: null, height: null, fps: null, durationSeconds: null, sizeBytes: null };

export const probeVideo = async (filePath: string): Promise<ProbeResult> => {
  let sizeBytes: number | null = null;
  try {
    sizeBytes = (await stat(filePath)).size;
  } catch {
    return { ...EMPTY };
  }
  try {
    const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(filePath) });
    const durationSeconds = await input.computeDuration().catch(() => null);
    const track = await input.getPrimaryVideoTrack();
    if (!track) return { ...EMPTY, durationSeconds, sizeBytes };
    let fps: number | null = null;
    try {
      const stats = await track.computePacketStats();
      fps = stats.averagePacketRate ? Math.round(stats.averagePacketRate) : null;
    } catch {
      // fps 尽力而为
    }
    return { width: track.displayWidth, height: track.displayHeight, fps, durationSeconds, sizeBytes };
  } catch {
    return { ...EMPTY, sizeBytes };
  }
};
