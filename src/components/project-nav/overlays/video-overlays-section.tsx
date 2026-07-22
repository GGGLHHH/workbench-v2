import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudDownload, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import type { BffProject } from '@/generated/api-types'
import { editorProjectRef, editorStore } from '@/editor-app'
import {
  readOverlayConfig,
  sameOverlay,
  toMeta,
  WM_CORNERS,
  type BannerPosition,
  type OverlayConfig,
  type OverlayScale,
  type WatermarkPosition,
} from '@/lib/video-overlays'
import { setBanner, setCover, setCoverScale, setEndCover, setWatermark } from '@/lib/video-overlays-store'
import { uploadAttachment } from '@/api/projects/projects'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

// 视频叠加(方案 A):价格横幅 + 片头/片尾封面。控件在详情面板,派发进 editorStore 单例
// (与「加入编辑器」同一入口),编辑器实时预览、走原有 Save 落库。item 即真相,配置从时间轴反推。

// 订阅编辑器单例,派生本项目的叠加配置;editable 守卫编辑器是否已加载本项目(否则派发会写错时间轴)。
// 相等则复用旧引用,避免无关的 store 变更(选中/缩放等)触发本节重渲。
function useOverlayConfig(projectId: string): { cfg: OverlayConfig; editable: boolean } {
  const [snap, setSnap] = useState(() => ({
    cfg: readOverlayConfig(editorStore.getState().undoable),
    editable: editorProjectRef.id === projectId,
  }))
  useEffect(() => {
    const update = () => {
      const cfg = readOverlayConfig(editorStore.getState().undoable)
      const editable = editorProjectRef.id === projectId
      setSnap((prev) => (prev.editable === editable && sameOverlay(prev.cfg, cfg) ? prev : { cfg, editable }))
    }
    update()
    return editorStore.subscribe(update)
  }, [projectId])
  return snap
}

function OverlaySwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}

function ColorInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (c: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="size-6 shrink-0 cursor-pointer rounded border bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  )
}

const CORNER_ARROW: Record<WatermarkPosition, string> = {
  'top-left': '↖',
  'top-right': '↗',
  'bottom-left': '↙',
  'bottom-right': '↘',
}

