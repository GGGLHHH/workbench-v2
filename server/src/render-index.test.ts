import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from './config';
import { appendRender, isValidProjectId, readIndex, removeRender, type RenderRecord } from './render-index';

// config 是可变对象:把落盘根目录指到临时目录,测完清掉。
let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'render-index-'));
  config.dataDir = tmp;
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const rec = (taskId: string): RenderRecord => ({
  taskId,
  url: `http://x/media/renders/${taskId}.mp4?filename=a.mp4`,
  fileName: 'a.mp4',
  codec: 'mp4',
  createdAt: '2026-07-22T00:00:00.000Z',
  width: 1920,
  height: 1080,
  durationInFrames: 90,
  fps: 30,
});

describe('projectId 校验(防路径穿越)', () => {
  it('接受 UUID 形态,拒绝穿越/斜杠', () => {
    expect(isValidProjectId('a1b2-c3d4_5')).toBe(true);
    expect(isValidProjectId('../../etc/passwd')).toBe(false);
    expect(isValidProjectId('a/b')).toBe(false);
  });
  it('非法 id 会让索引函数抛错,不落盘', async () => {
    await expect(appendRender('../evil', rec('t1'))).rejects.toThrow();
  });
});

describe('留历史:最新在前、taskId 去重、读回一致', () => {
  it('不存在的项目读回空', async () => {
    expect(await readIndex('proj-empty')).toEqual([]);
  });
  it('追加两条 → 最新在前', async () => {
    await appendRender('proj-a', rec('t1'));
    await appendRender('proj-a', rec('t2'));
    const list = await readIndex('proj-a');
    expect(list.map((r) => r.taskId)).toEqual(['t2', 't1']);
  });
  it('同 taskId 再追加 → 去重且置顶(不重复留两条)', async () => {
    await appendRender('proj-a', rec('t1'));
    const list = await readIndex('proj-a');
    expect(list.map((r) => r.taskId)).toEqual(['t1', 't2']);
  });
  it('删除一条 → 从列表消失', async () => {
    await removeRender('proj-a', 't2');
    expect((await readIndex('proj-a')).map((r) => r.taskId)).toEqual(['t1']);
  });
  it('项目间互不干扰(一项目一文件)', async () => {
    await appendRender('proj-b', rec('x1'));
    expect((await readIndex('proj-a')).map((r) => r.taskId)).toEqual(['t1']);
    expect((await readIndex('proj-b')).map((r) => r.taskId)).toEqual(['x1']);
  });
});
