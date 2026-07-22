import type { CoverItem, EditorStarterItem, LowerThirdItem, OverlayScale, UndoableState } from '@gedatou/shared'
import { LOWER_THIRD_DESIGN, LT_REF_ASPECT, OVERLAY_SCALE_FACTORS, createCoverItem, createLowerThirdItem, createTrack } from '@gedatou/shared'

// 方案:每个叠加 = 时间线上「一个块」。
//  - 横幅 / 封面:用库的专用 item 类型(lowerThird / cover),几何与多元素渲染在库渲染器(单一真相)。
//  - 水印:复用内置 image item(角落定位 + 不透明度),logo 走平台上传(/bff/uploads → /bff/content/<id>)入库。
// item 即真相:开关/位置/配色/logo 从这些保留 id 的 item 反推(readOverlayConfig)。纯 (state)->state,
// 不碰 editorStore(便于 node 单测);派发进单例 + logo 上传的薄封装在 video-overlays-store.ts。

const OVERLAY_TRACK = '__overlays' // 置顶轨(index 0 = 渲染在最前)
const LT_ID = '__lowerthird'
const CV_ID = '__cover'
const EC_ID = '__endcover'
const WM_ID = '__watermark'
const MANAGED = new Set([LT_ID, CV_ID, EC_ID, WM_ID])
// 片头封面开关时,除这些外的块整体让位:片头封面钉在 [0,D)、水印钉在 [0,总长) —— 都不随内容平移。
const SHIFT_PINNED = new Set([CV_ID, WM_ID])

const COVER_SECONDS = 3

export type BannerPosition = LowerThirdItem['position'] // 'top' | 'middle' | 'bottom'
export type { OverlayScale }
export type BannerConfig = { on: boolean; position: BannerPosition; scale: OverlayScale; bgColor: string; textColor: string; opacity: number }

export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type WatermarkLogo = { contentId: string; url: string; width: number; height: number }
export type WatermarkConfig = { on: boolean; position: WatermarkPosition; opacity: number; logoUrl: string | null }

export type OverlayConfig = { banner: BannerConfig; cover: boolean; endCover: boolean; coverScale: OverlayScale; watermark: WatermarkConfig }

export type ListingMeta = {
  name?: string | null
  price?: number | null
  bedrooms?: number | null
  bathrooms?: number | null
  livingAreaSqft?: number | null
  address?: string | null
  address2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
}

const DEFAULT_BANNER: BannerConfig = { on: false, position: 'bottom', scale: 'medium', bgColor: '#000000', textColor: '#ffffff', opacity: 0.44 }
const DEFAULT_WATERMARK: WatermarkConfig = { on: false, position: 'bottom-right', opacity: 0.7, logoUrl: null }

const WM_TARGET_W = 0.14 // 水印宽 = 帧宽分数
const WM_MARGIN = 0.04 // 角落留白 = 帧宽分数

// ---- 文案烘焙 ----

const usd = (n?: number | null): string =>
  typeof n === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n) : ''

function addressLine(m: ListingMeta): string {
  return [m.address, [m.city, m.state].filter(Boolean).join(', ')].filter(Boolean).join(', ')
}

export function detailsLine(m: ListingMeta): string {
  return [m.bedrooms ? `${m.bedrooms} bd` : null, m.bathrooms ? `${m.bathrooms} ba` : null, m.livingAreaSqft ? `${m.livingAreaSqft.toLocaleString()} sqft` : null]
    .filter(Boolean)
    .join(' · ')
}

function coverTitle(m: ListingMeta): string {
  return m.name?.trim() || (m.address ? m.address.split(',')[0] : '') || 'Listing Tour'
}

// ---- 几何 ----

const r = Math.round
type Comp = { w: number; h: number }

