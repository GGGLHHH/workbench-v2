import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';

// project → 渲染产物 的本机关联索引(留历史)。只落本机 .data,不推远程 xchangeai。
// 形式:每项目一个 JSON 文件,内含记录数组(最新在前)。原子写(tmp + rename),并发读不会读到半截。
// 追加发生在渲染完成时(服务端,不依赖浏览器还开着)→ 抗刷新/关标签页。

export type RenderRecord = {
  taskId: string; // = 磁盘产物名 renders/<taskId>.<codec>
  url: string; // 带 ?filename= 的可下载 URL
  fileName: string; // 下载名(前端组装、已清洗)
  codec: 'mp4' | 'webm';
  createdAt: string; // ISO,服务端完成时刻
  width: number;
  height: number;
  durationInFrames: number;
  fps: number;
};

// projectId 来自浏览器(经 transport),要当文件名 → 必须校验防路径穿越。xchangeai id 为 UUID 形态。
const VALID_ID = /^[A-Za-z0-9_-]+$/;
export const isValidProjectId = (id: string): boolean => VALID_ID.test(id);

// 每次调用读 live config.dataDir(不在模块加载时算死),否则测试改 dataDir 无效、且与 removeRender
// 删产物用的 live config 不一致。
const indexDir = (): string => path.join(config.dataDir, 'renders-index');
const fileFor = (projectId: string): string => {
  if (!isValidProjectId(projectId)) throw new Error(`bad projectId: ${projectId}`);
  return path.join(indexDir(), `${projectId}.json`);
};

/** 读回列表;文件不存在 / 解析失败一律回空。 */
export const readIndex = async (projectId: string): Promise<RenderRecord[]> => {
  try {
    const arr = JSON.parse(await readFile(fileFor(projectId), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

const writeIndex = async (projectId: string, records: RenderRecord[]): Promise<void> => {
  const file = fileFor(projectId);
  await mkdir(indexDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(records, null, 2));
  await rename(tmp, file); // 同分区原子替换:并发读要么旧要么新,绝不半截
};

/** 追加一条(最新在前;taskId 去重)。渲染队列单 worker 串行,读-改-写无竞争。 */
export const appendRender = async (projectId: string, rec: RenderRecord): Promise<void> => {
  const records = await readIndex(projectId);
  await writeIndex(projectId, [rec, ...records.filter((r) => r.taskId !== rec.taskId)]);
};

/** 删一条并删磁盘产物。 */
export const removeRender = async (projectId: string, taskId: string): Promise<void> => {
  const records = await readIndex(projectId);
  const target = records.find((r) => r.taskId === taskId);
  await writeIndex(projectId, records.filter((r) => r.taskId !== taskId));
  if (target) await rm(path.join(config.dataDir, 'renders', `${taskId}.${target.codec}`), { force: true });
};
