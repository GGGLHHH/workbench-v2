import type { BffProjectDetail, BffProjectMetaRequest } from '@/generated/api-types'

export const num = (v: string) => (v.trim() === '' ? null : Number(v))

// 编辑表单草稿(全字符串,贴合 <input>)。状态提在 DetailContent:乐观保存会立刻关表单,
// 失败要原样重开 —— 草稿若留在 MetaForm 内部,一卸载就没了。detail↔draft↔meta 两个纯转换。
export type MetaDraft = {
  listingUrl: string
  address: string
  address2: string
  city: string
  state: string
  postalCode: string
  propertyType: string
  price: string
  videoStyle: string
  bedrooms: string
  bathrooms: string
  livingAreaSqft: string
  agencyId: string
  agentId: string
  assigneeId: string
}

export const detailToDraft = (d: BffProjectDetail): MetaDraft => ({
  listingUrl: d.listingUrl ?? '',
  address: d.address ?? '',
  address2: d.address2 ?? '',
  city: d.city ?? '',
  state: d.state ?? '',
  postalCode: d.postalCode ?? '',
  propertyType: d.propertyType ?? '',
  price: d.price?.toString() ?? '',
  videoStyle: d.videoStyle ?? '',
  bedrooms: d.bedrooms?.toString() ?? '',
  bathrooms: d.bathrooms?.toString() ?? '',
  livingAreaSqft: d.livingAreaSqft?.toString() ?? '',
  agencyId: d.agencyId ?? '',
  agentId: d.agentId ?? '',
  assigneeId: d.assigneeId ?? '',
})

export const draftToMeta = (v: MetaDraft): BffProjectMetaRequest => ({
  listingUrl: v.listingUrl.trim(),
  address: v.address.trim(),
  address2: v.address2.trim(),
  city: v.city.trim(),
  state: v.state.trim(),
  postalCode: v.postalCode.trim(),
  propertyType: v.propertyType.trim(),
  videoStyle: v.videoStyle.trim(),
  price: Number(v.price) || 0,
  bedrooms: num(v.bedrooms),
  bathrooms: num(v.bathrooms),
  livingAreaSqft: num(v.livingAreaSqft),
  agencyId: v.agencyId || null,
  agentId: v.agentId || null,
  assigneeId: v.assigneeId || null,
})