// 卡片盒:宽度贴合内容(数字行 price/明细,取最宽),几何全部跟帧高(见 LT_REF_ASPECT)→ 任意画幅正确、
// 不留空;高随 scale 及地址行数长高。渲染器填满此盒;地址在盒内最多折两行。
// ponytail: 字宽用保守粗估(mono 明细 0.6em 准;sans 价格/地址略宽)——升级点=真实 canvas measureText。
function bannerBox(comp: Comp, position: BannerPosition, scale: OverlayScale, text: { address: string; price: string; details: string }) {
  const d = LOWER_THIRD_DESIGN
  const f = OVERLAY_SCALE_FACTORS[scale]
  const H = comp.h
  const addrFS = d.addressSize * H * f
  const priceFS = d.priceSize * H * f
  const detFS = d.detailsSize * H * f
  const padX = d.paddingX * LT_REF_ASPECT * H
  const accent = d.accentWidth * LT_REF_ASPECT * H
  const marginX = d.marginX * LT_REF_ASPECT * H
  const chrome = accent + 2 * padX
  // 卡宽贴合「数字行」(price/明细,长度有界),地址若更长则在卡内折行(见下)
  const contentW = Math.max(text.price.length * priceFS * 0.6, text.details.length * detFS * 0.6)
  const minW = d.height * H // 下限,避免过窄
  const maxW = comp.w - 2 * marginX // 不超画面(左右留边距)
  const width = Math.min(Math.max(minW, contentW + chrome), Math.max(minW, maxW))
  const innerW = width - chrome
  const charsPerLine = Math.max(1, Math.floor(innerW / (addrFS * 0.55)))
  const addrLines = Math.min(2, Math.max(1, Math.ceil(text.address.length / charsPerLine)))
  const height = d.height * H * f + (addrLines - 1) * addrFS * 1.3
  const top = position === 'top' ? d.marginY * H : position === 'middle' ? (H - height) / 2 : H - height - d.marginY * H
  return { left: r(marginX), top: r(top), width: r(width), height: r(height) }
}

function watermarkBox(comp: Comp, position: WatermarkPosition, logoW: number, logoH: number) {
  const width = WM_TARGET_W * comp.w
  const height = logoW > 0 && logoH > 0 ? (width * logoH) / logoW : width
  const m = WM_MARGIN * comp.w
  const left = position.endsWith('left') ? m : comp.w - width - m
  const top = position.startsWith('top') ? m : comp.h - height - m
  return { left: r(left), top: r(top), width: r(width), height: r(height) }
}

// ---- 时间跨度 ----

const contentItems = (s: UndoableState) => Object.values(s.items).filter((i) => !MANAGED.has(i.id))

function bannerSpan(s: UndoableState): { from: number; duration: number } {
  const items = contentItems(s)
  if (!items.length) return { from: 0, duration: s.fps * COVER_SECONDS }
  const from = items.reduce((a, i) => Math.min(a, i.from), Infinity)
  const to = items.reduce((a, i) => Math.max(a, i.from + i.durationInFrames), 0)
  return { from, duration: Math.max(1, to - from) }
}

// 水印覆盖整条时间线:[0, 除水印外所有块的最大结束帧]
function fullSpan(items: Record<string, EditorStarterItem>): { from: number; duration: number } {
  let end = 0
  for (const id of Object.keys(items)) {
    if (id === WM_ID) continue
    const it = items[id]
    end = Math.max(end, it.from + it.durationInFrames)
  }
  return { from: 0, duration: Math.max(1, end) }
}

function respanWatermark(items: Record<string, EditorStarterItem>): void {
  const wm = items[WM_ID]
  if (!wm) return
  const span = fullSpan(items)
  items[WM_ID] = { ...wm, from: span.from, durationInFrames: span.duration }
}

// ---- 轨道:保证 __overlays 存在且置顶;无保留 item 时清空轨 ----

function overlayTracks(items: Record<string, EditorStarterItem>, tracks: UndoableState['tracks']): UndoableState['tracks'] {
  const hasManaged = Object.keys(items).some((id) => MANAGED.has(id))
  if (!hasManaged) return tracks.filter((t) => t.id !== OVERLAY_TRACK)
  const ov = tracks.find((t) => t.id === OVERLAY_TRACK) ?? { ...createTrack('Overlays'), id: OVERLAY_TRACK }
  return [ov, ...tracks.filter((t) => t.id !== OVERLAY_TRACK)]
}

function withOverlay(s: UndoableState, mutate: (items: Record<string, EditorStarterItem>, s: UndoableState) => void): UndoableState {
  const items = { ...s.items }
  mutate(items, s)
  return { ...s, items, tracks: overlayTracks(items, s.tracks) }
}

