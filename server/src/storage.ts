import { createWriteStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { config } from './config';

// 本地盘替代 S3：key 形如 `assets/xxx` / `renders/xxx`，落盘 dataDir/<key>，
// 对外 <publicBaseUrl>/media/<key>。这样删除端点从 publicUrl 反推的 key 与落盘 key 一致。

/** 拒绝路径穿越，返回 dataDir 下的绝对路径 */
export const resolveKeyPath = (key: string): string => {
  const full = path.join(config.dataDir, key);
  if (full !== config.dataDir && !full.startsWith(config.dataDir + path.sep)) {
    throw new Error(`bad key: ${key}`);
  }
  return full;
};

/** 前缀白名单：只允许上传素材前缀，防越权写/删 */
export const isSafeKey = (key: string): boolean =>
  (key.startsWith('assets/') || key.startsWith('renders/')) && !key.includes('..');

export const createUploadUrl = (key: string) => ({
  uploadUrl: `${config.publicBaseUrl}/api/blob/${key}`,
  publicUrl: `${config.publicBaseUrl}/media/${key}`,
});

export const writeStream = async (key: string, body: Readable): Promise<void> => {
  const full = resolveKeyPath(key);
  await mkdir(path.dirname(full), { recursive: true });
  await pipeline(body, createWriteStream(full));
};

/** 写产物，返回可访问 URL */
export const writeBuffer = async (key: string, buf: Buffer): Promise<string> => {
  const full = resolveKeyPath(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf);
  return `${config.publicBaseUrl}/media/${key}`;
};

export const deleteObject = async (key: string): Promise<void> => {
  await rm(resolveKeyPath(key), { force: true });
};
