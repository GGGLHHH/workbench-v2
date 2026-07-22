import { describe, expect, it } from 'vitest'
import { type CustomItem, createEmptyState, type UndoableState } from '@gedatou/shared'

import { applyBanner, applyCover, applyCoverScale, applyEndCover, applyWatermark, detailsLine, migrateLegacyOverlays, readOverlayConfig, type ListingMeta, type WatermarkLogo } from './video-overlays'

const LOGO: WatermarkLogo = { contentId: 'c1', url: '/bff/content/c1', width: 200, height: 100 }
const assetId = (it: unknown) => (it as { assetId: string }).assetId

const META: ListingMeta = {
  name: 'Maple St',
  price: 1250000,
  bedrooms: 3,
  bathrooms: 2,
  livingAreaSqft: 1800,
  address: '12 Maple St',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
}

function seed(): UndoableState {
  const s = createEmptyState({ width: 1920, height: 1080 })
  return {
    ...s,
    tracks: [{ id: 't1', name: 'Track 1', hidden: false, muted: false }],
    items: {
      clip1: {
        id: 'clip1',
        type: 'solid',
        trackId: 't1',
        from: 0,
        durationInFrames: 90,
        left: 0,
        top: 0,
        width: 1920,
        height: 1080,
        rotation: 0,
        opacity: 1,
        borderRadius: 0,
        fadeInDurationInFrames: 0,
        fadeOutDurationInFrames: 0,
        color: '#333333',
      },
    },
  }
}

const managedIds = (s: UndoableState) => Object.keys(s.items).filter((id) => id.startsWith('__'))

describe('每个叠加 = 时间线上一个块', () => {
  it('横幅只产生一个 lowerThird custom item;封面/片尾各一个 cover custom item', () => {
    let s = applyBanner(seed(), META, { on: true })
    expect(managedIds(s)).toEqual(['__lowerthird'])
    expect(s.items.__lowerthird.type).toBe('custom')
    expect((s.items.__lowerthird as CustomItem).kind).toBe('lowerThird')

    s = applyCover(s, META, true)
    s = applyEndCover(s, META, true)
    s = applyWatermark(s, { on: true, logo: LOGO })
    // 四个叠加 = 恰好四个块(不再是十几个重叠块)
    expect(managedIds(s).sort()).toEqual(['__cover', '__endcover', '__lowerthird', '__watermark'])
    expect((s.items.__cover as CustomItem).kind).toBe('cover')
    expect((s.items.__endcover as CustomItem).kind).toBe('cover')
    expect(s.items.__watermark.type).toBe('image')
  })
})

describe('水印:logo image item(上传入库,复用内置 image 类型)', () => {
  it('建单个 __watermark image item + image asset,指定角落/不透明度', () => {
    const s = applyWatermark(seed(), { on: true, position: 'bottom-right', opacity: 0.6, logo: LOGO })
    const wm = s.items.__watermark
    expect(wm.type).toBe('image')
    expect(wm.opacity).toBe(0.6)
    expect(s.assets.c1).toMatchObject({ type: 'image', url: '/bff/content/c1', width: 200, height: 100 })
    expect(readOverlayConfig(s).watermark).toMatchObject({ on: true, position: 'bottom-right', opacity: 0.6, logoUrl: '/bff/content/c1' })
    // 右下角:落在右半区 + 下半区,且不越界
    expect(wm.left).toBeGreaterThan(1920 / 2)
    expect(wm.top).toBeGreaterThan(1080 / 2)
    expect(wm.left + wm.width).toBeLessThanOrEqual(1920)
    // 保宽高比:200x100 → 高≈宽/2(舍入允许 ±1px)
    expect(Math.abs(wm.height - wm.width / 2)).toBeLessThanOrEqual(1)
  })

  it.each(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const)('%s 角落位置往返', (position) => {
    const s = applyWatermark(seed(), { on: true, position, logo: LOGO })
    expect(readOverlayConfig(s).watermark.position).toBe(position)
  })

  it('改位置保留 logo(复用现有 asset,不必重传)', () => {
    let s = applyWatermark(seed(), { on: true, position: 'top-left', logo: LOGO })
    s = applyWatermark(s, { position: 'bottom-right' })
    expect(assetId(s.items.__watermark)).toBe('c1')
    expect(readOverlayConfig(s).watermark.position).toBe('bottom-right')
  })

  it('关闭移除 item 与其 asset', () => {
    let s = applyWatermark(seed(), { on: true, logo: LOGO })
    s = applyWatermark(s, { on: false })
    expect(s.items.__watermark).toBeUndefined()
    expect(s.assets.c1).toBeUndefined()
  })
})

