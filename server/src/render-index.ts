import { rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { createFileIndex, isValidProjectId } from './file-index';

// project → 渲染产物 的本机关联索引(留历史)。只落本机 .data,不推远程 xchangeai。
// 形式:每项目一个 JSON 文件,内含记录数组(最新在前)。原子写(tmp + rename),并发读不会读到半截。
// 追加发生在渲染完成时(服务端,不依赖浏览器还开着)→ 抗刷新/关标签页。读改写走 file-index 通用实现。

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

// projectId 校验(防路径穿越)由 file-index 提供;renderer.ts / index.ts 仍从这里取,保持导入不变。
export { isValidProjectId };

const index = createFileIndex<RenderRecord>('renders-index', 'taskId');

/** 读回列表;文件不存在 / 解析失败一律回空。 */
export const readIndex = index.read;

/** 追加一条(最新在前;taskId 去重)。渲染队列单 worker 串行,读-改-写无竞争。 */
export const appendRender = index.append;

/** 删一条并删磁盘产物(codec 决定扩展名,故留在本文件)。 */
export const removeRender = async (projectId: string, taskId: string): Promise<void> => {
  const records = await index.read(projectId);
  const target = records.find((r) => r.taskId === taskId);
  await index.write(projectId, records.filter((r) => r.taskId !== taskId));
  if (target) await rm(path.join(config.dataDir, 'renders', `${taskId}.${target.codec}`), { force: true });
};
