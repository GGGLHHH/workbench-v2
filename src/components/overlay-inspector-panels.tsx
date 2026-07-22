import { useTranslation } from 'react-i18next'
import type { CustomItem } from '@gedatou/shared'
import { Section, useEditor, useItemPatch } from '@gedatou/editor'
import { Input } from '@/components/ui/input'
import type { CoverData } from '@/overlays/overlay-design'

// 封面 custom item 的检查器面板(经 deps.customItemPanels 注入,勿从 render-entry 引用):
// 时间轴选中封面块 → 检查器出现四个文字字段,兑现侧栏 coverHint「选中它可改文字」。
// 输入走 commit:false 高频路径,失焦一次性记 undo;标题同步块标签(时间线显示名)。
// 注意:开关封面会按房源元数据重建文案,手改的文字在重建时被覆盖(与侧栏语义一致)。
export function CoverInspectorPanel({ item }: { item: CustomItem }) {
  const { t } = useTranslation()
  const patch = useItemPatch(item.id)
  const commitPending = useEditor((s) => s.commitPending)
  const d = item.data as CoverData

  const fields: Array<{ key: keyof CoverData & string; label: string }> = [
    { key: 'eyebrow', label: t('coverPanel.eyebrow') },
    { key: 'title', label: t('coverPanel.coverTitle') },
    { key: 'price', label: t('coverPanel.price') },
    { key: 'subtitle', label: t('coverPanel.subtitle') },
    { key: 'agent', label: t('coverPanel.agent') },
  ]

  return (
    <Section title={t('coverPanel.heading')}>
      <div className="flex flex-col gap-2">
        {fields.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <Input
              value={String(d[key] ?? '')}
              onChange={(e) => {
                const data = { ...item.data, [key]: e.target.value }
                patch(key === 'title' ? { data, label: e.target.value || 'Cover' } : { data }, false)
              }}
              onBlur={() => commitPending()}
            />
          </label>
        ))}
      </div>
    </Section>
  )
}
