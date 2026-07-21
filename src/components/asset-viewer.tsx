import type { BffTag } from '@/generated/api-types'
import { CommentPane } from '@/components/comment-pane'
import { MediaLightbox, type ViewerItem } from '@/components/media-lightbox'
import { TagInfiniteSelect } from '@/components/tag-infinite-select'
import {
  InfiniteSelectCancelButton,
  InfiniteSelectConfirmButton,
  InfiniteSelectFooter,
} from '@/components/select/infinite-select'
import { Separator } from '@/components/ui/separator'

// 项目资产查看器 = 媒体灯箱 + 房间标签 + 该资产的评论(可发)。
// 房间标签走 tag 目录的无限下拉(TagInfiniteSelect,从「已有」标签绑定,不新建);评论走右栏的
// Message Scroller 时间线。合成在这一层,MediaLightbox 本身不认业务。
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
  onTagsChange?: (assetId: string, tags: BffTag[]) => void
}) {
  const open = index !== null
  const asset = open ? assets[index] : undefined
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
          <AssetTagField
            tags={asset.tags ?? []}
            onChange={(tags) => onTagsChange?.(asset.id!, tags)}
            disabled={!onTagsChange}
          />
        ) : null
      }
      sidebar={
        asset.id ? (
          <CommentPane
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
          <span className="text-[11px] text-muted-foreground">无标签</span>
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
      searchPlaceholder="搜索房间标签…"
      contentClassName="min-w-56"
      // 底部操作栏:组合式插槽。取消=丢弃勾选还原,确定=提交并关闭。各半 + 中间竖线由部件自带 flex-1。
      slots={
        <InfiniteSelectFooter>
          <InfiniteSelectCancelButton>取消</InfiniteSelectCancelButton>
          <Separator orientation="vertical" />
          <InfiniteSelectConfirmButton>确定</InfiniteSelectConfirmButton>
        </InfiniteSelectFooter>
      }
    >
      {({ selectedItems }) => {
        const chips = selectedItems ?? []
        return (
          <button
            type="button"
            aria-label="房间标签"
            className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-1 rounded border bg-transparent px-1.5 py-1 text-left outline-none hover:border-ring focus-visible:border-ring"
          >
            {chips.length ? (
              chips.map((t) => (
                <span key={t.id} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  {t.displayName || t.name}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground">加房间标签</span>
            )}
          </button>
        )
      }}
    </TagInfiniteSelect>
  )
}
