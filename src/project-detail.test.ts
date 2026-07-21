import { describe, expect, it } from 'vitest'

import { mediaKind } from '../bff/src/media'
import { addTag } from './components/asset-viewer'
import { fileSize } from './lib/utils'

// 只覆盖「有分支、且已经真的错过一次」的纯逻辑 —— 不是为覆盖率凑数。
// 三处都对应本轮修掉的真实 bug,回归了会直接红。

describe('mediaKind', () => {
  // 这条正是那个 bug:非图非视频被判成 image,附件渲染成 <img> 得到一个碎图
  it('把非媒体 mime 判成 file 而不是 image', () => {
    expect(mediaKind('text/plain')).toBe('file')
    expect(mediaKind('application/pdf')).toBe('file')
    expect(mediaKind('application/zip')).toBe('file')
  })

  it('按 mime 前缀分辨图片与视频', () => {
    expect(mediaKind('image/png')).toBe('image')
    expect(mediaKind('image/webp')).toBe('image')
    expect(mediaKind('video/mp4')).toBe('video')
    expect(mediaKind('video/quicktime')).toBe('video')
  })

  // 上游 mime_type 是可选字段,缺失时不能崩也不能猜成图片
  it('mime 缺失时退到 file', () => {
    expect(mediaKind(null)).toBe('file')
    expect(mediaKind(undefined)).toBe('file')
    expect(mediaKind('')).toBe('file')
  })
})

describe('addTag', () => {
  it('trim + 折叠连续空白 + 截断到 40 字符', () => {
    expect(addTag([], '  kitchen  ')).toEqual(['kitchen'])
    expect(addTag([], 'living    room')).toEqual(['living room'])
    expect(addTag([], 'x'.repeat(50))).toEqual(['x'.repeat(40)])
  })

  it('忽略空输入', () => {
    expect(addTag(['a'], '')).toEqual(['a'])
    expect(addTag(['a'], '   ')).toEqual(['a'])
  })

  it('去重时忽略大小写', () => {
    expect(addTag(['kitchen'], 'Kitchen')).toEqual(['kitchen'])
    expect(addTag(['kitchen'], 'KITCHEN')).toEqual(['kitchen'])
  })

  it('到上限后不再追加', () => {
    const full = ['a', 'b', 'c', 'd', 'e']
    expect(addTag(full, 'f')).toEqual(full)
  })

  // 返回原数组(而非新数组)是调用方判断「有没有变」的依据:commit 里靠 next !== tags 决定要不要发请求
  it('没变化时返回同一个数组引用', () => {
    const tags = ['kitchen']
    expect(addTag(tags, 'Kitchen')).toBe(tags)
    expect(addTag(tags, '  ')).toBe(tags)
  })
})

describe('fileSize', () => {
  it('按 1024 进位', () => {
    expect(fileSize(512)).toBe('512 B')
    expect(fileSize(2048)).toBe('2.0 KB')
    expect(fileSize(10 * 1024 * 1024)).toBe('10 MB')
  })

  // ≥10 或 B 单位取整,否则留一位小数 —— 免得列表里出现 "9.999999 MB"
  it('小于 10 留一位小数,大于等于 10 取整', () => {
    expect(fileSize(1536)).toBe('1.5 KB')
    expect(fileSize(15 * 1024)).toBe('15 KB')
    expect(fileSize(0)).toBe('0 B')
  })
})