// 除 except 外所有块整体平移 delta 帧(为片头封面让位 / 收回)。不原地改,保 undo 引用干净。
function shiftExcept(items: Record<string, EditorStarterItem>, except: Set<string>, delta: number): void {
  if (delta === 0) return
  for (const id of Object.keys(items)) {
    if (except.has(id)) continue
    const it = items[id]
    items[id] = { ...it, from: Math.max(0, it.from + delta) }
  }
}

/** 横幅:patch.on=false 删除;否则按当前配置(+patch)重建单个 lowerThird item,文案从元数据烘焙,时间覆盖整段内容。 */
export function applyBanner(s: UndoableState, meta: ListingMeta, patch: Partial<BannerConfig>): UndoableState {
  return withOverlay(s, (items) => {
    const cfg = { ...readBanner(items), ...patch }
    delete items[LT_ID]
    if (!cfg.on) return
    const span = bannerSpan(s)
    const address = addressLine(meta)
    const price = usd(meta.price)
    const details = detailsLine(meta)
    const box = bannerBox({ w: s.compositionWidth, h: s.compositionHeight }, cfg.position, cfg.scale, { address, price, details })
    const it = createLowerThirdItem({
      trackId: OVERLAY_TRACK,
      from: span.from,
      width: box.width,
      height: box.height,
      position: cfg.position,
      scale: cfg.scale,
      bgColor: cfg.bgColor,
      bgOpacity: cfg.opacity,
      textColor: cfg.textColor,
      address,
      price,
      details,
    })
    it.id = LT_ID
    it.left = box.left
    it.top = box.top
    it.durationInFrames = span.duration
    items[LT_ID] = it
  })
}

/** 元数据保存后重烘焙横幅(仅当横幅开启) */
export function applyBannerText(s: UndoableState, meta: ListingMeta): UndoableState {
  if (!s.items[LT_ID]) return s
  return applyBanner(s, meta, {})
}

// 片头封面:真正的第一块 —— 占 [0,D),其余块(除水印)整体右移 D,互不重叠;关闭则收回。水印随之重跨。
export function applyCover(s: UndoableState, meta: ListingMeta, on: boolean): UndoableState {
  return withOverlay(s, (items) => {
    const was = !!items[CV_ID]
    const D = s.fps * COVER_SECONDS
    shiftExcept(items, SHIFT_PINNED, (on ? D : 0) - (was ? D : 0))
    delete items[CV_ID]
    if (on) {
      const it = createCoverItem({ trackId: OVERLAY_TRACK, from: 0, width: s.compositionWidth, height: s.compositionHeight, scale: readCoverScale(items), bgColor: '#151515', eyebrow: 'FOR SALE', title: coverTitle(meta), price: usd(meta.price), subtitle: detailsLine(meta) })
      it.id = CV_ID
      it.durationInFrames = D
      items[CV_ID] = it
    }
    respanWatermark(items)
  })
}

// 片尾封面:真正的最后一块 —— 追加在内容末尾之后 [end, end+D),不与任何块重叠;关闭则删除。水印随之重跨。
export function applyEndCover(s: UndoableState, meta: ListingMeta, on: boolean): UndoableState {
  return withOverlay(s, (items) => {
    delete items[EC_ID]
    if (on) {
      const D = s.fps * COVER_SECONDS
      let end = 0
      for (const id of Object.keys(items)) {
        if (id === WM_ID) continue
        const it = items[id]
        end = Math.max(end, it.from + it.durationInFrames)
      }
      const it = createCoverItem({ trackId: OVERLAY_TRACK, from: end, width: s.compositionWidth, height: s.compositionHeight, scale: readCoverScale(items), bgColor: '#151515', eyebrow: 'THANK YOU', title: coverTitle(meta), price: '', subtitle: [usd(meta.price), meta.address].filter(Boolean).join(' · ') })
      it.id = EC_ID
      it.durationInFrames = D
      items[EC_ID] = it
    }
    respanWatermark(items)
  })
}

// ---- 水印:复用内置 image item + image asset(logo 已上传入库,url = /bff/content/<contentId>)----

type WatermarkPatch = { on?: boolean; position?: WatermarkPosition; opacity?: number; logo?: WatermarkLogo }

