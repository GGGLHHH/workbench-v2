import { useRef, useState } from 'react'

import type { BffTag } from '@/generated/api-types'
import { CommentPane } from '@/components/comment-pane'
import { MediaLightbox, type ViewerItem } from '@/components/media-lightbox'
import { TagInfiniteSelect } from '@/components/tag-infinite-select'
import { PromptPresetButton } from '@/components/clip-generator/prompt-preset-button'
import {
  InfiniteSelectCancelButton,
  InfiniteSelectConfirmButton,
  InfiniteSelectFooter,
} from '@/components/select/infinite-select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from 'react-i18next'

// 项目资产查看器 = 媒体灯箱 + 房间标签 + 该资产的评论(可发)。
// 房间标签走 tag 目录的无限下拉(TagInfiniteSelect,从「已有」标签绑定,不新建);评论走右栏的
// Message Scroller 时间线。合成在这一层,MediaLightbox 本身不认业务。
export function AssetViewer({
  assets,
  index,
  rect,
  onIndexChange,
  onClose,
  onTagsChange,
  onDescriptionChange,
}: {
  assets: ViewerItem[]
  index: number | null
  rect?: { left: number; top: number; width: number; height: number } | null
  onIndexChange: (index: number) => void
  onClose: () => void
  onTagsChange?: (assetId: string, tags: BffTag[]) => void
  onDescriptionChange?: (assetId: string, description: string) => void
}) {
  const open = index !== null
  // 不能像原来那样 open=false 就 return null —— 那会立刻卸载 MediaLightbox,base-ui 来不及播退出
  // 过渡(表现为瞬间消失)。始终渲染,靠 MediaLightbox 自身 open/shownRef 走 base-ui 退出过渡。
  // 冻结最后一张 asset:退出期间 index 已 null,footer/侧栏(标签/评论)仍要用上一张,否则退场中途塌掉。
  const lastIndexRef = useRef(0)
  if (open && index !== null) lastIndexRef.current = index
  const asset = assets[open ? index : lastIndexRef.current]
  const assetId = asset?.id

  return (
    <MediaLightbox
      items={assets}
      index={index}
      rect={rect}
      onIndexChange={onIndexChange}
      onClose={onClose}
      subtitle={asset?.group ? (asset.group === 'creator' ? 'Resource' : 'Clip') : undefined}
      footer={
        assetId ? (
          <div className="flex flex-col gap-2">
            <AssetTagField
              tags={asset?.tags ?? []}
              onChange={(tags) => onTagsChange?.(assetId, tags)}
              disabled={!onTagsChange}
            />
            {/* description 仅对 agent asset 开放(上游 agent-assets/descriptions 按 asset_id upsert);存这条资产的 prompt 文本。
                按 assetId key → 切资产重置草稿。 */}
            {asset?.group === 'agent' ? (
              <AssetDescriptionField
                key={assetId}
                description={asset?.description ?? ''}
                onChange={(description) => onDescriptionChange?.(assetId, description)}
                disabled={!onDescriptionChange}
              />
            ) : null}
          </div>
        ) : null
      }
      sidebar={
        assetId ? (
          <CommentPane
            entity="asset"
            id={assetId}
            total={asset?.commentCount ?? 0}
            enabled={open}
            className="flex min-h-0 flex-1 flex-col"
          />
        ) : null
      }
    />
  )
}

// agent asset 的描述字段(存 prompt 文本):textarea + 从预设填入(复用图生视频的 PromptPresetButton),失焦保存(变了才写)。
// 只读时(无 onDescriptionChange)展示文本。draft 本地态,靠外层 key={assetId} 在切资产时重置。
function AssetDescriptionField({
  description,
  onChange,
  disabled,
}: {
  description: string
  onChange: (description: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(description)
  if (disabled) {
    return description ? (
      <p className="text-[11px] whitespace-pre-wrap text-muted-foreground">{description}</p>
    ) : (
      <span className="text-[11px] text-muted-foreground">{t('assetViewer.noDescription')}</span>
    )
  }
  const commit = () => {
    const next = draft.trim()
    if (next !== description.trim()) onChange(next)
  }
  return (
    <div className="flex flex-col gap-1">
      <PromptPresetButton onPick={setDraft} />
      <Textarea
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        placeholder={t('assetViewer.descriptionPlaceholder')}
      />
    </div>
  )
}

// 房间标签字段:多选、关闭时一次性提交(避免每次勾选一次写入)。触发器是一块显示已选 chip 的字段,
// 点开即无限下拉从目录搜索绑定。只读时(无 onTagsChange)退化成纯 chip 展示。
function AssetTagField({
  tags,
  onChange,
  disabled,
}: {
  tags: BffTag[]
  onChange: (tags: BffTag[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  if (disabled) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {tags.length ? (
          tags.map((t) => (
            <span key={t.id} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px]">
              {t.displayName || t.name}
            </span>
          ))
        ) : (
          <span className="text-[11px] text-muted-foreground">{t('assetViewer.noTags')}</span>
        )}
      </div>
    )
  }

  return (
    <TagInfiniteSelect
      multiple
      commitOnClose
      align="start"
      value={tags.map((t) => t.id)}
      selectedItems={tags}
      onChange={onChange}
      searchPlaceholder={t('assetViewer.searchTagPlaceholder')}
      contentClassName="min-w-56"
      // 底部操作栏:组合式插槽。取消=丢弃勾选还原,确定=提交并关闭。各半 + 中间竖线由部件自带 flex-1。
      slots={
        <InfiniteSelectFooter>
          <InfiniteSelectCancelButton>{t('common.cancel')}</InfiniteSelectCancelButton>
          <Separator orientation="vertical" />
          <InfiniteSelectConfirmButton>{t('assetViewer.confirm')}</InfiniteSelectConfirmButton>
        </InfiniteSelectFooter>
      }
    >
      {({ selectedItems }) => {
        const chips = selectedItems ?? []
        return (
          <button
            type="button"
            aria-label={t('assetViewer.roomTag')}
            className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-1 rounded border bg-transparent px-1.5 py-1 text-left outline-none hover:border-ring focus-visible:border-ring"
          >
            {chips.length ? (
              chips.map((t) => (
                <span key={t.id} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  {t.displayName || t.name}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground">{t('assetViewer.addRoomTag')}</span>
            )}
          </button>
        )
      }}
    </TagInfiniteSelect>
  )
}
