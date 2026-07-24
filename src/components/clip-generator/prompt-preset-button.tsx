import { useTranslation } from 'react-i18next'
import { BookText } from 'lucide-react'

import type { BffPromptPreset } from '@/generated/api-types'
import { PromptPresetInfiniteSelect } from '@/components/prompt-preset-infinite-select'

// 从只读预设目录挑一条 prompt,把正文填进生成面板的文本框(单选、insert 语义)。单图 / 组两面板共用。
// 目录空(admin 未建预设)时下拉走空态,按钮仍可点;再点已选项 → onChange(undefined),忽略。
export function PromptPresetButton({ onPick }: { onPick: (body: string) => void }) {
  const { t } = useTranslation()
  return (
    <PromptPresetInfiniteSelect
      onChange={(preset: BffPromptPreset | undefined) => {
        if (preset) onPick(preset.body)
      }}
    >
      <button
        type="button"
        title={t('clipGen.presetTitle')}
        className="inline-flex h-7 w-fit items-center gap-1 self-start rounded-md border border-input bg-transparent px-2 text-[11px] text-muted-foreground outline-none transition-colors hover:border-ring hover:text-foreground focus-visible:border-ring"
      >
        <BookText className="size-3.5" />
        {t('clipGen.preset')}
      </button>
    </PromptPresetInfiniteSelect>
  )
}
