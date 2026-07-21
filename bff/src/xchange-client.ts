import ky from 'ky';
import type { Options as KyOptions } from 'ky';
import { config } from './config';

// bff/src/generated/* 的 httpClient 模块(node 侧):generated client 从这里 import
// { requestJson, requestVoid } + 类型 ApiRequestOptions,用它调 xchangeai(:8080)。
// 鉴权按用户:handler 通过 requestOptions.headers.cookie 把调用者的会话透传进来
// (见 forwardAuth),本模块只负责发请求;无 service-account、无 token 缓存。

const base = `${config.xchangeUpstream}/api/v1`;

export type ApiRequestOptions = KyOptions & { contentType?: string };

const api = ky.create({ prefix: base, timeout: 300_000, retry: { limit: 0 } });

export async function requestJson<T>(path: string, options: ApiRequestOptions): Promise<T> {
  return (await api(path, options)).json<T>();
}

export async function requestVoid(path: string, options: ApiRequestOptions): Promise<void> {
  await api(path, options);
}

/** 把 Fastify 请求里的会话 cookie 透传成 generated client 的 requestOptions(第二参)。 */
export function forwardAuth(req: { headers: { cookie?: string } }): { headers: Record<string, string> } {
  return { headers: req.headers.cookie ? { cookie: req.headers.cookie } : {} };
}

// 发布素材用:把字节 PUT 到 createUpload 返回的 upload_url(相对 xchangeai 根解析,透传会话 cookie)。
// 独立的长超时 raw PUT —— 视频可达几十 MB;upload_url 是服务端下发的地址,不落在 generated
// client 的固定 operation 覆盖里,故不走 requestJson/Void,直接 new URL 解析后 PUT。
const uploadApi = ky.create({ timeout: 600_000, retry: { limit: 0 } });

export async function putBytes(
  uploadUrl: string,
  body: Uint8Array,
  contentType: string,
  auth: { headers: Record<string, string> },
): Promise<void> {
  const url = new URL(uploadUrl, `${config.xchangeUpstream}/`).toString();
  await uploadApi.put(url, { body, headers: { 'content-type': contentType, ...auth.headers } });
}

/**
 * 登录:原始 POST /auth/login(无需既有会话),返回 xchangeai 下发的 Set-Cookie 串数组。
 * 调用方负责把它回传浏览器(建立会话)并用其中的 access_token 立即取用户。
 */
export async function loginRaw(identifier: string, password: string): Promise<string[]> {
  const res = await ky.post(`${base}/auth/login`, {
    json: { identifier, password },
    timeout: 30_000,
  });
  return (
    res.headers.getSetCookie?.() ??
    (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])
  );
}

/**
 * 刷新会话:原始 POST /auth/refresh,转发浏览器会话 cookie(内含 refresh_token),
 * 返回 xchangeai 下发的新 Set-Cookie(access_token 轮换,可能一并轮换 refresh_token)。
 * 无 / 失效的 refresh_token → xchangeai 401(ky 抛 HTTPError → BFF setErrorHandler 透传 401)。
 */
export async function refreshRaw(cookie: string | undefined): Promise<string[]> {
  const res = await ky.post(`${base}/auth/refresh`, {
    headers: cookie ? { cookie } : {},
    timeout: 30_000,
  });
  return (
    res.headers.getSetCookie?.() ??
    (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])
  );
}
