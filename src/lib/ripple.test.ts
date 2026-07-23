import { describe, expect, it } from 'vitest'
import type { EditorStarterItem } from '@gedatou/shared'
import { rippleAfterResize } from './ripple'

// 最小 item:ripple 只看 id/trackId/from/durationInFrames,其余字段与逻辑无关 → cast。
const mk = (id: string, trackId: string, from: number, dur: number) =>
  ({ id, trackId, from, durationInFrames: dur }) as unknown as EditorStarterItem

describe('rippleAfterResize', () => {
  // 同轨紧邻:A 0..150,B 150..300,C 300..450;D 在别的轨。
  const seed = {
    a: mk('a', 't1', 0, 150),
    b: mk('b', 't1', 150, 150),
    c: mk('c', 't1', 300, 150),
    d: mk('d', 't2', 150, 150),
  }

  it('变长(5s→10s,+150):后续同轨块顺移 +150,别的轨不动,替换块本身不动', () => {
    const out = rippleAfterResize({ ...seed, a: mk('a', 't1', 0, 300) }, 'a', 't1', 150, 150)
    expect(out.b.from).toBe(300) // 仍紧贴新块末尾(0+300)
    expect(out.c.from).toBe(450)
    expect(out.d.from).toBe(150) // 别的轨保持
    expect(out.a.from).toBe(0)
  })

  it('变短(5s→3s,-60):后续块顺移 -60,不留空白且不重叠', () => {
    const out = rippleAfterResize({ ...seed, a: mk('a', 't1', 0, 90) }, 'a', 't1', 150, -60)
    expect(out.b.from).toBe(90) // = 新块末尾(0+90),flush
    expect(out.c.from).toBe(240)
  })

  it('保留间隔:原块与后块之间有空隙时,空隙原样随之平移', () => {
    const gap = { a: mk('a', 't1', 0, 150), b: mk('b', 't1', 200, 150) } // A..150,间隔 50,B@200
    const out = rippleAfterResize({ ...gap, a: mk('a', 't1', 0, 300) }, 'a', 't1', 150, 150)
    expect(out.b.from).toBe(350) // 200+150,新块末尾 300 → 间隔 50 保留
  })

  it('delta=0:原样返回同一引用(无变化)', () => {
    expect(rippleAfterResize(seed, 'a', 't1', 150, 0)).toBe(seed)
  })
})
