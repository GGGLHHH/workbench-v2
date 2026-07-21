import { useId, useState } from 'react'
import { X } from 'lucide-react'

import { CommentTimeline } from '@/components/comment-timeline'
import { MediaLightbox, type ViewerItem } from '@/components/media-lightbox'

// 项目资产查看器 = 媒体灯箱 + 房间标签 + 该资产的评论(可发)。
// 评论走右栏的 Message Scroller 时间线(上拉加载 + 虚拟化);合成在这一层,MediaLightbox 本身
// 不认识业务 —— 评论附件复用灯箱时不会连带拖进评论组件(那正是之前循环依赖的成因)。
export function AssetViewer({
  assets,
  index,
  rect,
  closing,
  onIndexChange,
  onClose,
  onTagsChange,
}: {
  assets: ViewerItem[]
  index: number | null
  rect?: { left: number; top: number; width: number; height: number } | null
  closing?: boolean
  onIndexChange: (index: number) => void
  onClose: () => void
  onTagsChange?: (assetId: string, tags: string[]) => void
}) {
  const open = index !== null
  const asset = open ? assets[index] : undefined
  // 建议项从本项目已用过的标签聚合 —— 同一套房子的房间名高度重复,不必去拉全局标签目录
  const suggestions = [...new Set(assets.flatMap((a) => a.tags ?? []))].sort()
  if (!asset) return null

  return (
    <MediaLightbox
      items={assets}
      index={index}
      rect={rect}
      closing={closing}
      onIndexChange={onIndexChange}
      onClose={onClose}
      subtitle={asset.group ? (asset.group === 'creator' ? 'Resource' : 'Clip') : undefined}
      footer={
        asset.id ? (
          <TagEditor
            tags={asset.tags ?? []}
            suggestions={suggestions}
            onChange={(tags) => onTagsChange?.(asset.id!, tags)}
            disabled={!onTagsChange}
          />
        ) : null
      }
      sidebar={
        asset.id ? (
          <CommentTimeline
            entity="asset"
            id={asset.id}
            total={asset.commentCount ?? 0}
            enabled={open}
            className="flex min-h-0 flex-1 flex-col"
          />
        ) : null
      }
    />
  )
}

// 房间标签编辑器。对齐 legacy TagEditor:chip 可删、Enter 提交、空串 Backspace 删末尾、
// blur 自动提交、datalist 建议、上限 5 个。规范化(trim/折空白/截断/去重)集中在 addTag 里,
// 三个提交入口共用同一份 —— 否则 Enter 和 blur 迟早两套规则。
const MAX_TAGS = 5

export function addTag(current: string[], raw: string): string[] {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 40)
  if (!name || current.length >= MAX_TAGS) return current
  if (current.some((t) => t.toLowerCase() === name.toLowerCase())) return current
  return [...current, name]
}

function TagEditor({
  tags,
  suggestions,
  disabled,
  onChange,
}: {
  tags: string[]
  suggestions: string[]
  disabled?: boolean
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const listId = useId()

  const commit = () => {
    const next = addTag(tags, draft)
    setDraft('')
    if (next !== tags) onChange(next)
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px]">
          {tag}
          {disabled ? null : (
            <button
              type="button"
              aria-label={`移除标签 ${tag}`}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-2.5" />
            </button>
          )}
        </span>
      ))}
      {disabled || tags.length >= MAX_TAGS ? null : (
        <>
          <input
            list={suggestions.length ? listId : undefined}
            value={draft}
            placeholder="加房间标签"
            aria-label="加房间标签"
            maxLength={40}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit()
              } else if (event.key === 'Backspace' && !draft && tags.length) {
                onChange(tags.slice(0, -1))
              }
            }}
            className="h-6 w-24 rounded border bg-transparent px-1.5 text-[11px] outline-none focus:border-ring"
          />
          <datalist id={listId}>
            {suggestions
              .filter((t) => !tags.includes(t))
              .map((t) => (
                <option key={t} value={t} />
              ))}
          </datalist>
        </>
      )}
    </div>
  )
}
