import {
  createFormHook,
  createFormHookContexts,
  useStore as useFormStore,
  type AnyFieldApi,
} from '@tanstack/react-form'
import type { ComponentProps, FormEvent, ReactNode } from 'react'
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// 严格对齐 xchangeai-web/src/components/form/index.tsx,裁到登录所需:TextField / PasswordField
// / SubmitButton + 提交与错误辅助。shadcn 组件走 @/components/ui/*,图标用 lucide-react。

export type FormFieldError = { message?: string }

export { useFormStore }

interface BaseAppFieldProps {
  controlClassName?: string
  errorClassName?: string
  fieldClassName?: string
  label?: ReactNode
  labelEnd?: ReactNode
  labelRowClassName?: string
  labelClassName?: string
}

interface TextFieldProps
  extends BaseAppFieldProps,
    Omit<
      ComponentProps<typeof Input>,
      'aria-describedby' | 'aria-invalid' | 'id' | 'name' | 'onBlur' | 'onChange' | 'value'
    > {
  endAdornment?: ReactNode
  startAdornment?: ReactNode
}

interface PasswordFieldProps extends Omit<TextFieldProps, 'endAdornment' | 'type'> {
  toggleLabel?: string
}

interface SubmitButtonProps extends ComponentProps<typeof Button> {
  pending?: boolean
  pendingLabel?: ReactNode
}

interface FormSubmitHandlerOptions {
  focusFirstError?: boolean
}

const INVALID_FORM_CONTROL_SELECTOR =
  '[aria-invalid="true"]:not(:disabled):not([aria-disabled="true"])'

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts()

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: { PasswordField, TextField },
  formComponents: { SubmitButton },
  fieldContext,
  formContext,
})

export function formSubmitHandler(
  handleSubmit: () => Promise<void> | void,
  { focusFirstError = true }: FormSubmitHandlerOptions = {},
) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const form = event.currentTarget
    void Promise.resolve(handleSubmit()).finally(() => {
      if (focusFirstError) focusFirstInvalidControl(form)
    })
  }
}

function focusFirstInvalidControl(form: HTMLFormElement) {
  const schedule = window.requestAnimationFrame ?? window.setTimeout
  schedule(() => {
    if (!form.isConnected) return
    form.querySelector<HTMLElement>(INVALID_FORM_CONTROL_SELECTOR)?.focus()
  })
}

export function fieldShouldShowError(field: AnyFieldApi): boolean {
  return field.state.meta.isBlurred || field.form.state.submissionAttempts > 0
}

export function normalizeFieldErrors(errors: unknown[]): FormFieldError[] {
  return errors.flatMap((error) => {
    if (Array.isArray(error)) return normalizeFieldErrors(error)
    if (typeof error === 'string') return [{ message: error }]
    if (isErrorWithMessage(error)) return [{ message: error.message }]
    return []
  })
}

function isErrorWithMessage(error: unknown): error is FormFieldError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as FormFieldError).message === 'string'
  )
}

export function fieldErrors(field: AnyFieldApi): FormFieldError[] {
  if (!fieldShouldShowError(field)) return []
  return normalizeFieldErrors(field.state.meta.errors)
}

function fieldErrorId(fieldName: string): string {
  return `${fieldName.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}-error`
}

function fieldInvalidState(field: AnyFieldApi): { errorId: string; invalid: boolean } {
  return { errorId: fieldErrorId(field.name), invalid: fieldErrors(field).length > 0 }
}

function TextField({
  className,
  controlClassName,
  endAdornment,
  errorClassName,
  fieldClassName,
  label,
  labelEnd,
  labelClassName,
  labelRowClassName,
  startAdornment,
  ...props
}: TextFieldProps) {
  const field = useFieldContext<string>()
  const { errorId, invalid } = fieldInvalidState(field)
  const input = (
    <Input
      {...props}
      id={field.name}
      name={field.name}
      className={className}
      value={field.state.value ?? ''}
      onBlur={field.handleBlur}
      onChange={(event) => field.handleChange(event.target.value)}
      aria-describedby={errorId}
      aria-invalid={invalid}
    />
  )
  const hasControlWrapper = Boolean(controlClassName || startAdornment || endAdornment)

  return (
    <Field data-invalid={invalid} className={fieldClassName}>
      {label ? (
        <div className={cn(labelEnd && 'flex items-center justify-between', labelRowClassName)}>
          <FieldLabel htmlFor={field.name} className={labelClassName}>
            {label}
          </FieldLabel>
          {labelEnd}
        </div>
      ) : null}
      {hasControlWrapper ? (
        <div className={cn('relative', controlClassName)}>
          {startAdornment}
          {input}
          {endAdornment}
        </div>
      ) : (
        input
      )}
      <FieldError id={errorId} className={errorClassName} errors={fieldErrors(field)} />
    </Field>
  )
}

function PasswordField({
  className,
  controlClassName,
  toggleLabel = 'Toggle password visibility',
  ...props
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false)

  return (
    <TextField
      {...props}
      className={cn('pr-10', className)}
      controlClassName={cn('relative', controlClassName)}
      endAdornment={
        <button
          type="button"
          aria-label={toggleLabel}
          aria-pressed={isVisible}
          className="absolute top-1/2 right-1 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          onClick={() => setIsVisible((value) => !value)}
        >
          {isVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
      type={isVisible ? 'text' : 'password'}
    />
  )
}

function SubmitButton({ children, disabled, pending, pendingLabel, ...props }: SubmitButtonProps) {
  const form = useFormContext()
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button {...props} disabled={disabled || pending || isSubmitting}>
          {(pending || isSubmitting) && pendingLabel ? pendingLabel : children}
        </Button>
      )}
    </form.Subscribe>
  )
}
