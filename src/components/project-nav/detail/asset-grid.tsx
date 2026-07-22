import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, MessageSquare, Plus, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'

import type { BffProjectDetail } from '@/generated/api-types'
import { Group } from '@/components/project-nav/fields'
import { useDeleteProjectAsset, useSaveAssetTags } from '@/api/projects/projects'
import { toast } from 'sonner'
import { addProjectAssetToEditor } from '@/lib/add-to-editor'
import { AssetViewer } from '@/components/asset-viewer'
import { useMediaLightbox } from '@/components/media-lightbox'
import { cn } from '@/lib/utils'
import { Thumb } from '@/components/media-card'

// 资产缩略图网格。workbench 项目级没有这个网格(它把远端资产下载成本地照片再进图库),
// 这里 detail 已经带回 url,直接铺出来比只显示 "N resources" 有用得多。
// 审核双签(管理员 + 被指派创作者)折成一个角标:任一方驳回即红,双方通过才绿,其余待定不画。
// 待定不画是刻意的 —— 24rem 的面板里,给"还没发生的事"占像素不划算(legacy 用虚线圈,那是宽屏审核页)。
function ReviewBadge({ admin, assignee }: { admin: string | null; assignee: string | null }) {
  if (!admin && !assignee) return null
  const rejected = admin === 'rejected' || assignee === 'rejected'
  const approved = admin === 'approved' && assignee === 'approved'
  if (!rejected && !approved) return null
  const Icon = rejected ? ThumbsDown : ThumbsUp
  return (
    <span
      title={`admin: ${admin ?? '—'} · assignee: ${assignee ?? '—'}`}
      className={cn(
        'absolute bottom-0.5 left-0.5 inline-flex items-center rounded p-0.5 text-white',
        rejected ? 'bg-red-600/80' : 'bg-emerald-600/80',
      )}
    >
      <Icon className="size-2.5" />
    </span>
  )
}

// 瓦片点开是灯箱而非新标签页(对齐 legacy:点缩略图开 ImageLightbox,下载是灯箱里的动作)。
// 灯箱按扁平下标翻页,所以这里两组共用一份 assets 数组,只是分段渲染。
export function AssetGrid({ projectId, assets }: { projectId: string; assets: NonNullable<BffProjectDetail['assets']> }) {
  const { t } = useTranslation()
  const groups = [
    { key: 'creator', label: 'Resources' },
    { key: 'agent', label: 'Clips' },
  ] as const
  const viewer = useMediaLightbox()
  const saveTags = useSaveAssetTags()
  const del = useDeleteProjectAsset()
  // 删除首点转确认(红 + 勾),再点才真删 —— 与状态菜单/评论删除同套二次确认,不用 window.confirm
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  // 加入编辑器:探测尺寸 → 建素材 + 时间线条目落到右侧编辑器(见 add-to-editor)
  const handleAdd = async (a: NonNullable<BffProjectDetail['assets']>[number]) => {
    setAdding(a.id)
    try {
      await addProjectAssetToEditor({
        id: a.id,
        url: a.url,
        kind: a.kind,
        name: a.name,
        durationSeconds: a.durationSeconds,
        // contentId 是 BFF 新增字段,生成类型暂未含 → cast
        contentId: (a as { contentId?: string | null }).contentId,
      })
      toast.success(t('projectNav.addedToEditor', { name: a.name || t('projectNav.assetFallback') }))
    } catch {
      toast.error(t('projectNav.addToEditorFailed'))
    } finally {
      setAdding(null)
    }
  }
  return (
    <>
      {groups.map(({ key, label }) => {
        const list = assets.filter((a) => a.group === key)
        if (list.length === 0) return null
        return (
          <Group key={key} title={`${label} (${list.length})`}>
            <div className="grid grid-cols-4 gap-1.5">
              {list.map((a) => (
                <div key={a.id} className="group relative">
                  <button
                    type="button"
                    onClick={(e) => viewer.open(assets.indexOf(a), e)}
                    title={[a.name, a.tags?.map((t) => t.displayName || t.name).join(', ')].filter(Boolean).join(' · ') || undefined}
                    className="relative aspect-square w-full overflow-hidden rounded-md ring-offset-background hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {/* 有海报就贴海报 —— 一张图比让 20 个 <video> 各自拉 metadata 便宜得多 */}
                    <Thumb
                      url={a.thumbnailUrl || a.url}
                      kind={a.thumbnailUrl ? 'image' : a.kind}
                      className="size-full rounded-none"
                    />
                    <ReviewBadge admin={a.adminReview ?? null} assignee={a.assigneeReview ?? null} />
                    {a.commentCount > 0 ? (
                      <span className="absolute right-0.5 bottom-0.5 inline-flex items-center gap-0.5 rounded bg-black/70 px-1 text-[10px] text-white">
                        <MessageSquare className="size-2.5" />
                        {a.commentCount}
                      </span>
                    ) : null}
                  </button>
                  {/* hover 显现:加入右侧编辑器(独立按钮,与打开灯箱的瓦片同级,避免嵌套) */}
                  <button
                    type="button"
                    aria-label={t('projectNav.addToEditor')}
                    title={t('projectNav.addToEditor')}
                    disabled={adding === a.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleAdd(a)
                    }}
                    className="absolute top-1 left-1 inline-flex size-6 items-center justify-center rounded bg-black/60 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 hover:bg-black/80 focus-visible:opacity-100 disabled:opacity-60"
                  >
                    {adding === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  </button>
                  {/* hover 显现:删除该资产(整表替换实现)。首点转确认,再点真删;失焦即撤销确认。 */}
                  <button
                    type="button"
                    aria-label={confirmDel === a.id ? t('projectNav.confirmDeleteAsset') : t('projectNav.deleteAsset')}
                    title={confirmDel === a.id ? t('projectNav.confirmDeleteAsset') : t('projectNav.deleteAsset')}
                    disabled={del.isPending && del.variables?.assetKey === (a.contentId ?? a.id)}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirmDel === a.id) {
                        setConfirmDel(null)
                        del.mutate({ projectId, assetKey: a.contentId ?? a.id })
                      } else {
                        setConfirmDel(a.id)
                      }
                    }}
                    onBlur={() => setConfirmDel(null)}
                    className={cn(
                      'absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded text-white opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-60',
                      confirmDel === a.id ? 'bg-red-600/90 opacity-100 hover:bg-red-600' : 'bg-black/60 hover:bg-black/80',
                    )}
                  >
                    {del.isPending && del.variables?.assetKey === (a.contentId ?? a.id) ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : confirmDel === a.id ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </Group>
        )
      })}
      <AssetViewer
        assets={assets}
        index={viewer.index}
        rect={viewer.rect}
        onIndexChange={viewer.onIndexChange}
        onClose={viewer.close}
        onTagsChange={(assetId, tags) => saveTags.mutate({ projectId, assetId, tags })}
      />
    </>
  )
}
