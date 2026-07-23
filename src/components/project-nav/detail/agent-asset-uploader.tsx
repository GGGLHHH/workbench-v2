import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Check, ImagePlus, UploadCloud, X } from 'lucide-react'

import { Group } from '@/components/project-nav/fields'
import { useUploadAgentAssets } from '@/api/projects/projects'
import { FileDropOverlay, useFileDrag } from '@/components/file-drop'
import { MediaLightbox, useMediaLightbox, type ViewerItem } from '@/components/media-lightbox'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

// project detail 里上传项目源图(agent_assets,面板「Clips」组):拖拽 / 点选图片 → 暂存成可删列表 →
// 「上传 N 个」二次确认后才真传。拖拽反馈复用通用 FileDropOverlay(与画布/时间轴同款)。
// 点暂存缩略图放大预览(MediaLightbox);上传时每行显示自己的进度/成败,成功即移除、失败留下可重试。
type Staged = { file: File; url: string }
type RowState = { pct: number; status: 'uploading' | 'done' | 'error' }

const isImage = (f: File) => f.type.startsWith('image/')
const isImageMime = (m: string) => m.startsWith('image/')
const keyOf = (f: File) => `${f.name}:${f.size}`

export function AgentAssetUploader({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const upload = useUploadAgentAssets()
  const lightbox = useMediaLightbox()
  const inputRef = useRef<HTMLInputElement>(null)
  const [staged, setStaged] = useState<Staged[]>([])
  // 逐行进度/状态,按文件 key 存(index 会随删除移位,key 稳定)。
  const [prog, setProg] = useState<Record<string, RowState>>({})
  const progRef = useRef(prog)
  progRef.current = prog

  const viewerItems = useMemo<ViewerItem[]>(
    () => staged.map((s) => ({ url: s.url, kind: 'image', name: s.file.name })),
    [staged],
  )

  const add = (files: FileList | File[]) => {
    const imgs = Array.from(files).filter(isImage)
    if (!imgs.length) return
    setStaged((prev) => {
      const seen = new Set(prev.map((s) => keyOf(s.file)))
      const fresh = imgs.filter((f) => !seen.has(keyOf(f))).map((f) => ({ file: f, url: URL.createObjectURL(f) }))
      return [...prev, ...fresh]
    })
  }
  const removeAt = (i: number) =>
    setStaged((prev) => {
      URL.revokeObjectURL(prev[i].url)
      return prev.filter((_, j) => j !== i)
    })

  const onUpload = () => {
    if (!staged.length || upload.isPending) return
    const keys = staged.map((s) => keyOf(s.file))
    setProg(Object.fromEntries(keys.map((k) => [k, { pct: 0, status: 'uploading' as const }])))
    upload.mutate(
      {
        projectId,
        files: staged.map((s) => s.file),
        onFile: (i, update) =>
          setProg((p) => {
            const cur = p[keys[i]] ?? { pct: 0, status: 'uploading' as const }
            return { ...p, [keys[i]]: { pct: update.pct ?? cur.pct, status: update.status ?? cur.status } }
          }),
      },
      {
        onSettled: () => {
          const cur = progRef.current
          // 成功的行移除(释放预览 URL),失败的留下待重试
          setStaged((prev) => {
            const kept: Staged[] = []
            for (const s of prev) {
              if (cur[keyOf(s.file)]?.status === 'done') URL.revokeObjectURL(s.url)
              else kept.push(s)
            }
            return kept
          })
          setProg((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v.status === 'error')))
        },
      },
    )
  }

  const { windowDrag, over, dragProps } = useFileDrag({ accept: isImageMime, onDrop: add })

  return (
    <Group title={t('projectNav.uploadAssets')}>
      <div
        {...dragProps}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'relative flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground transition-colors',
          windowDrag === 'idle' ? 'hover:border-ring/60' : 'border-transparent', // 拖拽时隐藏自身边框,只留覆盖层的
        )}
      >
        {/* 基础内容常挂(拖拽时淡出不卸载 → 不打乱进出计数);覆盖层盖上统一提示 */}
        <div className={cn('flex flex-col items-center gap-1 transition-opacity', windowDrag !== 'idle' && 'opacity-0')}>
          <ImagePlus className="size-5" />
          {t('projectNav.uploadHint')}
        </div>
        <FileDropOverlay
          state={windowDrag}
          over={over}
          labels={{
            dragHere: t('projectNav.dragHere'),
            dropToUpload: t('projectNav.dropToUpload'),
            dropInvalid: t('projectNav.dropInvalid'),
          }}
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files ?? [])
            e.target.value = '' // 允许再次选同一文件
          }}
        />
      </div>

      {staged.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {staged.map((s, i) => {
            const r = prog[keyOf(s.file)]
            return (
              <div key={keyOf(s.file)} className="flex items-center gap-2 rounded-md border px-2 py-1">
                {/* 点缩略图放大预览(灯箱按 viewerItems 索引翻页) */}
                <button
                  type="button"
                  onClick={(e) => lightbox.open(i, e)}
                  className="shrink-0 overflow-hidden rounded ring-offset-background hover:ring-2 hover:ring-ring"
                  aria-label={t('projectNav.preview')}
                >
                  <img src={s.url} alt="" className="size-8 object-cover" />
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-xs" title={s.file.name}>
                    {s.file.name}
                  </span>
                  {r?.status === 'uploading' ? <Progress value={Math.round(r.pct * 100)} /> : null}
                </div>
                {/* 右槽:上传中→%;成功→✓(随后移除);失败→✗;空闲→删除 */}
                {r?.status === 'uploading' ? (
                  <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {Math.round(r.pct * 100)}%
                  </span>
                ) : r?.status === 'done' ? (
                  <Check className="size-4 shrink-0 text-emerald-600" />
                ) : r?.status === 'error' ? (
                  <AlertCircle className="size-4 shrink-0 text-destructive" aria-label={t('projectNav.uploadRowFailed')} />
                ) : (
                  <button
                    type="button"
                    aria-label={t('projectNav.removeStaged')}
                    onClick={() => removeAt(i)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )
          })}

          {!upload.isPending ? (
            <Button size="sm" onClick={onUpload}>
              <UploadCloud />
              {t('projectNav.uploadCount', { count: staged.length })}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* 灯箱常挂(base-ui 需从 open=false 起挂才播进场):预览暂存图 */}
      <MediaLightbox
        items={viewerItems}
        index={lightbox.index}
        rect={lightbox.rect}
        onIndexChange={lightbox.onIndexChange}
        onClose={lightbox.close}
      />
    </Group>
  )
}