describe('横幅:配置往返 + 左锚定卡矩形(几何对齐 LOWER_THIRD_DESIGN)', () => {
  it('position/bgColor/textColor/opacity 原值读回', () => {
    const s = applyBanner(seed(), META, { on: true, position: 'top', bgColor: '#ff0000', textColor: '#00ff00', opacity: 0.5 })
    expect(readOverlayConfig(s).banner).toMatchObject({ on: true, position: 'top', bgColor: '#ff0000', textColor: '#00ff00', opacity: 0.5 })
  })

  it('文案从元数据烘焙(地址/价格/明细)', () => {
    const lt = (applyBanner(seed(), META, { on: true }).items.__lowerthird as CustomItem).data as { price: string; address: string; details: string }
    expect(lt.price).toBe('$1,250,000')
    expect(lt.address).toContain('12 Maple St')
    expect(lt.details).toBe(detailsLine(META))
  })

  it('盒 = 卡矩形:左锚定、宽度贴合内容(非满幅、非居中)、高按帧高', () => {
    const lt = applyBanner(seed(), META, { on: true, position: 'bottom' }).items.__lowerthird
    const W = 1920, H = 1080
    // 左锚定(靠左小边距,几何跟帧高:marginX×(16/9)×H)
    expect(lt.left).toBe(Math.round(0.021 * (16 / 9) * H))
    expect(lt.left).toBeLessThan(W * 0.05)
    // 高 = height×H(bottom 档,单行地址)
    expect(lt.height).toBe(Math.round(0.175 * H))
    expect(lt.top).toBe(Math.round(H - 0.175 * H - 0.047 * H))
    // 宽度贴合内容:比满幅小,也比下限大
    expect(lt.width).toBeLessThan(W)
    expect(lt.width).toBeGreaterThan(Math.round(0.175 * H))
  })

  it('竖屏(9:16)也不再溢出:卡片宽度跟帧高走、且不超过画面', () => {
    const portrait: UndoableState = { ...seed(), compositionWidth: 1080, compositionHeight: 1920 }
    const lt = applyBanner(portrait, META, { on: true }).items.__lowerthird
    expect(lt.left + lt.width).toBeLessThanOrEqual(1080) // 不超画面
    // 竖屏字号更大(按帧高 1920),卡片相应更宽,能放下数字行
    expect(lt.width).toBeGreaterThan(Math.round(0.3 * 1080)) // 比旧的固定 0.3×W 宽
  })

  it.each(['top', 'middle', 'bottom'] as const)('%s 位置读回一致', (position) => {
    const s = applyBanner(seed(), META, { on: true, position })
    expect(readOverlayConfig(s).banner.position).toBe(position)
  })
})

