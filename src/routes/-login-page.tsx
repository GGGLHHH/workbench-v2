import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'

import { loginBffSession } from '@/generated/client'
import { formSubmitHandler, useAppForm } from '@/components/form'
import { queryKeys } from '@/lib/query-keys'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// `-` 前缀文件不入路由树,仅作 /login 的页面组件(对齐 xchangeai-web 的 -login-page 约定)。

interface LoginFormValues {
  identifier: string
  password: string
}

const defaultValues: LoginFormValues = { identifier: '', password: '' }

// zod 按顺序求值:空 → 'required';1-2 字符 → 'min'。
const loginSchema = z.object({
  identifier: z.string().min(1, '请输入账号').min(3, '账号至少 3 个字符'),
  password: z.string().min(1, '请输入密码').min(3, '密码至少 3 个字符'),
})

export function LoginPage() {
  const navigate = useNavigate()
  const { redirect: redirectTo } = useSearch({ from: '/login' })
  const queryClient = useQueryClient()
  const { mutate: login, isPending } = useMutation({
    mutationFn: (body: LoginFormValues) => loginBffSession({ body }),
  })
  const form = useAppForm({
    defaultValues,
    validators: { onChange: loginSchema },
    onSubmit: ({ value }) => {
      login(value, {
        onSuccess: (session) => {
          // 预填会话缓存 → 守卫立即看到已登录,避免回跳时再探测一次
          queryClient.setQueryData(queryKeys.session(), session)
          toast.success('登录成功')
          void navigate({ to: (redirectTo ?? '/') as '/' })
        },
        onError: (error: Error) => {
          toast.error(error.message || '登录失败')
        },
      })
    },
  })

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录 Workbench</CardTitle>
          <CardDescription>使用 XChangeAI 账号登录</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-6" onSubmit={formSubmitHandler(form.handleSubmit)}>
            <form.AppField name="identifier">
              {(field) => (
                <field.TextField
                  label="账号"
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
                  label="密码"
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
                pendingLabel="登录中…"
                disabled={isPending}
              >
                登录
              </form.SubmitButton>
            </form.AppForm>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
