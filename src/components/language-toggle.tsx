import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setLanguage, type Lang } from '@/i18n'

// 语言切换(zh / en),下拉形态,与主题切换同形。语言名以各自文字呈现,不参与翻译。
// useTranslation 让语言变更时本组件跟随重渲(current 重算 → 选中项跟随)。
const LANGS: { value: Lang; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

export function LanguageToggle() {
  const { t, i18n } = useTranslation()
  const current: Lang = i18n.language.startsWith('zh') ? 'zh' : 'en'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            title={t('language.changeLanguage')}
            aria-label={t('language.changeLanguage')}
          />
        }
      >
        <Languages className="size-3.5" />
        {current === 'zh' ? '中' : 'EN'}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        <DropdownMenuRadioGroup value={current} onValueChange={(v) => setLanguage(v as Lang)}>
          {LANGS.map((l) => (
            <DropdownMenuRadioItem key={l.value} value={l.value} closeOnClick className="text-xs">
              {l.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
