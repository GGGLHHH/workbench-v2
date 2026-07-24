import { useEffect, useState } from 'react'

import { useClipProviders } from '@/api/clips'

// 单图面板与组面板共用的生成表单状态:provider(带「首个 configured provider」兜底)、运镜、
// 时长(不在 provider.values 内则回落首值)、prompt 正文。onGenerate 的 payload 形状两处不同,
// 不并入这里 —— 各自读值拼即可(硬合并反而绕)。
export function useClipGenForm() {
  const providersQ = useClipProviders()
  const providers = providersQ.data ?? []
  const [providerId, setProviderId] = useState('')
  useEffect(() => {
    if (!providerId && providers.length) setProviderId((providers.find((p) => p.configured) ?? providers[0]).id)
  }, [providers, providerId])
  const provider = providers.find((p) => p.id === providerId)
  const durations = provider?.durations
  const adjustable = durations?.adjustable !== false
  const durationValues = durations?.values ?? null

  const [cameraMove, setCameraMove] = useState('slowPushIn')
  const [promptBody, setPromptBody] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(6)
  useEffect(() => {
    if (adjustable && durationValues?.length && !durationValues.includes(durationSeconds)) setDurationSeconds(durationValues[0])
  }, [adjustable, durationValues, durationSeconds])

  return {
    providersQ,
    providers,
    providerId,
    setProviderId,
    provider,
    durations,
    adjustable,
    durationValues,
    cameraMove,
    setCameraMove,
    promptBody,
    setPromptBody,
    durationSeconds,
    setDurationSeconds,
  }
}
