// Prompt Assist 前端 API 层:给选中源图 AI 生成/改写运镜 promptBody。
// 一次性 mutation(非查询),成功后由调用方把 suggestedPrompt 填进文本框;warnings/mock 供提示。
import { useMutation } from '@tanstack/react-query'
import type { BffPromptAssistRequest } from '@/generated/api-types'
import { assistBffClipPrompt } from '@/generated/client'

export function useClipPromptAssist() {
  return useMutation({
    mutationFn: (body: BffPromptAssistRequest) => assistBffClipPrompt({ body }),
  })
}