// 尺寸档 S/M/L(0.8/1/1.25 倍),下三分之一 + 封面共用
function ScaleToggle({ value, disabled, onChange }: { value: OverlayScale; disabled?: boolean; onChange: (s: OverlayScale) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{t('videoSettings.size')}</span>
      <ToggleGroup value={[value]} onValueChange={(v: string[]) => v[0] && onChange(v[0] as OverlayScale)} variant="outline" size="sm" disabled={disabled}>
        <ToggleGroupItem value="small">{t('videoSettings.scaleS')}</ToggleGroupItem>
        <ToggleGroupItem value="medium">{t('videoSettings.scaleM')}</ToggleGroupItem>
        <ToggleGroupItem value="large">{t('videoSettings.scaleL')}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}

export function VideoOverlaysSection({ project }: { project: BffProject }) {
  const { t } = useTranslation()
  const meta = useMemo(() => toMeta(project), [project])
  const { cfg, editable } = useOverlayConfig(project.id)
  const b = cfg.banner
  const w = cfg.watermark
  // 不透明度拖动本地跟手,松手才派发(避免每帧写 undo / 抖动编辑器)
  const [op, setOp] = useState(b.opacity)
  useEffect(() => setOp(b.opacity), [b.opacity])
  const [wmOp, setWmOp] = useState(w.opacity)
  useEffect(() => setWmOp(w.opacity), [w.opacity])
  const dis = !editable

  // logo 上传:走平台两步上传(/bff/uploads → PUT → 完成),入库后拿 contentId,拼稳定的 /bff/content/<id>,
  // 探测尺寸(保宽高比),派发进编辑器成为角落水印 image item。
  const logoRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const onPickLogo = async (file: File) => {
    setUploading(true)
    try {
      const contentId = await uploadAttachment(file)
      const url = `/bff/content/${contentId}`
      const dims = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 })
        img.onerror = () => resolve({ width: 1, height: 1 })
        img.src = url
      })
      setWatermark({ on: true, logo: { contentId, url, width: dims.width, height: dims.height } })
    } catch {
      toast.error(t('projects.logoUploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('videoSettings.title')}</h3>
      {dis ? <p className="text-xs text-muted-foreground">{t('videoSettings.openEditorHint')}</p> : null}

      <OverlaySwitchRow
        label={t('videoSettings.banner')}
        hint={t('videoSettings.bannerHint')}
        checked={b.on}
        disabled={dis}
        onChange={(v) => setBanner(meta, { on: v })}
      />
      {b.on ? (
        <div className="flex flex-col gap-3 rounded-md border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{t('videoSettings.position')}</span>
            <ToggleGroup
              value={[b.position]}
              onValueChange={(v: string[]) => v[0] && setBanner(meta, { position: v[0] as BannerPosition })}
              variant="outline"
              size="sm"
              disabled={dis}
            >
              <ToggleGroupItem value="top">{t('videoSettings.posTop')}</ToggleGroupItem>
              <ToggleGroupItem value="middle">{t('videoSettings.posMiddle')}</ToggleGroupItem>
              <ToggleGroupItem value="bottom">{t('videoSettings.posBottom')}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <ScaleToggle value={b.scale} disabled={dis} onChange={(sc) => setBanner(meta, { scale: sc })} />
          <div className="grid grid-cols-2 gap-3">
            <ColorInput label={t('videoSettings.bgColor')} value={b.bgColor} disabled={dis} onChange={(c) => setBanner(meta, { bgColor: c })} />
            <ColorInput label={t('videoSettings.textColor')} value={b.textColor} disabled={dis} onChange={(c) => setBanner(meta, { textColor: c })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {t('videoSettings.bgOpacity')} <span className="text-foreground tabular-nums">{Math.round(op * 100)}%</span>
            </span>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={op}
              disabled={dis}
              onValueChange={(v) => setOp(v as number)}
              onValueCommitted={(v) => setBanner(meta, { opacity: v as number })}
            />
          </div>
        </div>
      ) : null}

      <OverlaySwitchRow
        label={t('videoSettings.openingCover')}
        hint={t('videoSettings.coverHint')}
        checked={cfg.cover}
        disabled={dis}
        onChange={(v) => setCover(meta, v)}
      />
      <OverlaySwitchRow
        label={t('videoSettings.closingCover')}
        checked={cfg.endCover}
        disabled={dis}
        onChange={(v) => setEndCover(meta, v)}
      />
      {cfg.cover || cfg.endCover ? (
        <div className="rounded-md border p-2.5">
          <ScaleToggle value={cfg.coverScale} disabled={dis} onChange={(sc) => setCoverScale(sc)} />
        </div>
      ) : null}

      {/* 水印:logo 图片(上传入库)+ 角落 + 不透明度。开=需先有 logo → 开关触发上传;关=移除。 */}
      <input
        ref={logoRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void onPickLogo(f)
        }}
      />
      <OverlaySwitchRow
        label={t('videoSettings.watermark')}
        hint={t('videoSettings.watermarkHint')}
        checked={w.on}
        disabled={dis || uploading}
        onChange={(v) => (v ? logoRef.current?.click() : setWatermark({ on: false }))}
      />
      {w.on ? (
        <div className="flex flex-col gap-3 rounded-md border p-2.5">
          <div className="flex items-center justify-between gap-2">
            {w.logoUrl ? <img src={w.logoUrl} alt="logo" className="size-9 rounded border bg-background/50 object-contain p-0.5" /> : null}
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={dis || uploading} onClick={() => logoRef.current?.click()}>
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5 rotate-180" />}
              {t('videoSettings.replaceLogo')}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{t('videoSettings.position')}</span>
            <ToggleGroup
              value={[w.position]}
              onValueChange={(v: string[]) => v[0] && setWatermark({ position: v[0] as WatermarkPosition })}
              variant="outline"
              size="sm"
              disabled={dis}
            >
              {WM_CORNERS.map((c) => (
                <ToggleGroupItem key={c} value={c} className="px-2" aria-label={c}>
                  {CORNER_ARROW[c]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {t('videoSettings.opacity')} <span className="text-foreground tabular-nums">{Math.round(wmOp * 100)}%</span>
            </span>
            <Slider min={0} max={1} step={0.05} value={wmOp} disabled={dis} onValueChange={(v) => setWmOp(v as number)} onValueCommitted={(v) => setWatermark({ opacity: v as number })} />
          </div>
        </div>
      ) : null}
    </section>
  )
}
