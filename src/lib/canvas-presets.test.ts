import { describe, expect, it } from 'vitest';
import { aspectDims, isAspect, scaleToShort } from './canvas-presets';

describe('aspectDims：保留短边换比例，取偶数', () => {
  it('16:9 @1080 短边 → 1920x1080', () => expect(aspectDims(16, 9, 1080)).toEqual({ w: 1920, h: 1080 }));
  it('9:16 @1080 短边 → 1080x1920', () => expect(aspectDims(9, 16, 1080)).toEqual({ w: 1080, h: 1920 }));
  it('1:1 @1080 → 1080x1080', () => expect(aspectDims(1, 1, 1080)).toEqual({ w: 1080, h: 1080 }));
  it('4:5 @1080 短边 → 1080x1350', () => expect(aspectDims(4, 5, 1080)).toEqual({ w: 1080, h: 1350 }));
  it('宽高恒为偶数', () => {
    const { w, h } = aspectDims(16, 9, 721);
    expect(w % 2).toBe(0);
    expect(h % 2).toBe(0);
  });
});

describe('scaleToShort：保留比例缩放短边', () => {
  it('1920x1080 → 720p 短边 = 1280x720', () => expect(scaleToShort(1920, 1080, 720)).toEqual({ w: 1280, h: 720 }));
  it('竖屏 1080x1920 → 720p 短边 = 720x1280', () => expect(scaleToShort(1080, 1920, 720)).toEqual({ w: 720, h: 1280 }));
  it('1280x720 → 1080p = 1920x1080', () => expect(scaleToShort(1280, 720, 1080)).toEqual({ w: 1920, h: 1080 }));
});

describe('isAspect：当前尺寸命中比例', () => {
  it('1920x1080 命中 16:9,不命中 1:1', () => {
    expect(isAspect(1920, 1080, 16, 9)).toBe(true);
    expect(isAspect(1920, 1080, 1, 1)).toBe(false);
  });
});
