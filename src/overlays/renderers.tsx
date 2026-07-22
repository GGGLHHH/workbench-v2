import type React from 'react'
import { useVideoConfig } from 'remotion'
import type { CustomItem } from '@gedatou/shared'
import { FontGate } from '@gedatou/shared/composition'
import {
  COVER_DESIGN,
  LOWER_THIRD_DESIGN,
  LT_REF_ASPECT,
  OVERLAY_SCALE_FACTORS,
  hexWithAlpha,
  type CoverData,
  type LowerThirdData,
} from './overlay-design'

// 对齐参考:地址/价格/标题用 IBM Plex Sans,明细/眉标用 IBM Plex Mono(见 xchangeai-workbench styles.css)
const SANS = 'IBM Plex Sans'
const MONO = 'IBM Plex Mono'

// 注意:此文件会进服务端渲染 bundle(render-entry.tsx),不要用 @/ 别名导入。

// 下三分之一卡:整卡在一个 custom item 里画(左强调条 + 三行:地址/价格/明细)。item 盒 = 卡片矩形本身
// (由 video-overlays bannerBox 按令牌 + position 定位,故点击内容不会误命中满幅);渲染器填满盒即可。
// 内部字号/内边距取自帧尺寸(useVideoConfig),与盒尺寸同源令牌 → 任意分辨率一致。
export const LowerThirdRenderer: React.FC<{ item: CustomItem }> = ({ item }) => {
  const { height: H } = useVideoConfig()
  const t = item.data as LowerThirdData
  const d = LOWER_THIRD_DESIGN
  const f = OVERLAY_SCALE_FACTORS[t.scale] // 尺寸档:字号/内边距/圆角/行距 ×f(卡高由 bannerBox 一并 ×f)
  const padX = d.paddingX * LT_REF_ASPECT * H // 横向量跟帧高(见 LT_REF_ASPECT)→ 任意画幅一致
  const accent = d.accentWidth * LT_REF_ASPECT * H
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        boxSizing: 'border-box',
        padding: `${d.paddingY * H * f}px ${padX}px`,
        borderLeft: `${accent}px solid ${d.accentColor}`,
        borderRadius: d.cornerRadius * H * f,
        background: hexWithAlpha(t.bgColor, t.bgOpacity),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: d.lineGap * H * f,
        overflow: 'hidden',
      }}
    >
      <FontGate key={SANS} family={SANS} />
      <FontGate key={MONO} family={MONO} />
      {/* 地址最多两行折行(不再省略号截断);卡高由 bannerBox 按行数长高 */}
      <span
        style={{
          fontFamily: SANS,
          fontSize: d.addressSize * H * f,
          color: d.addressColor,
          fontWeight: 400,
          lineHeight: 1.2,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
        }}
      >
        {t.address}
      </span>
      <span style={{ fontFamily: SANS, fontSize: d.priceSize * H * f, color: t.textColor, fontWeight: 600, lineHeight: 1.15 }}>
        {t.price}
      </span>
      <span style={{ fontFamily: MONO, fontSize: d.detailsSize * H * f, color: d.detailsColor, fontWeight: 400, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {t.details}
      </span>
    </div>
  )
}

// 封面卡:满幅底 + 居中标题卡(眉标 / 标题 / 价格 / 副标题)。字号取帧高分数。
export const CoverRenderer: React.FC<{ item: CustomItem }> = ({ item }) => {
  const { height: H } = useVideoConfig()
  const t = item.data as CoverData
  const c = COVER_DESIGN
  const f = OVERLAY_SCALE_FACTORS[t.scale] // 尺寸档:所有封面文字字号 ×f
  const lines: Array<{ text: string; fontSize: number; color: string; weight: number; ls: number; font: string }> = []
  if (t.eyebrow) lines.push({ text: t.eyebrow, fontSize: c.eyebrowSize * H * f, color: c.eyebrowColor, weight: 500, ls: c.eyebrowSize * H * f * 0.2, font: MONO })
  if (t.title) lines.push({ text: t.title, fontSize: c.titleSize * H * f, color: '#ffffff', weight: 600, ls: 0, font: SANS })
  if (t.price) lines.push({ text: t.price, fontSize: c.priceSize * H * f, color: '#ffffff', weight: 600, ls: 0, font: SANS })
  if (t.subtitle) lines.push({ text: t.subtitle, fontSize: c.subSize * H * f, color: c.subtitleColor, weight: 400, ls: 0, font: MONO })

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: t.bgColor,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: c.gap * H,
        padding: '0 8%',
        textAlign: 'center',
      }}
    >
      <FontGate key={SANS} family={SANS} />
      <FontGate key={MONO} family={MONO} />
      {lines.map((l, i) => (
        <span key={i} style={{ fontFamily: l.font, fontSize: l.fontSize, color: l.color, fontWeight: l.weight, letterSpacing: l.ls, lineHeight: 1.2, maxWidth: '100%', overflowWrap: 'anywhere' }}>
          {l.text}
        </span>
      ))}
      {/* 经纪人署名:带上分隔线(对齐参考 .nle-cover-frame small);flex gap 提供分隔线上方留白 */}
      {t.agent ? (
        <span
          style={{
            fontFamily: SANS,
            fontSize: c.agentSize * H * f,
            color: c.agentColor,
            fontWeight: 400,
            lineHeight: 1.2,
            paddingTop: c.gap * H,
            borderTop: `${Math.max(1, H * 0.0016)}px solid rgba(255,255,255,0.25)`,
            maxWidth: '100%',
            overflowWrap: 'anywhere',
          }}
        >
          {t.agent}
        </span>
      ) : null}
    </div>
  )
}
