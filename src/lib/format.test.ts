import { describe, expect, it } from 'vitest'
import { absTime, relTime, statusLabel, usd } from './format'

describe('statusLabel', () => {
  it('下划线换空格', () => {
    expect(statusLabel('ready_for_review')).toBe('ready for review')
  })
})

describe('usd', () => {
  it('整数美元、无小数', () => {
    expect(usd(1250000)).toBe('$1,250,000')
  })
  it('非数字返回 null', () => {
    expect(usd(null)).toBeNull()
    expect(usd(undefined)).toBeNull()
  })
})

describe('absTime', () => {
  it('格式化为 yyyy-MM-dd HH:mm', () => {
    expect(absTime('2026-07-20T19:30:00Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
  it('无法解析时原样返回', () => {
    expect(absTime('not-a-date')).toBe('not-a-date')
  })
})

describe('relTime', () => {
  it('无法解析时原样返回', () => {
    expect(relTime('not-a-date')).toBe('not-a-date')
  })
})
