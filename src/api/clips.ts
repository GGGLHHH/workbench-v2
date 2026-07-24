// 图生视频前端 API 层(TanStack Query 包生成的 /bff/clip* client)。
// provider 目录 / 某源图的 take 列表(单图多视频)/ 发起生成 / 轮询任务 / 删除 take。
import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { BffGenerateClipRequest } from '@/generated/api-types'
import { deleteBffClip, generateBffClip, getBffClip, listBffClipProviders, listBffClips } from '@/generated/client'
import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'

/** provider 目录(全局,少变 → 长 staleTime)。 */
export function useClipProviders() {
  return useQuery({
    queryKey: queryKeys.clips.providers(),
    queryFn: () => listBffClipProviders({}),
    staleTime: 5 * 60_000,
    select: (d) => d.providers,
  })
}

/** 项目的 take 列表:传 sourceImageRef 只列该图;传 null 列全项目(供块→clip 反查绑定用)。 */
export function useProjectClips(projectId: string | null, sourceImageRef: string | null) {
  return useQuery({
    queryKey: queryKeys.clips.list(projectId ?? '', sourceImageRef ?? ''),
    queryFn: () => listBffClips({ query: { projectId: projectId!, sourceImageRef: sourceImageRef ?? undefined } }),
    enabled: !!projectId,
    select: (d) => d.clips,
  })
}

/** 发起一次生成 → 返回 { taskId, ... };轮询交给 useClipTask。 */
export function useGenerateClip() {
  return useMutation({
    mutationFn: (body: BffGenerateClipRequest) => generateBffClip({ body }),
  })
}

/** 轮询单个生成任务:queued/generating 每 1.2s 拉一次,done/error 停。 */
export function useClipTask(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.clips.task(taskId ?? ''),
    queryFn: () => getBffClip({ path: { taskId: taskId! } }),
    enabled: !!taskId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'done' || status === 'error' ? false : 1200
    },
  })
}

/** 让某项目的所有 take 列表失效(生成完成 / 删除后调用)。 */
export function invalidateProjectClips(projectId: string) {
  void queryClient.invalidateQueries({ queryKey: ['bff', 'clips', 'list', projectId] })
}

/**
 * 单槽生成任务的轮询 + 终态副作用:setTaskId 启动;done → 失效项目 clips + 成功提示 + 清槽;
 * error → 失败提示 + 清槽。单图面板与组的 sequence 任务共用(组的 batch N 任务轮询结构不同,不并入)。
 */
export function useClipTaskWatcher(projectId: string | null) {
  const { t } = useTranslation()
  const [taskId, setTaskId] = useState<string | null>(null)
  const task = useClipTask(taskId).data
  const generating = !!taskId && task?.status !== 'done' && task?.status !== 'error'
  useEffect(() => {
    if (!task || !projectId) return
    if (task.status === 'done') {
      invalidateProjectClips(projectId)
      toast.success(t('clipGen.done'))
      setTaskId(null)
    } else if (task.status === 'error') {
      toast.error(task.error || t('clipGen.failed'))
      setTaskId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.status])
  return { taskId, setTaskId, task, generating }
}

/** 删一条 take(记录 + 盘文件),成功后失效该项目 take 列表。 */
export function useDeleteClip() {
  return useMutation({
    mutationFn: ({ clipId, projectId }: { clipId: string; projectId: string }) =>
      deleteBffClip({ path: { clipId }, query: { projectId } }),
    onSuccess: (_r, { projectId }) => invalidateProjectClips(projectId),
  })
}
