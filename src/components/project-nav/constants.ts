// 负责人筛选(替代原状态 tab)。'' 全部 | 'unassigned' 未指派(可认领) | 'me' 指派给我。
// 'me' 在查询时解析成当前会话 user.id(见 ProjectNav);URL 存哨兵值,分享链接天然按查看者解析。
export const ASSIGNEE_FILTERS = [
  { id: '', labelKey: 'projectNav.filterAll' },
  { id: 'unassigned', labelKey: 'projectNav.filterUnassigned' },
  { id: 'me', labelKey: 'projectNav.filterMine' },
] as const

// 状态徽章配色(暗色适配自 xchangeai-workbench 的浅色语义:assigned=蓝 / approved=绿 …)
export const STATUS_STYLE: Record<string, string> = {
  created: 'bg-zinc-500/15 text-zinc-300',
  prepared: 'bg-slate-500/15 text-slate-300',
  assigned: 'bg-blue-500/15 text-blue-400',
  in_progress: 'bg-indigo-500/15 text-indigo-400',
  generated: 'bg-violet-500/15 text-violet-400',
  ready_for_review: 'bg-amber-500/15 text-amber-400',
  reviewing: 'bg-sky-500/15 text-sky-400',
  approved: 'bg-emerald-500/15 text-emerald-400',
  published: 'bg-teal-500/15 text-teal-400',
  rejected: 'bg-red-500/15 text-red-400',
}

// 每个状态可执行的 FSM 动作(对齐 xchangeai-workbench projectStatus.js;后端再校验合法性)。
// tone=primary 是该状态下的主推动作;confirm 有值的动作点第一次只把菜单项文案换成问句,
// 再点一次才真发 —— 与 legacy 一致,也比 window.confirm 好:不夺焦点、不阻塞其余菜单项。
export type StatusAction = { action: string; label: string; primary?: boolean; confirm?: string }
export const STATUS_ACTIONS: Record<string, StatusAction[]> = {
  created: [
    { action: 'start_work', label: 'Start work', primary: true },
    { action: 'prepare', label: 'Prepare project' },
  ],
  prepared: [
    { action: 'start_work', label: 'Start work', primary: true },
    { action: 'assign', label: 'Claim project' },
    { action: 'revert', label: 'Revert to created' },
  ],
  assigned: [
    { action: 'start_work', label: 'Start work', primary: true },
    { action: 'revert', label: 'Revert to prepared' },
  ],
  in_progress: [
    { action: 'generate', label: 'Generate', primary: true },
    { action: 'fail', label: 'Mark generation failed', confirm: 'Mark this project generation as failed?' },
    { action: 'revert', label: 'Revert to assigned' },
  ],
  generated: [
    { action: 'submit_review', label: 'Submit for review', primary: true },
    { action: 'revert', label: 'Revert to in progress' },
  ],
  ready_for_review: [
    { action: 'start_review', label: 'Start review', primary: true },
    { action: 'revert', label: 'Revert to generated' },
  ],
  reviewing: [
    { action: 'approve', label: 'Approve', primary: true },
    { action: 'reject', label: 'Reject', confirm: 'Reject this project and send it back?' },
    { action: 'revert', label: 'Revert to ready for review' },
  ],
  approved: [
    { action: 'publish', label: 'Publish', primary: true },
    { action: 'revert', label: 'Revert to reviewing' },
  ],
  rejected: [{ action: 'reassign', label: 'Send back to creator', primary: true }],
  published: [{ action: 'revert', label: 'Revert to approved' }],
}

// 排序选项。只留服务端支持的两个时间字段(xchangeai 的 SortBy 枚举就只有 created_at /
// updated_at)。按名字排已移除:它原先是在"已加载的那部分"上排,滚出去的部分不参与,
// 本就半残;改成按页随机访问后更没有意义 —— 排序必须整份数据在服务端做。
export const SORT_OPTIONS = [
  { value: 'created_desc', label: 'Recently created' },
  { value: 'updated_desc', label: 'Recently updated' },
]

/** 供路由 validateSearch 校验 URL 上的 sort —— 脏值会让 Select 显示空白 */
export const SORT_VALUES = SORT_OPTIONS.map((o) => o.value)

// 卡片定高:缩略图 56 + 两行元信息 + 底栏 = 115,行间距 8。
// 标题是 truncate 不换行、面板定宽,实测 70 行全是 115,故按定高处理。
export const ROW_HEIGHT = 115
export const ROW_GAP = 8
