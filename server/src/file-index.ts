import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';

// projectId 来自浏览器(经 transport),要当文件名 → 必须校验防路径穿越。xchangeai id 为 UUID 形态。
const VALID_ID = /^[A-Za-z0-9_-]+$/;
export const isValidProjectId = (id: string): boolean => VALID_ID.test(id);

// 每项目一个 JSON 数组、原子写(tmp+rename)、最新在前、按 idField 去重的本机索引读改写。
// render-index / clip-index 原各写一遍这套;删磁盘产物那步(路径/扩展名各异)留各自文件,用 read+write 拼。
export function createFileIndex<T>(subdir: string, idField: keyof T) {
  // 每次调用读 live config.dataDir(不在模块加载时算死),否则测试改 dataDir 无效、且与删产物用的 live config 不一致。
  const indexDir = (): string => path.join(config.dataDir, subdir);
  const fileFor = (projectId: string): string => {
    if (!isValidProjectId(projectId)) throw new Error(`bad projectId: ${projectId}`);
    return path.join(indexDir(), `${projectId}.json`);
  };

  /** 读回列表;文件不存在 / 解析失败一律回空。 */
  const read = async (projectId: string): Promise<T[]> => {
    try {
      const arr = JSON.parse(await readFile(fileFor(projectId), 'utf8'));
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  };

  const write = async (projectId: string, records: T[]): Promise<void> => {
    const file = fileFor(projectId);
    await mkdir(indexDir(), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(records, null, 2));
    await rename(tmp, file); // 同分区原子替换:并发读要么旧要么新,绝不半截
  };

  /** 追加一条(最新在前;按 idField 去重)。 */
  const append = async (projectId: string, rec: T): Promise<void> => {
    const records = await read(projectId);
    await write(projectId, [rec, ...records.filter((r) => r[idField] !== rec[idField])]);
  };

  return { read, write, append };
}
