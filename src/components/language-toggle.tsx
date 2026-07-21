import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setLanguage } from '@/i18n'

// 语言切换（zh ↔ en，只有两种语言故用单键切换）。按钮显示「另一种」语言，点击切换并持久化。
// 语言名以各自文字呈现（EN / 中），不参与翻译。useTranslation 让语言变更时本组件跟随重渲。
export function LanguageToggle() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      onClick={() => setLanguage(isZh ? 'en' : 'zh')}
      title={isZh ? 'Switch to English' : '切换到中文'}
    >
      <Languages className="size-3.5" />
      {isZh ? 'EN' : '中'}
    </Button>
  )
}
