import { describe, expect, it } from 'vitest';
import { falKlingDescriptor, lumaDescriptor } from './descriptors';
import type { SubmitContext } from './http-provider';

const ctx = (endImage?: { publicUrl?: string; dataUri?: string }): SubmitContext => ({
  image: { publicUrl: 'https://x/a.jpg', dataUri: 'data:a' },
  referenceImages: [],
  endImage,
  prompt: 'p',
  aspectRatio: '16:9',
  durationSeconds: 5,
  model: 'kling/v2.1',
  durations: { adjustable: true, values: [5, 10], min: 5, max: 10 },
});

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('关键帧 descriptor(方案 A 首尾帧)', () => {
  it('Kling:有末帧 → tail_image_url;无末帧 → 不带该字段', () => {
    const withEnd = falKlingDescriptor('k').buildSubmit(ctx({ dataUri: 'data:b' })).body as any;
    expect(withEnd.tail_image_url).toBe('data:b');
    const without = falKlingDescriptor('k').buildSubmit(ctx()).body as any;
    expect('tail_image_url' in without).toBe(false);
  });

  it('Luma:有末帧 → keyframes.frame1;无末帧 → 只 frame0', () => {
    const withEnd = lumaDescriptor('l').buildSubmit(ctx({ publicUrl: 'https://x/b.jpg' })).body as any;
    expect(withEnd.keyframes.frame1.url).toBe('https://x/b.jpg');
    expect(withEnd.keyframes.frame0.url).toBe('https://x/a.jpg');
    const without = lumaDescriptor('l').buildSubmit(ctx()).body as any;
    expect(without.keyframes.frame1).toBeUndefined();
    expect(without.keyframes.frame0.url).toBe('https://x/a.jpg');
  });
});