export function applyWatermark(s: UndoableState, patch: WatermarkPatch): UndoableState {
  const items = { ...s.items }
  const assets = { ...s.assets }
  const comp = { w: s.compositionWidth, h: s.compositionHeight }
  const existing = items[WM_ID]
  const existingAsset = existing && existing.type === 'image' ? assets[existing.assetId] : undefined
  const prevLogo: WatermarkLogo | undefined =
    existing && existing.type === 'image' && existingAsset && existingAsset.type === 'image'
      ? { contentId: existing.assetId, url: existingAsset.url, width: existingAsset.width, height: existingAsset.height }
      : undefined

  const on = patch.on ?? !!existing
  const position = patch.position ?? (existing ? readWmPosition(existing, comp) : DEFAULT_WATERMARK.position)
  const opacity = patch.opacity ?? existing?.opacity ?? DEFAULT_WATERMARK.opacity
  const logo = patch.logo ?? prevLogo

  // 清掉旧水印 item + 其专用 asset;若下面要复用同一 logo,会在 on&&logo 分支原样补回 asset。
  if (existing && existing.type === 'image') {
    delete items[WM_ID]
    delete assets[existing.assetId]
  }

  if (on && logo) {
    const box = watermarkBox(comp, position, logo.width, logo.height)
    const span = fullSpan(items)
    assets[logo.contentId] = { id: logo.contentId, url: logo.url, filename: 'logo', sizeInBytes: 0, type: 'image', width: logo.width, height: logo.height }
    items[WM_ID] = {
      id: WM_ID,
      trackId: OVERLAY_TRACK,
      type: 'image',
      assetId: logo.contentId,
      crop: null,
      from: span.from,
      durationInFrames: span.duration,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      rotation: 0,
      opacity,
      borderRadius: 0,
      fadeInDurationInFrames: 0,
      fadeOutDurationInFrames: 0,
    }
  }

  return { ...s, items, assets, tracks: overlayTracks(items, s.tracks) }
}

// ---- 读回:item 即真相 ----

function readBanner(items: Record<string, EditorStarterItem>): BannerConfig {
  const lt = items[LT_ID] as LowerThirdItem | undefined
  if (!lt) return { ...DEFAULT_BANNER }
  return { on: true, position: lt.position, scale: lt.scale, bgColor: lt.bgColor, textColor: lt.textColor, opacity: lt.bgOpacity }
}

// 封面尺寸档:两张封面共用一档,从现有封面 item 读回(默认 medium)
function readCoverScale(items: Record<string, EditorStarterItem>): OverlayScale {
  const cv = (items[CV_ID] ?? items[EC_ID]) as CoverItem | undefined
  return cv?.scale ?? 'medium'
}

/** 只改档位:给已存在的两张封面 item 打上新 scale(渲染器读它放大字号,几何无需重算) */
export function applyCoverScale(s: UndoableState, scale: OverlayScale): UndoableState {
  return withOverlay(s, (items) => {
    for (const id of [CV_ID, EC_ID]) {
      const it = items[id]
      if (it && it.type === 'cover') items[id] = { ...it, scale }
    }
  })
}

const WM_CORNERS: WatermarkPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
function readWmPosition(item: EditorStarterItem, comp: Comp): WatermarkPosition {
  // 就近角落:按 item 中心落在哪半区
  const cx = item.left + item.width / 2
  const cy = item.top + item.height / 2
  const h = cy < comp.h / 2 ? 'top' : 'bottom'
  const v = cx < comp.w / 2 ? 'left' : 'right'
  return `${h}-${v}` as WatermarkPosition
}

function readWatermark(s: UndoableState): WatermarkConfig {
  const wm = s.items[WM_ID]
  if (!wm || wm.type !== 'image') return { ...DEFAULT_WATERMARK }
  const asset = s.assets[wm.assetId]
  return {
    on: true,
    position: readWmPosition(wm, { w: s.compositionWidth, h: s.compositionHeight }),
    opacity: wm.opacity,
    logoUrl: asset?.url ?? null,
  }
}

export function readOverlayConfig(s: UndoableState): OverlayConfig {
  return {
    banner: readBanner(s.items),
    cover: !!s.items[CV_ID],
    endCover: !!s.items[EC_ID],
    coverScale: readCoverScale(s.items),
    watermark: readWatermark(s),
  }
}

// eslint 友好:导出角落顺序供 UI 复用
export { WM_CORNERS }