describe('尺寸档 S/M/L', () => {
  it('横幅 scale 读回一致,large 卡片比 small 高', () => {
    const small = applyBanner(seed(), META, { on: true, scale: 'small' })
    const large = applyBanner(seed(), META, { on: true, scale: 'large' })
    expect(readOverlayConfig(small).banner.scale).toBe('small')
    expect(readOverlayConfig(large).banner.scale).toBe('large')
    expect(large.items.__lowerthird.height).toBeGreaterThan(small.items.__lowerthird.height)
  })

  it('封面 scale:applyCoverScale 打到两张封面,读回一致,新开的封面继承当前档', () => {
    let s = applyCover(seed(), META, true)
    s = applyEndCover(s, META, true)
    s = applyCoverScale(s, 'large')
    expect(readOverlayConfig(s).coverScale).toBe('large')
    // 两张都改了
    expect(((s.items.__cover as CustomItem).data as { scale: string }).scale).toBe('large')
    expect(((s.items.__endcover as CustomItem).data as { scale: string }).scale).toBe('large')
    // 关掉再开,继承当前 large
    s = applyCover(s, META, false)
    s = applyCover(s, META, true)
    expect(((s.items.__cover as CustomItem).data as { scale: string }).scale).toBe('large')
  })
})

describe('长地址换行:卡片按行数长高(无 DOM 粗估)', () => {
  it('同样的数字行、仅地址超长 → 卡片更高(地址折两行)', () => {
    const base = { price: 1250000, bedrooms: 3, bathrooms: 2, livingAreaSqft: 1800 }
    const short = applyBanner(seed(), { ...base, address: '12 Maple St' }, { on: true })
    const long = applyBanner(seed(), { ...base, address: '15850 Kalisher St, Granada Hills, CA 91344, Building 7 Unit 12B' }, { on: true })
    expect(long.items.__lowerthird.height).toBeGreaterThan(short.items.__lowerthird.height)
  })
})

describe('封面 = 真正的首/尾块,时间不重叠', () => {
  it('片头封面占 [0,D),内容整体右移 D,关闭收回', () => {
    const base = seed()
    const D = base.fps * 3
    const s = applyCover(base, META, true)
    expect(s.items.__cover.from).toBe(0)
    expect(s.items.__cover.durationInFrames).toBe(D)
    expect(s.items.clip1.from).toBe(D)
    expect(s.items.__cover.from + s.items.__cover.durationInFrames).toBeLessThanOrEqual(s.items.clip1.from)
    expect(applyCover(s, META, false).items.clip1.from).toBe(0)
  })

  it('片尾封面紧接内容末尾之后追加', () => {
    const base = seed()
    const end = base.items.clip1.from + base.items.clip1.durationInFrames
    const s = applyEndCover(base, META, true)
    expect(s.items.__endcover.from).toBe(end)
  })

  it('片头 + 内容 + 片尾三者首尾相接不交叠', () => {
    let s = applyCover(seed(), META, true)
    s = applyEndCover(s, META, true)
    const c = s.items.__cover, clip = s.items.clip1, e = s.items.__endcover
    expect(c.from + c.durationInFrames).toBeLessThanOrEqual(clip.from)
    expect(clip.from + clip.durationInFrames).toBeLessThanOrEqual(e.from)
  })
})

describe('旧格式迁移(库专用 type → custom+kind)', () => {
  it('lowerThird/cover 旧 item 摊回去再迁移,配置读回一致;新格式原引用返回', () => {
    let s = applyCover(seed(), META, true)
    s = applyBanner(s, META, { on: true, position: 'top' })
    // 手工造旧格式:把 custom item 的 data 摊回顶层、type 换回旧专用名
    const legacyItems = Object.fromEntries(
      Object.entries(s.items).map(([id, it]) => {
        if (it.type !== 'custom') return [id, it]
        const { kind, label: _label, data, ...base } = it
        return [id, { ...base, ...data, type: kind }]
      }),
    )
    const legacy = { ...s, items: legacyItems } as unknown as UndoableState
    const migrated = migrateLegacyOverlays(legacy)
    expect(migrated.items.__cover.type).toBe('custom')
    expect((migrated.items.__cover as CustomItem).kind).toBe('cover')
    expect(readOverlayConfig(migrated).banner).toMatchObject({ on: true, position: 'top' })
    expect(migrateLegacyOverlays(migrated)).toBe(migrated)
  })
})
