import type React from 'react'
import { Label } from '@/components/ui/label'

// 分组标题 + 一列 label/value 行。value 为空显示 "—"(只读面板留占位比隐藏行更稳定,
// 不会因为数据缺失而让面板高度乱跳)。
export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="flex flex-col gap-1">{children}</dl>
    </section>
  )
}

export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

// beds/baths/sqft 三格,对齐 workbench 的 .nle-three-fields
export function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md border py-2">
      <span className="text-sm font-semibold tabular-nums">{value ?? '—'}</span>
      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
    </div>
  )
}

// 表单一行。等价 workbench 的 .nle-control-group:label 直接包住控件,
// 天然关联、不用手配 htmlFor/id。
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Label className="flex flex-col items-stretch gap-1">
      <span className="text-xs font-normal text-muted-foreground">{label}</span>
      {children}
    </Label>
  )
}
