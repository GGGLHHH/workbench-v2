import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import useEmblaCarousel from 'embla-carousel-react'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeft,
  Clapperboard,
  Clock,
  ExternalLink,
  Image as ImageIcon,
  Info,
  Loader2,
  MessageSquare,
  Pencil,
  Share2,
} from 'lucide-react'

import type { MetaDraft } from '@/components/project-nav/detail/meta-draft'
import { useNavActions, useStatusChangingId } from '@/components/project-nav/nav-context'
import { PanelBody } from '@/components/project-nav/shell'
import { Field, Group, Metric } from '@/components/project-nav/fields'
import { ProjectStatusMenu } from '@/components/project-nav/status-menu'
import { VisibilityMenu } from '@/components/project-nav/detail/visibility-menu'
import { AnalyticsPanel, PUBLISHED_STATUSES } from '@/components/project-nav/detail/analytics-panel'
import { detailToDraft, draftToMeta } from '@/components/project-nav/detail/meta-draft'
import { MetaForm } from '@/components/project-nav/detail/meta-form'
import { AssetGrid } from '@/components/project-nav/detail/asset-grid'
import { AgentAssetUploader } from '@/components/project-nav/detail/agent-asset-uploader'

import {
  useProject,
  useProjectOptions,
  useSaveProjectAssignee,
  useSaveProjectMeta,
  useSaveProjectVisibility,
} from '@/api/projects/projects'
import { absTime, relTime, usd } from '@/lib/format'
import { CommentPane } from '@/components/comment-pane'
import { useScrollFade } from '@/lib/use-scroll-fade'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Thumb, duration } from '@/components/media-card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { editorProjectRef } from '@/editor-app'
import type { ListingMeta } from '@/lib/video-overlays'
import { refreshBannerText } from '@/lib/video-overlays-store'
import { VideoOverlaysSection } from '@/components/project-nav/overlays/video-overlays-section'

