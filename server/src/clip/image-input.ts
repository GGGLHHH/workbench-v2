// 把一个绝对 imageUrl 按 provider 的 inputMode 解析成可直接喂给 provider 的形态。无 R2:
// - public-url:原样透传(BFF 已保证是公网可达 URL,如 xchangeai 的 download_url)
// - base64 / data-uri:取字节编码(Gemini/Veo/mock 用 base64;fal 用 dataUri)
import type { FetchLike, InputMode, ResolvedImage } from './types';

// base64/data-uri 类要由本服务去 fetch(imageUrl) 取字节 —— imageUrl 来自请求,是可控输入。
// 至少拦掉最危险的 SSRF 向量:非 http(s) scheme + link-local/云元数据地址(169.254.0.0/16、
// metadata.google.internal、IPv6 fe80::)。放行 loopback/私网:本地开发合法输入正来自
// http://localhost:3011/media/…(v2 自己的素材服务)。
// ponytail: 未做 DNS 解析 + 私网段全封 + 主机白名单;本服务暴露到本机之外前应升级为完整 SSRF 防护。
const BLOCKED_HOST = /^(169\.254\.|fe80:|\[fe80:)/i;
const assertSafeFetchUrl = (imageUrl: string): void => {
  let u: URL;
  try {
    u = new URL(imageUrl);
  } catch {
    throw new Error(`Invalid image URL: ${imageUrl}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Unsupported image URL scheme: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  if (host === 'metadata.google.internal' || host === '0.0.0.0' || BLOCKED_HOST.test(host)) {
    throw new Error(`Refusing to fetch image from a link-local / metadata address: ${host}`);
  }
};

export const resolveImageInput = async (
  imageUrl: string,
  inputMode: InputMode,
  fetchImpl: FetchLike,
): Promise<ResolvedImage> => {
  if (inputMode === 'public-url') return { publicUrl: imageUrl };

  assertSafeFetchUrl(imageUrl);
  const res = await fetchImpl(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch input image (${res.status}): ${imageUrl}`);
  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  if (inputMode === 'data-uri') return { base64, dataUri: `data:${mimeType};base64,${base64}`, mimeType };
  return { base64, mimeType };
};

export const resolveReferenceImages = (
  urls: string[],
  inputMode: InputMode,
  fetchImpl: FetchLike,
): Promise<ResolvedImage[]> => Promise.all(urls.map((u) => resolveImageInput(u, inputMode, fetchImpl)));
