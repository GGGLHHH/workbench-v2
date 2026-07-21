import { useTranslation } from 'react-i18next'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { toggleThemeWithTransition } from '@/lib/theme-transition'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// 主题切换(参考 xchangeai-web theme-toggle:light / dark / system)。next-themes 管 <html>.dark。
// 触发按钮按「生效主题」显示日/月图标(system 亦解析为明暗之一,与页面保持一致)。
const THEME_OPTIONS = [
  { value: 'light', icon: Sun, labelKey: 'theme.light' },
  { value: 'dark', icon: Moon, labelKey: 'theme.dark' },
  { value: 'system', icon: Monitor, labelKey: 'theme.system' },
] as const

export function ThemeToggle() {
  const { t } = useTranslation()
  const { theme, resolvedTheme, systemTheme, setTheme } = useTheme()
  // resolvedTheme 未就绪(挂载前)默认按 dark 显示月亮 —— 与 index.html 预置 .dark 一致,不闪
  const TriggerIcon = resolvedTheme === 'light' ? Sun : Moon

  // 切换时以鼠标位置做圆形揭示(见 lib/theme-transition)。目标解析后与当前观感相同
  // (如 dark→system 而系统本就是 dark)则无视觉变化 → 跳过动画直接切。
  const onSelect = (next: string) => {
    if (next === theme) return
    const nextResolved = next === 'system' ? systemTheme : next
    if (resolvedTheme === nextResolved) {
      setTheme(next)
      return
    }
    toggleThemeWithTransition(() => setTheme(next))
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 px-0"
            title={t('theme.changeTheme')}
            aria-label={t('theme.changeTheme')}
          />
        }
      >
        <TriggerIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        <DropdownMenuRadioGroup value={theme} onValueChange={onSelect}>
          {THEME_OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} closeOnClick className="gap-2 text-xs">
              <o.icon className="size-3.5" />
              {t(o.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
