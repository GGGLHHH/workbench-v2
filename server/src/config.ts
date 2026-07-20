import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3011);

/** 本地渲染服务器配置：无 S3/minio，素材与产物落盘 dataDir，对外走 <publicBaseUrl>/media。 */
export const config = {
  port,
  // 上传素材 + 渲染产物的落盘根目录（默认 workbench-v2/.data，已 gitignore）
  dataDir: process.env.DATA_DIR ?? path.join(here, '../../.data'),
  // 浏览器 + 服务端渲染进程访问素材/产物的绝对前缀（服务端渲染需绝对 URL）
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
};