// 详情面板:对齐 xchangeai-workbench 的 "Project details" 表单(ProjectMetaPanel)+ TopBar 摘要。
// 那边是弹窗,这里就地切换 view/edit —— 同样的元素,少一层模态。
export function DetailContent({ visible }: { visible: boolean }) {
  const { t } = useTranslation()
  // 易变态就地读:selectedId 走 URL,project/loading 直接订阅 useProject —— 不再从 ProjectNav 穿参。
  const selectedId = useSearch({ from: '/' }).project ?? null
  const detail = useProject(selectedId)
  const loading = detail.isPending && Boolean(selectedId)
  const project = detail.data
  const { backToList, changeProjectStatus } = useNavActions()
  // statusBusy 等价于旧 `changeStatus.isPending && changeStatus.variables?.id === selectedId`:
  // useStatusChangingId() 非 pending 时为 null,故 selectedId 为 null 时用守卫保持旧的 false。
  const changingId = useStatusChangingId()
  const statusBusy = selectedId != null && changingId === selectedId
  const [editing, setEditing] = useState(false)
  // 草稿提在这层(见 MetaDraft):乐观保存立刻关表单,失败原样重开都不丢用户输入。
  const [draft, setDraft] = useState<MetaDraft | null>(null)
  // 详情 / 评论 分两个可滑动 Tab:评论接入 comment-pane(自带滚动/虚拟/无限)需独占一块滚动区。
  // embla 做横向滑动(鼠标拖拽 / 触摸),两 slide 始终挂载 → scroll-fade / 虚拟化器不因切换卸载而失效。
  const [tab, setTab] = useState<'detail' | 'comments'>('detail')
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: 'start' })
  const options = useProjectOptions(visible && editing)
  const saveMeta = useSaveProjectMeta()
  const saveVisibility = useSaveProjectVisibility()
  const saveAssignee = useSaveProjectAssignee()
  const viewportRef = useRef<HTMLDivElement>(null)
  useScrollFade(viewportRef, 'vertical') // 详情上下阴影,与列表同一套
  const d = project?.detail

  // 换项目时退出编辑态,免得把 A 的草稿套在 B 上
  const id = project?.id
  useEffect(() => {
    setEditing(false)
    setTab('detail')
    emblaApi?.scrollTo(0, true) // 换项目回到「详情」slide,不停在上个项目的评论页
  }, [id, emblaApi])

  // embla ↔ Tab 双向同步:滑动落位改高亮;点 Tab 触发滑动(见 onValueChange)
  useEffect(() => {
    if (!emblaApi) return
    const onSelect = () => setTab(emblaApi.selectedScrollSnap() === 1 ? 'comments' : 'detail')
    emblaApi.on('select', onSelect)
    emblaApi.on('reInit', onSelect)
    onSelect()
    return () => {
      emblaApi.off('select', onSelect)
      emblaApi.off('reInit', onSelect)
    }
  }, [emblaApi])

  // 滑动激活线:拖动时按 embla 进度实时插值(跟手),hover 时滑到悬停 tab,松手/移开滑回激活项。
  // 自测 offsetLeft/Width 而非 base-ui Indicator —— 后者只跟随激活值,给不了「跟手 + hover」。
  const tabsListRef = useRef<HTMLDivElement>(null)
  const underlineRef = useRef<HTMLSpanElement>(null)
  const tabRefs = useRef<Array<HTMLElement | null>>([])
  const hoverRef = useRef<number | null>(null)
  const placeUnderline = useCallback(
    (animate: boolean) => {
      const el = underlineRef.current
      const a = tabRefs.current[0]
      const b = tabRefs.current[1]
      if (!el || !a || !b) return
      // 跟手时去掉过渡(逐帧直接设位);hover / 松手时保留过渡让它滑过去
      el.style.transition = animate ? '' : 'none'
      const hovered = hoverRef.current != null ? tabRefs.current[hoverRef.current] : null
      let left: number
      let width: number
      if (hovered) {
        left = hovered.offsetLeft
        width = hovered.offsetWidth
      } else {
        const raw = emblaApi ? emblaApi.scrollProgress() : 0
        const p = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0
        left = a.offsetLeft + (b.offsetLeft - a.offsetLeft) * p
        width = a.offsetWidth + (b.offsetWidth - a.offsetWidth) * p
      }
      el.style.transform = `translateX(${left}px)`
      el.style.width = `${width}px`
    },
    [emblaApi],
  )
  const hoverTab = (i: number | null) => {
    hoverRef.current = i
    placeUnderline(true)
  }
  useLayoutEffect(() => {
    placeUnderline(false)
    const ro = new ResizeObserver(() => placeUnderline(hoverRef.current != null))
    if (tabsListRef.current) ro.observe(tabsListRef.current)
    if (!emblaApi) return () => ro.disconnect()
    // 拖动 + 吸附全程逐帧跟随;但悬停时以 hover 为准 —— 否则 scroll/reInit(含评论 pane 高度变化触发的
    // 重排)会把线从悬停位「无过渡」拽回进度位,和 hover 目标反复打架 = 闪烁。
    const onScroll = () => {
      if (hoverRef.current == null) placeUnderline(false)
    }
    emblaApi.on('scroll', onScroll)
    emblaApi.on('reInit', onScroll)
    return () => {
      ro.disconnect()
      emblaApi.off('scroll', onScroll)
      emblaApi.off('reInit', onScroll)
    }
  }, [emblaApi, placeUnderline])

  // 地址两行:街道(address + address2)/ 城市州邮编 —— 与 BFF title() 的拼法同源
  const street = d ? [d.address, d.address2].filter(Boolean).join(' ') : ''
  const locality = d ? [[d.city, d.state].filter(Boolean).join(', '), d.postalCode].filter(Boolean).join(' ') : ''

  return (
    <PanelBody>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Info className="size-4" />
        <span className="flex-1 truncate text-sm font-medium">{t('projectNav.details')}</span>
        {d && !editing ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                setDraft(detailToDraft(d))
                setEditing(true)
                emblaApi?.scrollTo(0) // 编辑表单在「详情」slide,正停在评论页则滑回去
              }}
            >
              <Pencil className="size-3.5" /> {t('common.edit')}
            </Button>
          </>
        ) : null}
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={backToList}>
          <ChevronLeft className="size-3.5" /> {t('projectNav.list')}
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => emblaApi?.scrollTo(v === 'comments' ? 1 : 0)}
        className="min-h-0 flex-1"
      >
        <TabsList
          ref={tabsListRef}
          variant="line"
          className="mx-3 mt-1.5 shrink-0 justify-start"
          onMouseLeave={() => hoverTab(null)}
        >
          <TabsTrigger
            value="detail"
            ref={(el) => {
              tabRefs.current[0] = el
            }}
            onMouseEnter={() => hoverTab(0)}
          >
            {t('projectNav.details')}
          </TabsTrigger>
          <TabsTrigger
            value="comments"
            ref={(el) => {
              tabRefs.current[1] = el
            }}
            onMouseEnter={() => hoverTab(1)}
          >
            {t('projectNav.comments')}{d?.commentCount ? ` (${d.commentCount})` : ''}
          </TabsTrigger>
          <span
            ref={underlineRef}
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 z-0 h-0.5 w-0 rounded-full bg-foreground transition-[transform,width] duration-200 ease-out"
          />
        </TabsList>
        {/* embla 横向滑动切 Tab:两 slide 始终挂载(scroll-fade / 虚拟化器不因切换卸载而失效) */}
        <div ref={emblaRef} className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full">
            <div className="flex min-w-0 flex-[0_0_100%] flex-col">
              <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1">
                <div className="p-3">
                  {loading || !project || !d ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
                    </div>
                  ) : editing && draft ? (
                    <MetaForm
                      value={draft}
                      onChange={setDraft}
                      options={options.data}
                      optionsLoading={options.isPending}
                      onCancel={() => setEditing(false)}
                      // 乐观:立刻关表单(onMutate 已把草稿值 patch 进 detail 缓存,只读视图即时显示);
                      // 失败时 onError 重开表单 —— 草稿提在本层没丢,原样恢复让用户改了重试。
                      onSave={() => {
                        setEditing(false)
                        const meta = draftToMeta(draft)
                        saveMeta.mutate({ id: project.id, meta }, { onError: () => setEditing(true) })
                        // 价格/床浴等改了 → 若横幅开着就重烘焙其文案(仅限编辑器已加载本项目时)
                        if (editorProjectRef.id === project.id) refreshBannerText(meta as ListingMeta)
                      }}
                    />
                  ) : (
                    <div className="flex flex-col gap-4">
                      {/* 概要:缩略图 + 标题 + 状态菜单(与列表卡片同一个 FSM 菜单) */}
                      <div className="flex gap-3">
                        <Thumb url={d.thumbnailUrl ?? null} kind={d.thumbnailKind ?? null} className="size-16" />
                        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                          <div className="line-clamp-2 text-sm font-semibold" title={project.name}>
                            {project.name}
                          </div>
                          <ProjectStatusMenu
                            status={d.status}
                            busy={statusBusy}
                            onAction={(action) => changeProjectStatus(project.id, action)}
                          />
                          {d.statusUpdatedBy ? (
                            <span className="text-[11px] text-muted-foreground">{t('projectNav.changedBy', { by: d.statusUpdatedBy })}</span>
                          ) : null}
                          {/* 被拒时直达 xchangeai 评审页看驳回意见 —— 否则只能自己去后台翻 */}
                          {d.reviewUrl ? (
                            <a
                              href={d.reviewUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                            >
                              {t('projectNav.viewRejection')} <ExternalLink className="size-3" />
                            </a>
                          ) : null}
                        </div>
                      </div>

                      {/* 统计:对齐 TopBar 的 "N photos · N clips · duration",再补评论/转发/可见性 */}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <ImageIcon className="size-3" /> {d.resourceCount} resources
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clapperboard className="size-3" /> {d.clipCount} clips
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" /> {duration(d.durationSeconds)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare className="size-3" /> {d.commentCount} comments
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Share2 className="size-3" /> {d.forwardCount} forwards
                        </span>
                        <VisibilityMenu
                          visibility={d.visibility ?? null}
                          busy={saveVisibility.isPending}
                          onChange={(visibility) => saveVisibility.mutate({ id: project.id, visibility })}
                        />
                      </div>

                      <Separator />

                      <Group title="Listing">
                        <Field label="List price" value={usd(d.price)} />
                        <Field label="Address" value={street} />
                        <Field label="City / State" value={locality} />
                        <Field label="Property type" value={d.propertyType} />
                        <Field label="Video style" value={d.videoStyle} />
                        <Field
                          label="Listing URL"
                          value={
                            d.listingUrl ? (
                              <a
                                href={d.listingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-full items-center gap-1 truncate underline underline-offset-2 hover:text-foreground"
                              >
                                <span className="truncate">{d.listingUrl}</span>
                                <ExternalLink className="size-3 shrink-0" />
                              </a>
                            ) : null
                          }
                        />
                      </Group>

                      <div className="grid grid-cols-3 gap-2">
                        <Metric label="Beds" value={d.bedrooms} />
                        <Metric label="Baths" value={d.bathrooms} />
                        <Metric label="Sqft" value={d.livingAreaSqft?.toLocaleString()} />
                      </div>

                      <Separator />

                      <VideoOverlaysSection project={project} />

                      <Separator />

                      <Group title="People">
                        <Field label="Agency" value={d.agency} />
                        <Field label="Agent" value={d.agent} />
                        {/* 就地认领/取消指派:改一个人不必为此进整张编辑表单(那是 15 个字段的全量替换)。
                            认领只在 prepared 态给 —— 上游 assignProjectToSelf 别的状态一律 409,
                            与其让人点了撞错,不如不给按钮(legacy 的状态菜单也只在 prepared 提供 Claim)。
                            取消指派没有状态约束,任何时候都能撤。 */}
                        <Field
                          label="Assigned creator"
                          value={
                            <span className="inline-flex items-center gap-1.5">
                              {d.assignee}
                              {d.assignee || d.status === 'prepared' ? (
                                <button
                                  type="button"
                                  disabled={saveAssignee.isPending}
                                  onClick={() =>
                                    saveAssignee.mutate({ id: project.id, assigneeId: d.assignee ? null : 'me' })
                                  }
                                  className="text-primary hover:underline disabled:opacity-50"
                                >
                                  {saveAssignee.isPending ? '…' : d.assignee ? t('projectNav.unassign') : t('projectNav.claim')}
                                </button>
                              ) : null}
                            </span>
                          }
                        />
                        <Field label="Created by" value={d.createdBy} />
                      </Group>

                      {d.assets && d.assets.length > 0 ? (
                        <>
                          <Separator />
                          <AssetGrid projectId={project.id} assets={d.assets} />
                        </>
                      ) : null}

                      <Separator />
                      <AgentAssetUploader projectId={project.id} />

                      <Separator />

                      <Group title="Timestamps">
                        <Field label="Created" value={absTime(d.createdAt)} />
                        <Field label="Updated" value={`${absTime(d.updatedAt)} (${relTime(d.updatedAt)})`} />
                      </Group>

                      {/* 只有发布过的项目才有观看数据,没发布的连请求都不发 */}
                      {PUBLISHED_STATUSES.has(d.status) ? (
                        <>
                          <Separator />
                          <AnalyticsPanel projectId={project.id} enabled={visible} />
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
            <div className="flex min-w-0 flex-[0_0_100%] flex-col p-3">
              {/* enabled 跟面板可见即拉 → 首次滑到评论已在底、无加载闪;非激活 slide 也常驻不卸载 */}
              {project && d ? (
                <CommentPane
                  entity="project"
                  id={project.id}
                  total={d.commentCount ?? 0}
                  enabled={visible}
                  className="flex min-h-0 flex-1 flex-col"
                />
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
                </div>
              )}
            </div>
          </div>
        </div>
      </Tabs>
    </PanelBody>
  )
}
