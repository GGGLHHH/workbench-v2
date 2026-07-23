// 端口自 xchangeai-workbench/server/constants.js —— clip 时长边界(全局钳制)。
import type { Durations } from './types';

export const DEFAULT_CLIP_DURATION_SECONDS = 5;
export const MIN_CLIP_DURATION_SECONDS = 1;
export const MAX_CLIP_DURATION_SECONDS = 60;

/** 把值钳到 [MIN, MAX] 的整秒;非数返回默认 5。 */
export const normalizeClipDurationSeconds = (value: unknown): number => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CLIP_DURATION_SECONDS;
  return Math.min(MAX_CLIP_DURATION_SECONDS, Math.max(MIN_CLIP_DURATION_SECONDS, parsed));
};

/**
 * 把请求时长吸附到模型接受的值。生成前吸附(绝不生成后),否则记录的请求与成片时长不符,clip 永久显示 stale。
 * - 非数 → 默认 5
 * - adjustable:false(模型自选)→ 仅钳到 [MIN,MAX](该值不会真发给 provider)
 * - adjustable + 无离散值 → 钳到 [min,max] 取整
 * - adjustable + 有离散值 → 取最近的合法值
 */
export const snapDuration = (durations: Durations, seconds: unknown): number => {
  const requested = Number(seconds);
  if (!Number.isFinite(requested)) return DEFAULT_CLIP_DURATION_SECONDS;
  if (!durations.adjustable) return normalizeClipDurationSeconds(requested);
  if (!durations.values?.length) {
    return Math.min(
      durations.max ?? MAX_CLIP_DURATION_SECONDS,
      Math.max(durations.min ?? MIN_CLIP_DURATION_SECONDS, Math.round(requested)),
    );
  }
  return durations.values.reduce((best, value) =>
    Math.abs(value - requested) < Math.abs(best - requested) ? value : best,
  );
};
