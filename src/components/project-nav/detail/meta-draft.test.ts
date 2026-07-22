import { describe, expect, it } from 'vitest'
import { draftToMeta, num } from './meta-draft'

describe('num', () => {
  it('空串 → null,否则 Number', () => {
    expect(num('  ')).toBeNull()
    expect(num('3')).toBe(3)
  })
})

describe('draftToMeta', () => {
  it('trim 文本、price 空串归 0、数字字段空串归 null、id 空串归 null', () => {
    const blank = {
      listingUrl: '', address: '  12 Main ', address2: '', city: '', state: '',
      postalCode: '', propertyType: '', price: '', videoStyle: '',
      bedrooms: '', bathrooms: '2', livingAreaSqft: '', agencyId: '', agentId: '', assigneeId: '',
    }
    const out = draftToMeta(blank)
    expect(out.address).toBe('12 Main')
    expect(out.price).toBe(0)
    expect(out.bedrooms).toBeNull()
    expect(out.bathrooms).toBe(2)
    expect(out.agencyId).toBeNull()
  })
})
