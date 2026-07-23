// provider 调优旋钮统一从 env 读(base URL / 路径模板 / 时长 / 轮询间隔 / 布尔开关)。
// 测试通过设 process.env 覆盖(含 *_POLL_INTERVAL_MS=0 消延迟),与 xchangeai 同接缝。

export const envStr = (name: string, fallback: string): string => process.env[name] || fallback;

export const envInt = (name: string, fallback: number): number => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export const envBool = (name: string, fallback: boolean): boolean => {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
};

/** 去掉末尾斜杠,拼接路径时不出现双斜杠。 */
export const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '');
