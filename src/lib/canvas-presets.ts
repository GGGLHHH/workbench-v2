// 画布尺寸预设的纯计算(与 React 无关,便于单测)。
// 比例键:保留当前「短边」(= 分辨率档),换到目标比例。
// 分辨率键:保留当前比例,整体缩放到目标短边。宽高都取偶数(编码器要求)。

export const ASPECT_PRESETS: ReadonlyArray<readonly [string, number, number]> = [
  ['16:9', 16, 9],
  ['9:16', 9, 16],
  ['1:1', 1, 1],
  ['4:5', 4, 5],
];

export const RES_PRESETS: ReadonlyArray<readonly [string, number]> = [
  ['720p', 720],
  ['1080p', 1080],
];

export const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** 目标比例 aw:ah,保留短边 short,算出偶数宽高 */
export const aspectDims = (aw: number, ah: number, short: number): { w: number; h: number } =>
  aw >= ah
    ? { w: even(Math.round((short * aw) / ah)), h: even(short) }
    : { w: even(short), h: even(Math.round((short * ah) / aw)) };

/** 保留当前比例,把短边缩放到 short */
export const scaleToShort = (w: number, h: number, short: number): { w: number; h: number } => {
  const k = short / Math.min(w, h);
  return { w: even(w * k), h: even(h * k) };
};

/** 当前宽高是否匹配某比例(容差)*/
export const isAspect = (w: number, h: number, aw: number, ah: number): boolean =>
  Math.abs(w / h - aw / ah) < 0.02;
