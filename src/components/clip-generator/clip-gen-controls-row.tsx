import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CAMERA_MOVES } from './constants'
import type { useClipGenForm } from './use-clip-gen-form'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Input } from '@/components/ui/input'

// provider + 运镜 + 时长(不可调占位 / 离散下拉 / 连续数字框)三联块 —— 单图面板与组面板原逐字重复一份。
// 渲染成 fragment:provider 一行 + 运镜/时长一行;两处各自套自己的外层容器。trailing 供组面板挂 Wand2 辅助按钮。
export function ClipGenControlsRow({
  form,
  trailing,
}: {
  form: ReturnType<typeof useClipGenForm>
  trailing?: ReactNode
}) {
  const { t } = useTranslation()
  const {
    providers,
    providersQ,
    providerId,
    setProviderId,
    cameraMove,
    setCameraMove,
    durations,
    adjustable,
    durationValues,
    durationSeconds,
    setDurationSeconds,
  } = form
  return (
    <>
      <NativeSelect className="h-8" value={providerId} disabled={providersQ.isLoading} onChange={(e) => setProviderId(e.target.value)}>
        {providers.map((p) => (
          <NativeSelectOption key={p.id} value={p.id} disabled={!p.configured}>
            {p.label}
            {p.configured ? '' : ` — ${p.configurationIssue ?? t('clipGen.notConfigured')}`}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <div className="flex gap-1.5">
        <NativeSelect className="h-8 flex-1" value={cameraMove} onChange={(e) => setCameraMove(e.target.value)}>
          {CAMERA_MOVES.map((m) => (
            <NativeSelectOption key={m} value={m}>
              {t(`clipGen.camera.${m}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {!adjustable ? (
          <span className="flex h-8 w-16 items-center justify-center rounded-md border text-[11px] text-muted-foreground">
            {t('clipGen.modelPicks')}
          </span>
        ) : durationValues?.length ? (
          <NativeSelect className="h-8 w-16" value={String(durationSeconds)} onChange={(e) => setDurationSeconds(Number(e.target.value))}>
            {durationValues.map((v) => (
              <NativeSelectOption key={v} value={String(v)}>
                {v}s
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : (
          <Input
            type="number"
            className="h-8 w-16"
            min={durations?.min ?? 1}
            max={durations?.max ?? 60}
            value={durationSeconds}
            onChange={(e) =>
              setDurationSeconds(
                Math.min(durations?.max ?? 60, Math.max(durations?.min ?? 1, Number(e.target.value) || (durations?.min ?? 1))),
              )
            }
          />
        )}
        {trailing}
      </div>
    </>
  )
}
