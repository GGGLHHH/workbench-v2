import { describe, expect, it } from 'vitest';
import type { FetchLike } from './types';
import { resolveImageInput } from './image-input';

const fetchReturning = (body: Buffer, contentType: string): FetchLike =>
  (async () => new Response(body, { status: 200, headers: { 'content-type': contentType } })) as unknown as FetchLike;

const throwingFetch: FetchLike = (async () => {
  throw new Error('should not fetch');
}) as unknown as FetchLike;

describe('resolveImageInput', () => {
  it('passes public-url through without fetching', async () => {
    const out = await resolveImageInput('https://cdn.test/a.jpg', 'public-url', throwingFetch);
    expect(out).toEqual({ publicUrl: 'https://cdn.test/a.jpg' });
  });

  it('fetches + base64-encodes for base64 mode', async () => {
    const out = await resolveImageInput('https://cdn.test/a.png', 'base64', fetchReturning(Buffer.from('PNGBYTES'), 'image/png'));
    expect(out).toEqual({ base64: Buffer.from('PNGBYTES').toString('base64'), mimeType: 'image/png' });
  });

  it('wraps a data URI for data-uri mode', async () => {
    const b64 = Buffer.from('JPGBYTES').toString('base64');
    const out = await resolveImageInput('https://cdn.test/a.jpg', 'data-uri', fetchReturning(Buffer.from('JPGBYTES'), 'image/jpeg; charset=binary'));
    expect(out).toEqual({ base64: b64, dataUri: `data:image/jpeg;base64,${b64}`, mimeType: 'image/jpeg' });
  });

  it('throws on a non-ok image fetch', async () => {
    const bad: FetchLike = (async () => new Response('nope', { status: 404 })) as unknown as FetchLike;
    await expect(resolveImageInput('https://cdn.test/x', 'base64', bad)).rejects.toThrow('Failed to fetch input image (404)');
  });

  it('refuses to fetch link-local / cloud-metadata addresses (SSRF guard, before any fetch)', async () => {
    await expect(resolveImageInput('http://169.254.169.254/latest/meta-data/', 'base64', throwingFetch)).rejects.toThrow(
      'link-local / metadata',
    );
    await expect(resolveImageInput('http://metadata.google.internal/x', 'base64', throwingFetch)).rejects.toThrow(
      'link-local / metadata',
    );
  });

  it('refuses non-http(s) schemes', async () => {
    await expect(resolveImageInput('file:///etc/passwd', 'base64', throwingFetch)).rejects.toThrow('Unsupported image URL scheme');
  });
});
