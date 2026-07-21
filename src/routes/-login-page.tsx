import { useNavigate, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { useLogin } from '@/api/session/session'
import { formSubmitHandler, useAppForm } from '@/components/form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LanguageToggle } from '@/components/language-toggle'
import { ThemeToggle } from '@/components/theme-toggle'

// `-` 前缀文件不入路由树,仅作 /login 的页面组件(对齐 xchangeai-web 的 -login-page 约定)。

interface LoginFormValues {
  identifier: string
  password: string
}

const defaultValues: LoginFormValues = { identifier: '', password: '' }

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // zod 按顺序求值:空 → 'required';1-2 字符 → 'min'。放组件内用 t()，切到中文校验消息即跟随。
  const loginSchema = z.object({
    identifier: z.string().min(1, t('login.identifierRequired')).min(3, t('login.identifierMin')),
    password: z.string().min(1, t('login.passwordRequired')).min(3, t('login.passwordMin')),
  })
  const { redirect: redirectTo } = useSearch({ from: '/login' })
  // useLogin 已在 onSuccess 里预填会话缓存(守卫立即放行),这里只负责 toast + 跳转。
  const { mutate: login, isPending } = useLogin()
  const form = useAppForm({
    defaultValues,
    validators: { onChange: loginSchema },
    onSubmit: ({ value }) => {
      login(value, {
        onSuccess: () => {
          toast.success(t('login.loginSuccess'))
          void navigate({ to: (redirectTo ?? '/') as '/' })
        },
        onError: (error: Error) => {
          toast.error(error.message || t('login.loginFailed'))
        },
      })
    },
  })

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-background px-4 py-12">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <ThemeToggle />
        <LanguageToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('login.title')}</CardTitle>
          <CardDescription>{t('login.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-6" onSubmit={formSubmitHandler(form.handleSubmit)}>
            <form.AppField name="identifier">
              {(field) => (
                <field.TextField
                  label={t('login.identifier')}
                  type="text"
                  autoComplete="username"
                  placeholder="superadmin@xchangeai.com"
                  disabled={isPending}
                />
              )}
            </form.AppField>

            <form.AppField name="password">
              {(field) => (
                <field.PasswordField
                  label={t('login.password')}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  disabled={isPending}
                />
              )}
            </form.AppField>

            <form.AppForm>
              <form.SubmitButton
                type="submit"
                className="w-full"
                pending={isPending}
                pendingLabel={t('login.submitting')}
                disabled={isPending}
              >
                {t('login.submit')}
              </form.SubmitButton>
            </form.AppForm>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
