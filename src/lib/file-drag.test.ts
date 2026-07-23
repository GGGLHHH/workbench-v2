import { describe, expect, it } from 'vitest'
import { dragValidity, isFileDrag } from './file-drag'

// 造最小 dataTransfer(只关心 types/items)
const dt = (types: string[], items: { kind: string; type: string }[]) =>
  ({ dataTransfer: { types, items } }) as unknown as { dataTransfer: DataTransfer | null }
const isImage = (m: string) => m.startsWith('image/')

describe('isFileDrag', () => {
  it('types 含 Files 才算文件拖拽', () => {
    expect(isFileDrag(dt(['Files'], []))).toBe(true)
    expect(isFileDrag(dt(['text/plain'], []))).toBe(false)
    expect(isFileDrag({ dataTransfer: null })).toBe(false)
  })
})

describe('dragValidity', () => {
  it('图片 + 只收图片 → valid', () => {
    expect(dragValidity(dt(['Files'], [{ kind: 'file', type: 'image/png' }]), isImage)).toBe('valid')
  })
  it('非图片 + 只收图片 → invalid', () => {
    expect(dragValidity(dt(['Files'], [{ kind: 'file', type: 'application/pdf' }]), isImage)).toBe('invalid')
  })
  it('混合(含图片)→ valid(有命中即可)', () => {
    const items = [
      { kind: 'file', type: 'image/png' },
      { kind: 'file', type: 'application/pdf' },
    ]
    expect(dragValidity(dt(['Files'], items), isImage)).toBe('valid')
  })
  it('类型未知(拖拽时不给 type)→ valid(宽松,drop 再过滤)', () => {
    expect(dragValidity(dt(['Files'], [{ kind: 'file', type: '' }]), isImage)).toBe('valid')
  })
  it('无 accept 限制 → 任意文件 valid', () => {
    expect(dragValidity(dt(['Files'], [{ kind: 'file', type: 'application/pdf' }]))).toBe('valid')
  })
})
