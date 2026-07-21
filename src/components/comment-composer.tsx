import { useRef, useState } from 'react'
import { Loader2, Paperclip, SendHorizontal, X } from 'lucide-react'
import { toast } from 'sonner'

import { uploadAttachment, useCreateComment } from '@/api/projects/projects'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'

// 评论输入框(项目面板与资产时间线共用)。自持 draft + 附件三态 + 发送 mutation。
// 对齐 xchangeai-web:Enter 发送 / Shift+Enter 换行、有附件时空正文也能发、附件在传/传挂了不放行。
const MAX_LENGTH = 5000
const MAX_ATTACHMENTS = 8
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

// 待发送附件。contentId 在上传落库后才有 —— 它就是「能不能发」的判据。
type Draft = { key: string; file: File; status: 'uploading' | 'done' | 'failed'; contentId: string | null }

export function CommentComposer({
  entity,
  id,
  onPosted,
  className,
}: {
  entity: 'project' | 'asset'
  id: string | null
  onPosted?: () => void
  className?: string
}) {
  const create = useCreateComment(entity)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Draft[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 每个文件独立并发上传,各自带三态 —— 一个失败不该拖住其余的
  const pickFiles = async (files: FileList) => {
    const room = MAX_ATTACHMENTS - attachments.length
    const chosen = [...files].slice(0, room)
    if (chosen.some((f) => f.size > MAX_ATTACHMENT_BYTES))
      toast.error(`单个附件不能超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`)
    const ok = chosen.filter((f) => f.size <= MAX_ATTACHMENT_BYTES)
    if (!ok.length) return
    const seeded: Draft[] = ok.map((file, i) => ({
      key: `${Date.now()}:${i}:${file.name}`,
      file,
      status: 'uploading',
      contentId: null,
    }))
    setAttachments((cur) => [...cur, ...seeded])
    await Promise.all(
      seeded.map(async (d) => {
        try {
          const contentId = await uploadAttachment(d.file)
          setAttachments((cur) => cur.map((a) => (a.key === d.key ? { ...a, status: 'done', contentId } : a)))
        } catch {
          setAttachments((cur) => cur.map((a) => (a.key === d.key ? { ...a, status: 'failed' } : a)))
        }
      }),
    )
  }

  const canSend =
    (draft.trim() || attachments.some((a) => a.status === 'done')) &&
    !attachments.some((a) => a.status !== 'done') &&
    !create.isPending &&
    Boolean(id)

  const submit = () => {
    if (!canSend || !id) return
    const attachmentContentIds = attachments.map((a) => a.contentId!).filter(Boolean)
    setDraft('')
    setAttachments([])
    create.mutate({ id, content: draft.trim(), attachmentContentIds })
    onPosted?.()
    textareaRef.current?.focus() // 发送后把焦点还给输入框,连着写下一条不用再点
  }

  return (
    <>
      {/* 隐藏文件选择器,点回形针触发。放在 InputGroup 外 —— 免得它的 >input 选择器把它当成输入控件 */}
      <Input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) void pickFiles(event.target.files)
          event.target.value = '' // 清空才能连续选同一批文件
        }}
      />
      <InputGroup className={className}>
        {attachments.length ? (
          <InputGroupAddon align="block-start" className="flex-wrap gap-1">
            {attachments.map((a) => (
              <span
                key={a.key}
                title={a.file.name}
                className={cn(
                  'inline-flex max-w-32 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]',
                  a.status === 'failed' && 'text-destructive',
                )}
              >
                {a.status === 'uploading' ? <Loader2 className="size-2.5 shrink-0 animate-spin" /> : null}
                <span className="truncate">{a.file.name}</span>
                <button
                  type="button"
                  aria-label={`移除附件 ${a.file.name}`}
                  onClick={() => setAttachments((cur) => cur.filter((x) => x.key !== a.key))}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </InputGroupAddon>
        ) : null}
        <InputGroupTextarea
          ref={textareaRef}
          value={draft}
          disabled={!id}
          placeholder="写下评论…"
          rows={1}
          maxLength={MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          className="max-h-20 min-h-0 text-xs"
        />
        <InputGroupAddon align="block-end">
          {/* 回形针/发送的独立禁用态用 aria-disabled 而非原生 disabled:InputGroup 的 has-[:disabled]
              会把整框置灰,而这两个按钮不可用时只该置灰它自己(整框是否可用由 textarea disabled 决定) */}
          <InputGroupButton
            size="icon-xs"
            aria-disabled={attachments.length >= MAX_ATTACHMENTS}
            onClick={() => fileRef.current?.click()}
            aria-label="添加附件"
            title={`最多 ${MAX_ATTACHMENTS} 个,单个不超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            <Paperclip className="size-3.5" />
          </InputGroupButton>
          <InputGroupButton
            size="icon-xs"
            variant="default"
            aria-disabled={!canSend}
            onClick={submit}
            aria-label="发表评论"
            className="ml-auto aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <SendHorizontal className="size-3.5" />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </>
  )
}
