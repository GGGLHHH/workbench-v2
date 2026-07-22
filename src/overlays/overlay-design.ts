// 房产视频叠加(下三分之一卡 / 封面卡):kind、data 契约与设计令牌 —— 渲染器与 bannerBox 唯一的
// 几何/配色来源。业务版式全在 v2(库只提供 custom item 扩展点),渲染器见 renderers.tsx,注册见 register.ts。
// 下三分之一 1:1 搬自 xchangeai-workbench/server/lowerThirdDesign.js:每个值都是帧宽/高的分数,
// 任意分辨率/宽高比都成立(iw/ih 分数)。封面对齐 model.js 的 DEFAULT_COVER_STYLE。

export const LOWER_THIRD_KIND = 'lowerThird'
export const COVER_KIND = 'cover'

export type OverlayScale = 'small' | 'medium' | 'large'
export type LowerThirdPosition = 'top' | 'middle' | 'bottom'

// custom item 的 data 契约(video-overlays 写入,renderers 读出;需可 JSON 序列化)
export type LowerThirdData = {
  position: LowerThirdPosition
  scale: OverlayScale // 字号/卡高倍率
  bgColor: string // 底卡色(hex)
  bgOpacity: number // 0-1,仅作用于底卡,文字不透明
  textColor: string // 价格行色;地址/明细为固定柔色
  address: string
  price: string
  details: string
}

export type CoverData = {
  scale: OverlayScale // 字号倍率
  bgColor: string // 满幅底色(hex)
  eyebrow: string // 眉标(FOR SALE / THANK YOU)
  title: string
  price: string // 空串则不显示价格行
  subtitle: string
}

export const LOWER_THIRD_DESIGN = {
  marginX: 0.021, // 左内边距(距帧左缘)
  marginY: 0.047, // 锚定侧内边距(top/bottom;middle 忽略)
  width: 0.3, // 卡宽
  height: 0.175, // 卡高
  paddingX: 0.018,
  paddingY: 0.023,
  accentWidth: 0.004, // 左强调条粗细
  cornerRadius: 0.023,
  lineGap: 0.005,
  addressSize: 0.026, // 三行字号,帧高分数
  priceSize: 0.047,
  detailsSize: 0.025,
  accentColor: '#2B59C3', // 固定编辑蓝
  addressColor: '#CBD7EA', // 地址/明细固定柔色;价格用用户 textColor
  detailsColor: '#E6EDF7',
} as const

// 封面:满幅底 + 居中标题卡。字号取帧高分数(参考 DOM 的 clamp 只是小预览产物,渲染按分数缩放)。
// 字号对齐 xchangeai-workbench 参考:renderCoverCard 用帧高分数(eyebrow 0.035 / title medium 0.076 /
// subtitle 0.04),price 取 DOM `.nle-cover-frame strong` 的 clamp 上限(24px/427.5 ≈ 0.053)。
export const COVER_DESIGN = {
  eyebrowColor: '#9DB6DD',
  subtitleColor: '#C9D7EC',
  eyebrowSize: 0.035,
  titleSize: 0.076,
  priceSize: 0.053,
  subSize: 0.04,
  gap: 0.018,
} as const

// 令牌里横向量(marginX/paddingX/accentWidth/width)原本是「帧宽分数」,是在 16:9 参考框下调的。
// 为了竖屏/方图也正确(卡片应跟字号=帧高走,而非帧宽),横向量一律换算成帧高相对:×W → ×(16/9)×H,
// 16:9 下数值不变,其他画幅下卡片与字号保持同比。渲染器与 bannerBox 都用它。
export const LT_REF_ASPECT = 16 / 9

// 尺寸档位:字号(下三分之一还有卡高)的统一倍率,对齐参考 LOWER_THIRD_SCALE_FACTORS。
export const OVERLAY_SCALE_FACTORS: Record<OverlayScale, number> = { small: 0.8, medium: 1, large: 1.25 }

/** #rrggbb + 不透明度 → rgba();渲染下三分之一底卡时用(底卡半透明、文字不透明) */
export const hexWithAlpha = (hex: string, opacity: number): string => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim())
  const base = m ? m[1] : '000000'
  const a = Math.min(1, Math.max(0, Number(opacity) || 0))
  const r = parseInt(base.slice(0, 2), 16)
  const g = parseInt(base.slice(2, 4), 16)
  const b = parseInt(base.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
