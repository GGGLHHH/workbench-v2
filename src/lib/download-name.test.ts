import { describe, expect, it } from 'vitest'
import { buildDownloadName, sanitizeBaseName } from './download-name'

// 固定时刻,避开 Date.now() 让断言可重复(本地时区)
const AT = new Date(2026, 6, 20, 19, 30, 5) // 2026-07-20 19:30:05

describe('buildDownloadName', () => {
  it('拼成 `地址 + 时间.扩展名`,时间为 YYYY-MM-DD HH:mm:ss(补零)', () => {
    expect(buildDownloadName('mp4', '1 Reject St', AT)).toBe('1 Reject St 2026-07-20 19:30:05.mp4')
  })

  it('无 baseName 时只留时间戳', () => {
    expect(buildDownloadName('webm', undefined, AT)).toBe('2026-07-20 19:30:05.webm')
  })

  it('baseName 清洗后为空也不留下多余空格', () => {
    expect(buildDownloadName('mp4', '///', AT)).toBe('2026-07-20 19:30:05.mp4')
  })
})

describe('sanitizeBaseName', () => {
  it('剥掉文件系统非法字符,但保留中文与连字符', () => {
    expect(sanitizeBaseName('武汉/光谷:大厦*A-1')).toBe('武汉 光谷 大厦 A-1')
  })

  it('压缩空白并去首尾', () => {
    expect(sanitizeBaseName('  a   b  ')).toBe('a b')
  })

  it('限长 120 防超头', () => {
    expect(sanitizeBaseName('x'.repeat(200))).toHaveLength(120)
  })
})
