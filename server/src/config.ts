import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// 端口来自根 .env 的 RENDER_PORT(单一真相源,见 .env.example)。用 RENDER_PORT 而非泛型 PORT,
// 免得和其它工具塞进环境的 PORT 撞车,导致 server 起在意料外的口、BFF 又转发到旧口。
const port = Number(process.env.RENDER_PORT ?? 3011);

/** 本地渲染服务器配置：无 S3/minio，素材与产物落盘 dataDir，对外走 <publicBaseUrl>/media。 */
export const config = {
  port,
  // 上传素材 + 渲染产物的落盘根目录（默认 workbench-v2/.data，已 gitignore）
  dataDir: process.env.DATA_DIR ?? path.join(here, '../../.data'),
  // 浏览器 + 服务端渲染进程访问素材/产物的绝对前缀（服务端渲染需绝对 URL）
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
};
