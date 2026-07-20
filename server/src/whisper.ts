import { createRequire } from 'node:module';
import path from 'node:path';
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
  type WhisperModel,
} from '@remotion/install-whisper-cpp';
import type { Caption } from '@gedatou/shared';

const WHISPER_VERSION = '1.5.5';

// 默认复用 Remotion-demo 已构建的 .whisper（binary + base 模型都在 → 免编译、免下 148MB，秒回）。
// 经 @gedatou/shared 的真实位置反推 Remotion-demo/apps/server/.whisper；
// WHISPER_DIR 可覆盖为本仓自持有目录（届时首次调用会编译 whisper.cpp + 下模型，耗时数分钟）。
const require = createRequire(import.meta.url);
const sharedSrc = path.dirname(require.resolve('@gedatou/shared')); // <Remotion-demo>/packages/shared/src
const DEFAULT_WHISPER_DIR = path.join(sharedSrc, '..', '..', '..', 'apps', 'server', '.whisper');
const WHISPER_DIR = process.env.WHISPER_DIR ?? DEFAULT_WHISPER_DIR;

// base 模型小、快；生产中文识别建议 WHISPER_MODEL=medium（多语种，效果更好）
const MODEL = (process.env.WHISPER_MODEL ?? 'base') as WhisperModel;

// 懒初始化：首次转录才校验/安装 whisper.cpp + 模型；失败清空以便重试
let ready: Promise<void> | null = null;
const ensureWhisper = (): Promise<void> => {
  if (!ready) {
    ready = (async () => {
      await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION });
      await downloadWhisperModel({ model: MODEL, folder: WHISPER_DIR });
    })();
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
};

/** 转录 16kHz 单声道 WAV，返回 @remotion/captions 结构的逐词字幕 */
export const transcribeAudio = async (wavPath: string): Promise<Caption[]> => {
  await ensureWhisper();
  const whisperCppOutput = await transcribe({
    inputPath: wavPath,
    whisperPath: WHISPER_DIR,
    whisperCppVersion: WHISPER_VERSION,
    model: MODEL,
    modelFolder: WHISPER_DIR,
    tokenLevelTimestamps: true,
    printOutput: false,
  });
  return toCaptions({ whisperCppOutput }).captions;
};
