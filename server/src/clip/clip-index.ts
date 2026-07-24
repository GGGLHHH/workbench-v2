// project → 生成 clip(take)的本机绑定索引(A 方案)。复用 render-index 的形态:每项目一个 JSON、
// 原子写(tmp+rename)、最新在前、按 clipId 去重。「单图多视频」= 按 sourceImageRef 过滤。
// 追加发生在生成完成时(服务端,不依赖浏览器)→ 抗刷新。发布前 clip 文件与索引都在本机 .data。
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { isValidProjectId } from '../render-index';

/** 一个生成的 take。媒体属性(width/height/fps/duration/sizeBytes)由下载后 mediabunny 探测得到。 */
export type ClipRecord = {
  clipId: string; // = 磁盘产物名 clips/<clipId>.mp4,也 = 生成任务 taskId
  projectId: string;
  sourceImageRef: string; // 主源图(单图/批量 B = 该图;序列 A = 首图)。归属挂内容 ref,不挂组。
  /** 归属的全部源图内容 ref(序列 A = 全组成员快照;单图/批量 B = [自身])。生成时定格,
   *  组之后拆散/删成员都不影响——列表按"命中任一 ref"显示。缺省(旧记录)视为 [sourceImageRef]。 */
  sourceImageRefs?: string[];
  referenceImageRefs?: string[]; // 用到的同房间参考角度(Veo/Seedance)
  url: string; // /media/clips/<clipId>.mp4 绝对地址
  provider: string;
  model: string;
  providerJobId: string;
  aspectRatio: string;
  requestedDurationSeconds: number | null; // 请求时长;与实际 duration 一比 → stale/REGEN 信号
  durationSeconds: number | null; // 探测出的实际时长
  width: number | null;
  height: number | null;
  fps: number | null;
  sizeBytes: number | null;
  compiledPrompt: string; // 实际发给 provider 的成品串(溯源)
  promptBody?: string;
  cameraMove?: string;
  focusSubject?: string;
  lightTransition?: string;
  createdAt: string; // ISO
};

const indexDir = (): string => path.join(config.dataDir, 'clips-index');
const fileFor = (projectId: string): string => {
  if (!isValidProjectId(projectId)) throw new Error(`bad projectId: ${projectId}`);
  return path.join(indexDir(), `${projectId}.json`);
};

/** 读回列表;文件不存在 / 解析失败一律回空。 */
export const readClipIndex = async (projectId: string): Promise<ClipRecord[]> => {
  try {
    const arr = JSON.parse(await readFile(fileFor(projectId), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

const writeClipIndex = async (projectId: string, records: ClipRecord[]): Promise<void> => {
  const file = fileFor(projectId);
  await mkdir(indexDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(records, null, 2));
  await rename(tmp, file); // 同分区原子替换:并发读要么旧要么新,绝不半截
};

/** 追加一条(最新在前;clipId 去重)。appendClip 之间由生成队列单 worker 串行。
 *  ponytail: 与走 HTTP DELETE 路径的 removeClip 不共享锁 → 同项目「生成完成」与「删除」在几毫秒
 *  文件 IO 窗口内交错可致索引丢/复活一条(仅索引不一致,无崩溃;继承 render-index 同款结构)。
 *  要严格一致再上 per-project 互斥锁(append+remove 共用)。 */
export const appendClip = async (projectId: string, rec: ClipRecord): Promise<void> => {
  const records = await readClipIndex(projectId);
  await writeClipIndex(projectId, [rec, ...records.filter((r) => r.clipId !== rec.clipId)]);
};

/** 列某项目的 take,可选按源图过滤。命中 = 主 ref 相等,或 sourceImageRefs 里含该 ref
 *  (序列 clip 会出现在其每个源图名下)。 */
export const listClips = async (projectId: string, sourceImageRef?: string): Promise<ClipRecord[]> => {
  const records = await readClipIndex(projectId);
  if (!sourceImageRef) return records;
  return records.filter((r) => r.sourceImageRef === sourceImageRef || r.sourceImageRefs?.includes(sourceImageRef));
};

/** 删一条 take:去索引 + 删磁盘 clip 文件。返回是否删到。 */
export const removeClip = async (projectId: string, clipId: string): Promise<boolean> => {
  // clipId 进文件路径 → 防路径穿越(记录匹配本已挡住,这里再格式化兜底)。newId 只含这些字符。
  if (!/^[A-Za-z0-9_-]+$/.test(clipId)) return false;
  const records = await readClipIndex(projectId);
  const target = records.find((r) => r.clipId === clipId);
  if (!target) return false;
  await writeClipIndex(projectId, records.filter((r) => r.clipId !== clipId));
  await rm(path.join(config.dataDir, 'clips', `${clipId}.mp4`), { force: true });
  return true;
};
