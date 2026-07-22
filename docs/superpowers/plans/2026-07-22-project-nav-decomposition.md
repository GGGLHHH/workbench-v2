# project-nav.tsx 拆分封装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 2034 行的 `src/components/project-nav.tsx` god-file 拆成 `src/components/project-nav/`(list/detail/overlays 子目录)下的聚焦模块,并用 nav Context 消解 prop-drilling,行为完全不变。

**Architecture:** 先按内聚把纯叶子(格式化/类型/常量/展示原语)、自包含面板(overlays/菜单/表单/资产网格)、memo 件(卡片/列表)逐个 verbatim 搬出,每步只改文件位置与 import,项目仍由旧 `project-nav.tsx` 编排。全部搬完后新增 `nav-context.tsx`(稳定回调 + 独立的 pending-id 两个 context),把编排器包成 Provider,再让 list/detail 消费者改读 context + 就地 hook、丢掉穿层 props,最后把编排器迁到 `index.tsx` 并更新 `app-shell` 的 import。

**Tech Stack:** React 19 + TypeScript(verbatimModuleSyntax 全开)· TanStack Router(URL search 状态)· TanStack Query · TanStack Virtual · zustand(editorStore 单例)· vitest · pnpm · vite。

## Global Constraints

以下 6 条为项目级硬约束,**每个任务隐含包含**,逐字来自 spec:

1. **路由↔nav 编译环:** `SORT_VALUES` 是 value 导出给 `src/routes/index.tsx` 的 `validateSearch`,nav 反手 `import type { ProjectSearch }` from `@/routes/index`。此环仅靠 type-only import 被 `verbatimModuleSyntax` 擦除才无害。→ `constants.ts` 必须**无任何组件 import**;`ProjectSearch`/`ProjectListParams` 必须 `import type`。
2. **verbatimModuleSyntax 全开**(tsconfig.app/.bff/.node/.server):每个类型导入必须 `import type` 或内联 `type` 标记,否则构建失败。
3. **memo 契约(虚拟滚动性能载体):** `ListHeader`、`ProjectCard` 是 `React.memo`,依赖 ProjectNav 里 `useCallback` 的稳定 identity + `useProjectPages` 的 `itemAt`/`refetch` 稳定引用。搬文件不得引入新包裹组件/内联 lambda 破坏这些 identity。`ProjectCard` 绝不能读 `useSearch`(会导致每次打字全表重渲染)——`active`/`busy` 始终作为直接 props 从虚拟化循环流入。
4. **editor-app 单例单向:** overlays 代码 by-value 引 `editorStore`/`editorProjectRef` from `@/editor-app`,依赖严格单向 `project-nav → editor-app`,**绝不能反向**。
5. **渲染 bundle 隔离:** `video-overlays-section` 留 app 侧(可用 `@/`),只经 `src/overlays/overlay-design.ts` 的 data schema 与渲染器对话;不得让 `@/`/react-query/router/i18n 泄入 `src/overlays/*`。
6. **纯变换分层:** `UI → video-overlays-store`(副作用 dispatch)`→ video-overlays.ts`(纯)。抽 overlays UI 时不得把 `editorStore.getState().updateUndoable` 内联进纯模块。

## Verification Recipe

每个任务末尾的"验证"步骤统一指这套(命令在 `workbench-v2/` 根跑):

- `pnpm typecheck` → 期望:**0 errors**(`tsc -b` 静默退出)
- `pnpm test` → 期望:全部通过(基线 49 个 + 本计划新增的)
- **高风险任务(Task 8–14)额外:** `pnpm build` → 期望成功;并做浏览器冒烟(见各任务)。

组件搬移无单测,故"测试"= typecheck + 既有 test 全绿 + build。纯函数抽取(Task 1、Task 6)按 TDD 先写失败测试。

## File Structure(拆分后)

```
src/components/project-nav/
  index.tsx            ProjectNav = Provider + shell 组装(Task 14)
  nav-context.tsx      NavActions context + StatusChanging context(Task 11)
  types.ts             Panel / ProjectSummary / Anchor(Task 2)
  constants.ts         StatusAction / ASSIGNEE_FILTERS / STATUS_STYLE / STATUS_ACTIONS /
                       SORT_OPTIONS / SORT_VALUES / ROW_HEIGHT / ROW_GAP(Task 2)
  shell.tsx            Section / Layer / CollapseToggle / Rail / PanelBody(Task 3)
  fields.tsx           Group / Field / Metric / Row(Task 3)
  status-menu.tsx      ProjectStatusMenu(Task 5)
  list/
    list-content.tsx   ListContent + readAnchor/writeAnchor(inline)(Task 9)
    list-header.tsx    ListHeader(Task 9)
    project-card.tsx   ProjectCard(Task 8)
  detail/
    detail-content.tsx DetailContent(Task 10)
    meta-form.tsx      MetaForm(Task 6)
    meta-draft.ts      MetaDraft + num/detailToDraft/draftToMeta(Task 6)
    asset-grid.tsx     AssetGrid + ReviewBadge(Task 7)
    visibility-menu.tsx VisibilityMenu + VISIBILITY_OPTIONS(Task 5)
    analytics-panel.tsx AnalyticsPanel + Trend + PUBLISHED_STATUSES(Task 5)
  overlays/
    video-overlays-section.tsx  VideoOverlaysSection + useOverlayConfig /
                       OverlaySwitchRow / ColorInput / ScaleToggle / CORNER_ARROW(Task 4)
src/lib/
  format.ts            statusLabel / relTime / absTime / usd(Task 1)
  format.test.ts       (Task 1)
  video-overlays.ts    += toMeta, sameOverlay(Task 4)
```

**放置约定:** 子目录 = 面板专属;项目根(`project-nav/` 直下)= 跨面板共享。单读者常量就近 colocate(VISIBILITY_OPTIONS/PUBLISHED_STATUSES/CORNER_ARROW),仅共享或路由耦合的进 `constants.ts`。

---

## Task 1: 抽取通用格式化到 `lib/format.ts`(TDD)

**Files:**
- Create: `src/lib/format.ts`
- Create: `src/lib/format.test.ts`
- Modify: `src/components/project-nav.tsx`(删除 181-205 的 statusLabel/relTime/absTime/usd,改为 import)

**Interfaces:**
- Produces:
  - `statusLabel(status: string): string`
  - `relTime(iso: string): string`
  - `absTime(iso: string): string`
  - `usd(n: number | null | undefined): string | null`

- [ ] **Step 1: 写失败测试** — 创建 `src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { absTime, relTime, statusLabel, usd } from './format'

describe('statusLabel', () => {
  it('下划线换空格', () => {
    expect(statusLabel('ready_for_review')).toBe('ready for review')
  })
})

describe('usd', () => {
  it('整数美元、无小数', () => {
    expect(usd(1250000)).toBe('$1,250,000')
  })
  it('非数字返回 null', () => {
    expect(usd(null)).toBeNull()
    expect(usd(undefined)).toBeNull()
  })
})

describe('absTime', () => {
  it('格式化为 yyyy-MM-dd HH:mm', () => {
    expect(absTime('2026-07-20T19:30:00Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
  it('无法解析时原样返回', () => {
    expect(absTime('not-a-date')).toBe('not-a-date')
  })
})

describe('relTime', () => {
  it('无法解析时原样返回', () => {
    expect(relTime('not-a-date')).toBe('not-a-date')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/lib/format.test.ts`
Expected: FAIL —— `Failed to resolve import "./format"`.

- [ ] **Step 3: 写实现** — 创建 `src/lib/format.ts`(verbatim 自 project-nav.tsx 181-205):

```ts
import { format, formatDistanceToNow } from 'date-fns'

/** 状态串人类化:下划线换空格 */
export const statusLabel = (status: string) => status.replaceAll('_', ' ')

/** 相对时间(date-fns),如 "5 minutes ago";解析失败原样返回 */
export const relTime = (iso: string) => {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return iso
  }
}

/** 绝对时间 yyyy-MM-dd HH:mm(本地时区);解析失败原样返回 */
export const absTime = (iso: string) => {
  try {
    return format(new Date(iso), 'yyyy-MM-dd HH:mm')
  } catch {
    return iso
  }
}

/** 价格:Intl USD、无小数;非数字返回 null */
export const usd = (n: number | null | undefined) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
    : null
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/lib/format.test.ts`
Expected: PASS(4 个 describe 全绿)。

- [ ] **Step 5: 改 project-nav.tsx 引用新模块** — 删除 181-205 行的四个本地定义;在 import 区加:

```ts
import { absTime, relTime, statusLabel, usd } from '@/lib/format'
```

- [ ] **Step 6: 验证**(Verification Recipe:`pnpm typecheck` 0 errors、`pnpm test` 全绿)

- [ ] **Step 7: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): extract date/price/status formatters to lib/format

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 抽取 `types.ts` + `constants.ts`,路由改引 SORT_VALUES

**Files:**
- Create: `src/components/project-nav/types.ts`
- Create: `src/components/project-nav/constants.ts`
- Modify: `src/components/project-nav.tsx`(删除搬走的 type/const,改 import;`SORT_VALUES` 的 `export` 去掉)
- Modify: `src/routes/index.tsx`(把 `import { SORT_VALUES } from '@/components/project-nav'` 改指 `constants`)

**Interfaces:**
- Produces(`types.ts`):`type Panel = 'list' | 'detail'`;`type ProjectSummary`(见下);`type Anchor = { index: number; offsetInItem: number }`
- Produces(`constants.ts`):`type StatusAction`;`ASSIGNEE_FILTERS`;`STATUS_STYLE: Record<string,string>`;`STATUS_ACTIONS: Record<string, StatusAction[]>`;`SORT_OPTIONS`;`SORT_VALUES: string[]`;`ROW_HEIGHT: number`;`ROW_GAP: number`
- Consumes:`src/routes/index.tsx` 现有 `validateSearch` 用 `SORT_VALUES`。

- [ ] **Step 1: 建 `types.ts`** — verbatim 搬 project-nav.tsx 的 `Panel`(100)、`ProjectSummary`(101-113)、`Anchor`(225):

```ts
export type Panel = 'list' | 'detail'

export type ProjectSummary = {
  id: string
  title: string
  assignee: string | null
  agency: string | null
  status: string
  resourceCount: number
  clipCount: number
  durationSeconds: number
  thumbnailUrl: string | null
  thumbnailKind: string | null
  updatedAt: string
}

// 视口顶部那一条 + 视口切在它内部的像素偏移(存这个而非 scrollTop,行高实测修正后仍稳)
export type Anchor = { index: number; offsetInItem: number }
```

- [ ] **Step 2: 建 `constants.ts`** — verbatim 搬 `StatusAction`(140)、`ASSIGNEE_FILTERS`(117-121)、`STATUS_STYLE`(124-135)、`STATUS_ACTIONS`(141-179)、`SORT_OPTIONS`(210-213)、`SORT_VALUES`(216)、`ROW_HEIGHT`/`ROW_GAP`(220-221)。**保持零组件 import(硬约束 1)。** 结构:

```ts
export const ASSIGNEE_FILTERS = [
  { id: '', labelKey: 'projectNav.filterAll' },
  { id: 'unassigned', labelKey: 'projectNav.filterUnassigned' },
  { id: 'me', labelKey: 'projectNav.filterMine' },
] as const

export const STATUS_STYLE: Record<string, string> = {
  /* …verbatim 124-135… */
}

export type StatusAction = { action: string; label: string; primary?: boolean; confirm?: string }
export const STATUS_ACTIONS: Record<string, StatusAction[]> = {
  /* …verbatim 141-179… */
}

export const SORT_OPTIONS = [
  { value: 'created_desc', label: 'Recently created' },
  { value: 'updated_desc', label: 'Recently updated' },
]

/** 供路由 validateSearch 校验 URL 上的 sort */
export const SORT_VALUES = SORT_OPTIONS.map((o) => o.value)

export const ROW_HEIGHT = 115
export const ROW_GAP = 8
```

- [ ] **Step 3: 改 project-nav.tsx** — 删除上述搬走的定义(含 216 行 `export const SORT_VALUES`,现在改成从 constants import);import 区加:

```ts
import type { Anchor, Panel, ProjectSummary } from '@/components/project-nav/types'
import {
  ASSIGNEE_FILTERS,
  ROW_GAP,
  ROW_HEIGHT,
  SORT_OPTIONS,
  STATUS_ACTIONS,
  STATUS_STYLE,
  type StatusAction,
} from '@/components/project-nav/constants'
```

> 注意:`Panel`/`ProjectSummary`/`Anchor`/`StatusAction` 是类型 → 用 `import type` 或内联 `type`(硬约束 2)。

- [ ] **Step 4: 改路由引用** — `src/routes/index.tsx` 里把 `SORT_VALUES` 的 import 源从 `@/components/project-nav` 改为 `@/components/project-nav/constants`:

```ts
import { SORT_VALUES } from '@/components/project-nav/constants'
```

Run 定位当前 import 行:`grep -n "SORT_VALUES" src/routes/index.tsx`

- [ ] **Step 5: 验证**(Recipe)。**额外确认无环:** `pnpm build` 成功(routes ↔ constants 只有 value 边,nav↔routes 只剩被擦除的 type 边)。

- [ ] **Step 6: Commit**

```bash
git add src/components/project-nav/types.ts src/components/project-nav/constants.ts src/components/project-nav.tsx src/routes/index.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): extract types.ts and constants.ts, route imports SORT_VALUES from leaf

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 抽取 `shell.tsx`(布局原语)+ `fields.tsx`(展示原语)

**Files:**
- Create: `src/components/project-nav/shell.tsx`
- Create: `src/components/project-nav/fields.tsx`
- Modify: `src/components/project-nav.tsx`

**Interfaces:**
- Produces(`shell.tsx`):`Section`、`Layer`、`CollapseToggle`、`Rail`、`PanelBody`(props 与现状一致)。
- Produces(`fields.tsx`):`Group`、`Field`、`Metric`、`Row`。
- Consumes:`@/lib/utils` 的 `cn`、`@/components/ui/button` 的 `Button`、`react-i18next` 的 `useTranslation`、`lucide-react` 图标。

- [ ] **Step 1: 建 `shell.tsx`** — verbatim 搬 `Section`(382-410)、`Layer`(414-436)、`CollapseToggle`(439-455)、`Rail`(458-489)、`PanelBody`(492-494),连同它们的注释块(376-381 等)。补齐该文件自身 import:

```ts
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
```

每个组件加 `export`。

- [ ] **Step 2: 建 `fields.tsx`** — verbatim 搬 `Group`(1024-1031)、`Field`(1033-1040)、`Metric`(1043-1050)、`Row`(1490-1497)。import:

```ts
import type React from 'react'
import { Label } from '@/components/ui/label'
```

每个组件加 `export`。

- [ ] **Step 3: 改 project-nav.tsx** — 删除上述 9 个定义;import 区加:

```ts
import { CollapseToggle, Layer, PanelBody, Rail, Section } from '@/components/project-nav/shell'
import { Field, Group, Metric, Row } from '@/components/project-nav/fields'
```

> `PanelLeftClose/PanelLeftOpen`、`Label` 若在 project-nav.tsx 里已无其它用处,从其 import 中移除,避免 unused 报错(typecheck 会报)。

- [ ] **Step 4: 验证**(Recipe)。

- [ ] **Step 5: Commit**

```bash
git add src/components/project-nav/shell.tsx src/components/project-nav/fields.tsx src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): extract shell layout primitives and detail field primitives

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 抽取 `overlays/video-overlays-section.tsx`,纯函数折进 lib

**Files:**
- Create: `src/components/project-nav/overlays/video-overlays-section.tsx`
- Modify: `src/lib/video-overlays.ts`(追加 `toMeta`、`sameOverlay`)
- Modify: `src/lib/video-overlays.test.ts`(为 `sameOverlay` 加 1 条 assert)
- Modify: `src/components/project-nav.tsx`

**Interfaces:**
- Produces(`video-overlays-section.tsx`):`VideoOverlaysSection: React.FC<{ project: BffProject }>`。
- Produces(`lib/video-overlays.ts`):`toMeta(project: BffProject): ListingMeta`;`sameOverlay(a: OverlayConfig, b: OverlayConfig): boolean`。
- Consumes:`useOverlayConfig` 内部读 `editorStore`/`editorProjectRef`(`@/editor-app`,by-value,硬约束 4)+ `readOverlayConfig`(`@/lib/video-overlays`);dispatch 走 `@/lib/video-overlays-store`(硬约束 6)。

- [ ] **Step 1: 把 `toMeta`/`sameOverlay` 追加进 `src/lib/video-overlays.ts`** — verbatim 搬 project-nav.tsx 1055-1069、1071-1087,`export function` 导出。`toMeta` 需 `import type { BffProject } from '@/generated/api-types'`(video-overlays.ts 是 lib,`@/` 可用)。`sameOverlay` 用同文件已有的 `OverlayConfig`。

- [ ] **Step 2: 给 `sameOverlay` 加一条测试** — 在 `src/lib/video-overlays.test.ts` 追加:

```ts
import { sameOverlay } from './video-overlays'
// …
describe('sameOverlay', () => {
  it('banner.opacity 不同 → false', () => {
    const base = readOverlayConfig(/* 用文件里已有的构造/默认 config helper */)
    expect(sameOverlay(base, base)).toBe(true)
    expect(sameOverlay(base, { ...base, banner: { ...base.banner, opacity: base.banner.opacity + 0.1 } })).toBe(false)
  })
})
```

> 执行者:若文件已有构造 `OverlayConfig` 的 helper 就复用;否则手写一个最小 `OverlayConfig` 字面量。跑 `pnpm test src/lib/video-overlays.test.ts` 确认新用例先失败(sameOverlay 未导出)再通过。

- [ ] **Step 3: 建 `overlays/video-overlays-section.tsx`** — verbatim 搬 `useOverlayConfig`(1091-1106)、`OverlaySwitchRow`(1108-1130)、`ColorInput`(1132-1155)、`CORNER_ARROW`(1157-1162)、`ScaleToggle`(1165-1177)、`VideoOverlaysSection`(1179-1338)。`VideoOverlaysSection` 加 `export`;其余按需 `export`(仅同文件用则不必)。补该文件 import(从原 project-nav.tsx 的 import 区筛出这些单元实际用到的):`useVideoConfig` 无关(那是 renderer);此处需要 `useTranslation`、`useMemo/useState/useEffect/useRef`、`toast`、`Switch/Slider/ToggleGroup/ToggleGroupItem/Button`、`Loader2/CloudDownload`、`@/editor-app` 的 `editorStore`/`editorProjectRef`、`@/lib/video-overlays` 的 `readOverlayConfig`/`WM_CORNERS` 及 `toMeta`/`sameOverlay` 及类型、`@/lib/video-overlays-store` 的 `setBanner/setCover/setEndCover/setCoverScale/setWatermark`、`@/api/projects/projects` 的 `uploadAttachment`。

> **硬约束 5:** 本文件在 app 侧,可用 `@/`;它只经 store/lib 与渲染器隔离对话,不 import `src/overlays/*`。

- [ ] **Step 4: 改 project-nav.tsx** — 删除 1055-1087(toMeta/sameOverlay,已移 lib)、1089-1338(overlays 区);import 区加:

```ts
import { VideoOverlaysSection } from '@/components/project-nav/overlays/video-overlays-section'
```

移除 project-nav.tsx 里因搬走而不再用到的 import(`Switch/Slider/ToggleGroup/…/CloudDownload/uploadAttachment/readOverlayConfig/WM_CORNERS/setBanner…` 等——由 typecheck 的 unused 报错逐个清理)。

- [ ] **Step 5: 验证**(Recipe)。

- [ ] **Step 6: Commit**

```bash
git add src/lib/video-overlays.ts src/lib/video-overlays.test.ts src/components/project-nav/overlays/video-overlays-section.tsx src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): extract video-overlays settings panel, fold toMeta/sameOverlay into lib

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 抽取三个 pill 菜单(status / visibility / analytics)

**Files:**
- Create: `src/components/project-nav/status-menu.tsx`
- Create: `src/components/project-nav/detail/visibility-menu.tsx`
- Create: `src/components/project-nav/detail/analytics-panel.tsx`
- Modify: `src/components/project-nav.tsx`

**Interfaces:**
- Produces:`ProjectStatusMenu: React.FC<{ status: string; busy: boolean; onAction: (action: string) => void }>`;`VisibilityMenu`(props 同现状 `{ visibility, busy, onChange }`);`AnalyticsPanel: React.FC<{ projectId: string; enabled: boolean }>`;`PUBLISHED_STATUSES: Set<string>`(从 analytics-panel 导出)。
- Consumes:`ProjectStatusMenu` 用 `STATUS_ACTIONS`/`STATUS_STYLE`(`constants`)+ `statusLabel`(`@/lib/format`);`VisibilityMenu` 用 `statusLabel`;`AnalyticsPanel` 用 `Group`/`Metric`(`fields`)+ `useProjectAnalytics`(`@/api/projects/projects`)。

- [ ] **Step 1: 建 `status-menu.tsx`** — verbatim 搬 `ProjectStatusMenu`(827-881)。import:`useState`、`cn`、`DropdownMenu*`(`@/components/ui/dropdown-menu`)、`ChevronDown/Loader2`、`STATUS_ACTIONS`/`STATUS_STYLE`/`type StatusAction`(`@/components/project-nav/constants`)、`statusLabel`(`@/lib/format`)。`export`。

- [ ] **Step 2: 建 `detail/visibility-menu.tsx`** — verbatim 搬 `VISIBILITY_OPTIONS`(927-931)+ `VisibilityMenu`(933-965)。import:`cn`、`DropdownMenu*`、`ChevronDown/Eye/Loader2`、`statusLabel`(`@/lib/format`)。`VISIBILITY_OPTIONS` 就近 colocate(单读者)。`export` VisibilityMenu。

- [ ] **Step 3: 建 `detail/analytics-panel.tsx`** — verbatim 搬 `PUBLISHED_STATUSES`(884)、`AnalyticsPanel`(888-907)、`Trend`(910-923)。import:`useTranslation`、`Loader2`、`cn`、`Group`/`Metric`(`@/components/project-nav/fields`)、`useProjectAnalytics`(`@/api/projects/projects`)。`export` `AnalyticsPanel` 与 `PUBLISHED_STATUSES`(DetailContent 用它 gate)。

- [ ] **Step 4: 改 project-nav.tsx** — 删除搬走的 6 段;import 区加:

```ts
import { ProjectStatusMenu } from '@/components/project-nav/status-menu'
import { VisibilityMenu } from '@/components/project-nav/detail/visibility-menu'
import { AnalyticsPanel, PUBLISHED_STATUSES } from '@/components/project-nav/detail/analytics-panel'
```

清理因此不再用到的 import(`Eye`、`useProjectAnalytics` 等——typecheck 指认)。

- [ ] **Step 5: 验证**(Recipe)。

- [ ] **Step 6: Commit**

```bash
git add src/components/project-nav/status-menu.tsx src/components/project-nav/detail/visibility-menu.tsx src/components/project-nav/detail/analytics-panel.tsx src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): extract status, visibility and analytics pill menus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 抽取 `detail/meta-draft.ts`(TDD)+ `detail/meta-form.tsx`

**Files:**
- Create: `src/components/project-nav/detail/meta-draft.ts`
- Create: `src/components/project-nav/detail/meta-draft.test.ts`
- Create: `src/components/project-nav/detail/meta-form.tsx`
- Modify: `src/components/project-nav.tsx`

**Interfaces:**
- Produces(`meta-draft.ts`):`type MetaDraft`(15 个全字符串字段);`num(v: string): number | null`;`detailToDraft(d: BffProjectDetail): MetaDraft`;`draftToMeta(v: MetaDraft): BffProjectMetaRequest`。
- Produces(`meta-form.tsx`):`MetaForm`(props `{ value: MetaDraft; onChange; options; optionsLoading; onCancel; onSave }`,同现状)。

- [ ] **Step 1: 写失败测试** — 创建 `src/components/project-nav/detail/meta-draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { draftToMeta, num } from './meta-draft'

describe('num', () => {
  it('空串 → null,否则 Number', () => {
    expect(num('  ')).toBeNull()
    expect(num('3')).toBe(3)
  })
})

describe('draftToMeta', () => {
  it('trim 文本、price 空串归 0、数字字段空串归 null、id 空串归 null', () => {
    const blank = {
      listingUrl: '', address: '  12 Main ', address2: '', city: '', state: '',
      postalCode: '', propertyType: '', price: '', videoStyle: '',
      bedrooms: '', bathrooms: '2', livingAreaSqft: '', agencyId: '', agentId: '', assigneeId: '',
    }
    const out = draftToMeta(blank)
    expect(out.address).toBe('12 Main')
    expect(out.price).toBe(0)
    expect(out.bedrooms).toBeNull()
    expect(out.bathrooms).toBe(2)
    expect(out.agencyId).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/components/project-nav/detail/meta-draft.test.ts`
Expected: FAIL —— 无法解析 `./meta-draft`。

- [ ] **Step 3: 建 `meta-draft.ts`** — verbatim 搬 `num`(1499)、`MetaDraft`(1503-1519)、`detailToDraft`(1521-1537)、`draftToMeta`(1539-1555)。import:

```ts
import type { BffProjectDetail, BffProjectMetaRequest } from '@/generated/api-types'
```

`export` `MetaDraft`(type)、`num`、`detailToDraft`、`draftToMeta`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/components/project-nav/detail/meta-draft.test.ts`
Expected: PASS。

- [ ] **Step 5: 建 `meta-form.tsx`** — verbatim 搬 `MetaForm`(1559-1663)。import:`Row`(`@/components/project-nav/fields`)、`type MetaDraft`(`./meta-draft`)、`type BffProjectOptions`(`@/generated/api-types`)、`Input`(`@/components/ui/input`)、`NativeSelect/NativeSelectOption`(`@/components/ui/native-select`)、`Button`。`export`。

- [ ] **Step 6: 改 project-nav.tsx** — 删除搬走的 5 段;import 加:

```ts
import type { MetaDraft } from '@/components/project-nav/detail/meta-draft'
import { detailToDraft, draftToMeta } from '@/components/project-nav/detail/meta-draft'
import { MetaForm } from '@/components/project-nav/detail/meta-form'
```

- [ ] **Step 7: 验证**(Recipe)。

- [ ] **Step 8: Commit**

```bash
git add src/components/project-nav/detail/meta-draft.ts src/components/project-nav/detail/meta-draft.test.ts src/components/project-nav/detail/meta-form.tsx src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): extract meta-draft converters and meta-form

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 抽取 `detail/asset-grid.tsx`(AssetGrid + ReviewBadge)

**Files:**
- Create: `src/components/project-nav/detail/asset-grid.tsx`
- Modify: `src/components/project-nav.tsx`

**Interfaces:**
- Produces:`AssetGrid: React.FC<{ projectId: string; assets: NonNullable<BffProjectDetail['assets']> }>`;`ReviewBadge`(同文件私有即可,不必导出)。
- Consumes:`Group`(`@/components/project-nav/fields`)、`Thumb`/`duration`(`@/components/media-card`)、`AssetViewer`、`addProjectAssetToEditor`、`useMediaLightbox`、`useSaveAssetTags`/`useDeleteProjectAsset`、`toast`。

- [ ] **Step 1: 建 `asset-grid.tsx`** — verbatim 搬 `ReviewBadge`(1344-1361)+ `AssetGrid`(1365-1486)。补 import(从 project-nav.tsx import 区筛出实际用到的:`useState`、`useTranslation`、`cn`、`ThumbsUp/ThumbsDown` 及其它图标、`Thumb`/`duration`、`AssetViewer`、`useMediaLightbox`、`addProjectAssetToEditor`、`useSaveAssetTags`/`useDeleteProjectAsset`、`toast`、`type BffProjectDetail`、`Group`)。`export` `AssetGrid`。

- [ ] **Step 2: 改 project-nav.tsx** — 删除两段;import 加 `import { AssetGrid } from '@/components/project-nav/detail/asset-grid'`;清理不再用到的 import。

- [ ] **Step 3: 验证**(Recipe)+ `pnpm build`。

- [ ] **Step 4: 浏览器冒烟**(agent-browser,登录 `superadmin@xchangeai.com:pwd`):打开一个有资产的项目详情 → 资产网格正常显示;点缩略图 lightbox 打开;两击删除确认生效;"加入编辑器"仍触发。

- [ ] **Step 5: Commit**

```bash
git add src/components/project-nav/detail/asset-grid.tsx src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): extract asset grid and review badge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 抽取 `list/project-card.tsx`(memo,保持 identity)

**Files:**
- Create: `src/components/project-nav/list/project-card.tsx`
- Modify: `src/components/project-nav.tsx`

**Interfaces:**
- Produces:`ProjectCard`(`React.memo`),props 与现状**逐字不变**:`{ project: ProjectSummary; active: boolean; busy: boolean; onOpen; onChangeStatus }`(以源码 972-1020 实际 props 为准)。
- Consumes:`MediaCard`/`Thumb`/`duration`(`@/components/media-card`)、`ProjectStatusMenu`(`@/components/project-nav/status-menu`)、`relTime`(`@/lib/format`)、`type ProjectSummary`(`@/components/project-nav/types`)。

- [ ] **Step 1: 建 `project-card.tsx`** — verbatim 搬 `ProjectCard`(972-1020),**连同 `memo(...)` 包裹原样保留**(硬约束 3)。补 import(`memo`、上面 Consumes 列出的)。`export const ProjectCard = memo(...)`。

- [ ] **Step 2: 改 project-nav.tsx** — 删除该段;import 加 `import { ProjectCard } from '@/components/project-nav/list/project-card'`。**不改任何回调接线**——`onOpen`/`onChangeStatus` 仍是 ListContent 现在传的那两个 useCallback 值。

- [ ] **Step 3: 验证**(Recipe)+ `pnpm build`。

- [ ] **Step 4: 浏览器冒烟 + 性能核对**:滚动长列表流畅;在 React DevTools Profiler(或临时 `console.count` 于 ProjectCard 渲染)确认——**在搜索框打字时,不可见/无关卡片不重渲染**(仅 ListHeader 及计数变化处更新)。若发现全表重渲染 → identity 被破坏,回退本任务修复。

- [ ] **Step 5: Commit**

```bash
git add src/components/project-nav/list/project-card.tsx src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): extract memoized ProjectCard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 抽取 `list/list-content.tsx` + `list/list-header.tsx`

**Files:**
- Create: `src/components/project-nav/list/list-content.tsx`
- Create: `src/components/project-nav/list/list-header.tsx`
- Modify: `src/components/project-nav.tsx`

**Interfaces:**
- Produces:`ListContent`(props 与现状**逐字不变**,见源码 608-);`ListHeader`(`React.memo`,props 逐字不变,见 498-527)。
- Consumes:`ListHeader`、`ProjectCard`、`PanelBody`(`shell`)、`CollapseToggle`(`shell`)、`ASSIGNEE_FILTERS`/`SORT_OPTIONS`/`ROW_HEIGHT`/`ROW_GAP`(`constants`)、`type Anchor`(`types`)、`ThemeToggle`/`LanguageToggle`/`SearchInput`/`Select*`/`ScrollArea`/`Button`、`useScrollFade`、`PROJECTS_PAGE_SIZE`/`useProjectPages`、`type ProjectListParams`。

- [ ] **Step 1: 建 `list-header.tsx`** — verbatim 搬 `ListHeader`(498-606),**保留 `memo(...)`**。补 import:`memo`、`useTranslation`、`cn`、`CollapseToggle`(`@/components/project-nav/shell`)、`ThemeToggle`、`LanguageToggle`、`SearchInput`(`@/components/form/search-input`)、`ScrollArea`、`Button`、`Select*`、`CloudDownload/Loader2`、`ASSIGNEE_FILTERS`/`SORT_OPTIONS`(`@/components/project-nav/constants`)。`export`。

- [ ] **Step 2: 建 `list-content.tsx`** — verbatim 搬 `readAnchor`(227-233,连同 `writeAnchor` 若存在于 608-824 之间)+ `ListContent`(608-824)。**anchor 逻辑本步保持内联(spec §7:本次不抽 use-list-anchor)。** 补 import:`useCallback/useEffect/useLayoutEffect/useMemo/useRef/useState`、`useVirtualizer`、`useTranslation`、`ListHeader`(`./list-header`)、`ProjectCard`(`./project-card`)、`PanelBody`(`@/components/project-nav/shell`)、`useScrollFade`、`PROJECTS_PAGE_SIZE`/`useProjectPages`(`@/api/projects/projects`)、`ROW_HEIGHT`/`ROW_GAP`(`constants`)、`type Anchor`(`types`)、`type ProjectListParams`(`@/lib/query-keys`)。`export function ListContent`。

- [ ] **Step 3: 改 project-nav.tsx** — 删除 `readAnchor`、`ListHeader`、`ListContent` 三段;import 加 `import { ListContent } from '@/components/project-nav/list/list-content'`;清理不再用到的 import(`useVirtualizer`、`SearchInput`、`PROJECTS_PAGE_SIZE` 等)。**ProjectNav 里 `<ListContent .../>` 的传参逐字不变。**

- [ ] **Step 4: 验证**(Recipe)+ `pnpm build`。

- [ ] **Step 5: 浏览器冒烟:** 搜索/负责人筛选/排序切换都生效;**切换筛选桶后滚动位置不串**(anchor 按 bucket 隔离);分页(滚到底继续加载)正常;memo 性能同 Task 8 核对。

- [ ] **Step 6: Commit**

```bash
git add src/components/project-nav/list/list-content.tsx src/components/project-nav/list/list-header.tsx src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): extract list panel (ListContent + ListHeader)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: 抽取 `detail/detail-content.tsx`

**Files:**
- Create: `src/components/project-nav/detail/detail-content.tsx`
- Modify: `src/components/project-nav.tsx`

**Interfaces:**
- Produces:`DetailContent`(props 与现状**逐字不变**:`{ loading; project; visible; onBack; onChangeStatus; statusBusy }`,见 1667-)。
- Consumes:`PanelBody`(`shell`)、`ProjectStatusMenu`(`status-menu`)、`VisibilityMenu`/`AnalyticsPanel`/`PUBLISHED_STATUSES`(`detail/*`)、`Group`/`Field`/`Metric`(`fields`)、`VideoOverlaysSection`(`overlays/*`)、`MetaForm`/`detailToDraft`/`draftToMeta`/`type MetaDraft`(`detail/*`)、`AssetGrid`(`detail/asset-grid`)、`usd`/`absTime`/`relTime`(`@/lib/format`)、`Thumb`/`duration`、`Tabs*`/`ScrollArea`/`Separator`/`Button`、`CommentPane`、`useProjectOptions`/`useSaveProjectMeta`/`useSaveProjectVisibility`/`useSaveProjectAssignee`、`editorProjectRef`/`refreshBannerText`、`useEmblaCarousel`、`useScrollFade`。

- [ ] **Step 1: 建 `detail/detail-content.tsx`** — verbatim 搬 `DetailContent`(1667-2034)。**embla 下划线动画(useLayoutEffect + ResizeObserver + 5 refs)整块原样搬,不趁机重构(硬约束/风险)。** 补齐上面 Consumes 全部 import。`export function DetailContent`。

- [ ] **Step 2: 改 project-nav.tsx** — 删除该段;import 加 `import { DetailContent } from '@/components/project-nav/detail/detail-content'`;清理残余 unused import。此时 project-nav.tsx 只剩 `ProjectNav` 本体 + 各子模块 import。

- [ ] **Step 3: 验证**(Recipe)+ `pnpm build`。

- [ ] **Step 4: 浏览器冒烟:** 详情面板打开;Details/Comments 两 tab 滑动 + 下划线动画跟手;编辑元信息 → 保存/取消;可见性/状态菜单;overlays 面板改一项在预览生效;评论区加载。

- [ ] **Step 5: Commit**

```bash
git add src/components/project-nav/detail/detail-content.tsx src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): extract detail panel orchestrator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: 新增 `nav-context.tsx`,把 ProjectNav 包成 Provider(纯增,行为不变)

**Files:**
- Create: `src/components/project-nav/nav-context.tsx`
- Modify: `src/components/project-nav.tsx`(ProjectNav return 外层包两个 Provider;暂无消费者)

**Interfaces:**
- Produces:`type NavActions`;`NavActionsProvider`;`useNavActions(): NavActions`;`StatusChangingProvider`;`useStatusChangingId(): string | null`。

- [ ] **Step 1: 建 `nav-context.tsx`**:

```tsx
import { createContext, useContext } from 'react'
import type { Panel } from '@/components/project-nav/types'

// 稳定回调集中到一个 context —— value 由 ProjectNav 用 useMemo 包一次,identity 恒定,
// 读它的组件永不因它重渲染。易变值(search/selectedId/counts)不进这里,叶子就地读 hook。
export type NavActions = {
  selectProject: (id: string) => void
  changeProjectStatus: (id: string, action: string) => void
  onSearch: (v: string) => void
  onAssigneeChange: (v: string) => void
  onSortChange: (v: string) => void
  refreshStats: () => void
  openPanel: (panel: Panel) => void
  collapse: () => void
  toggleCollapse: () => void
  backToList: () => void
}

const NavActionsContext = createContext<NavActions | null>(null)
export const NavActionsProvider = NavActionsContext.Provider
export function useNavActions(): NavActions {
  const ctx = useContext(NavActionsContext)
  if (!ctx) throw new Error('useNavActions must be used within <ProjectNav>')
  return ctx
}

// 状态变更 mutation 的 pending id —— 真正跨 card/detail 共享的易变态,单独一个小 context,
// 仅在用户点状态操作那一下才变(~200ms、罕见),只让 card/detail 订阅、不污染 NavActions。
const StatusChangingContext = createContext<string | null>(null)
export const StatusChangingProvider = StatusChangingContext.Provider
export const useStatusChangingId = (): string | null => useContext(StatusChangingContext)
```

- [ ] **Step 2: 在 ProjectNav 里构造并包 Provider** — 在 `ProjectNav()` 里,把现有各 useCallback 收进一个 `useMemo` 的 `NavActions`,并把 return 的根 `<div>` 包进两个 Provider。新增(不改现有 useCallback 定义,只聚合):

```tsx
const actions = useMemo<NavActions>(
  () => ({
    selectProject,
    changeProjectStatus,
    onSearch,
    onAssigneeChange,
    onSortChange,
    refreshStats,
    openPanel,
    collapse: () => setCollapsed(true),
    toggleCollapse: () => setCollapsed((v) => !v),
    backToList: () => setActive('list'),
  }),
  [selectProject, changeProjectStatus, onSearch, onAssigneeChange, onSortChange, refreshStats],
)
const statusChangingId = changeStatus.isPending ? (changeStatus.variables?.id ?? null) : null
```

> `openPanel`/`collapse`/`toggleCollapse`/`backToList` 目前是内联箭头;它们进 memo deps 会不稳。**本步先不把它们的现有内联用法改成 context**——Provider 只是"备好",消费在 Task 12/13。为让 `actions` identity 尽量稳,把 `openPanel` 也提成 `useCallback`(deps `[setActive, setCollapsed]`),`collapse/toggleCollapse/backToList` 用 `useCallback` 包一层放进 memo deps。执行者:把这四个提成 useCallback,再让 memo deps 覆盖全部 10 个字段。

包裹:

```tsx
return (
  <NavActionsProvider value={actions}>
    <StatusChangingProvider value={statusChangingId}>
      <div className="flex h-full shrink-0 ...">{/* 原内容不动 */}</div>
    </StatusChangingProvider>
  </NavActionsProvider>
)
```

- [ ] **Step 3: 验证**(Recipe)。行为应完全不变(还没有消费者)。

- [ ] **Step 4: Commit**

```bash
git add src/components/project-nav/nav-context.tsx src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): add nav actions + status-changing contexts, wrap ProjectNav

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: 列表面板改读 context,丢掉穿层 props

**Files:**
- Modify: `src/components/project-nav/list/list-content.tsx`
- Modify: `src/components/project-nav/list/list-header.tsx`
- Modify: `src/components/project-nav/list/project-card.tsx`
- Modify: `src/components/project-nav.tsx`(`<ListContent>` 传参缩减)

**Interfaces:**
- 变更后:`ListContent` props 仅剩 `{ visible: boolean }`(其余就地取);`ListHeader` props 仅剩 `{ tabsViewportRef }`;`ProjectCard` props 仅剩 `{ project; active; busy }`(`onOpen`→改名/改为 context 的 `selectProject`,`onChangeStatus`→context 的 `changeProjectStatus`)。

- [ ] **Step 1: ListHeader 改造** — 删掉 `search/onSearch/assignee/onAssigneeChange/sort/onSortChange/allCount/unassignedCount/mineCount/syncing/onSync/onToggleCollapse` 这些 props,改为就地取:

```tsx
import { useSearch } from '@tanstack/react-router'
import { useNavActions } from '@/components/project-nav/nav-context'
import { useAssigneeCount, useProjectStats } from '@/api/projects/projects'
import { useSession } from '@/api/session/session'
// …
const params = useSearch({ from: '/' })
const search = params.search ?? ''
const assignee = params.assignee ?? ''
const sort = params.sort ?? 'created_desc'
const { onSearch, onAssigneeChange, onSortChange, toggleCollapse } = useNavActions()
const meId = useSession().data?.user?.id
const allCount = useProjectStats().data?.total
const unassignedCount = useAssigneeCount('unassigned', true).data
const mineCount = useAssigneeCount(meId ?? '', Boolean(meId)).data
```

> `syncing`/`onSync`(手动同步)源码里由 ListContent 用 `useCallback` 产生(见 list-content 的 `onSync`)并下传。**默认:保持 `syncing`/`onSync` 仍由 ListContent 作为 props 传给 ListHeader**(它俩是 ListContent 局部状态,不属于全局 nav 动作,无需进 context)。本任务只把 ListHeader 的**筛选/排序/计数/折叠**这批 props 换成 context+hook。`onToggleCollapse` → `toggleCollapse`(context)。`tabsViewportRef`、`syncing`、`onSync` 仍作 prop。

- [ ] **Step 2: ListContent 改造** — 删掉从 ProjectNav 穿进来的 `params/allCount/unassignedCount/mineCount/search/onSearch/assignee/onAssigneeChange/sort/onSortChange/onRefreshStats/onChangeStatus/statusChangingId/selectedId/onSelect/onToggleCollapse`,改为就地组 `params`、就地取 context/hook:

```tsx
const p = useSearch({ from: '/' })
const meId = useSession().data?.user?.id
const search = p.search ?? ''
const rawAssignee = p.assignee ?? ''
const apiAssignee = rawAssignee === 'me' ? (meId ?? '') : rawAssignee
const sort = p.sort ?? 'created_desc'
const params = useMemo(() => ({ search, assignee: apiAssignee, sort }), [search, apiAssignee, sort])
const selectedId = p.project ?? null
const { selectProject, changeProjectStatus, refreshStats } = useNavActions()
const statusChangingId = useStatusChangingId()
```

`<ListHeader>` 只传 `tabsViewportRef`(+ 视情况 `onSync`/`syncing`)。虚拟化循环里渲染卡片改为:

```tsx
<ProjectCard
  project={/* itemAt(...) → ProjectSummary */}
  active={item.id === selectedId}
  busy={statusChangingId === item.id}
/>
```

`onRefreshStats` 用处(同步后刷新计数)改用 context 的 `refreshStats`。

- [ ] **Step 3: ProjectCard 改造** — 把 `onOpen`/`onChangeStatus` 两个 props 去掉,改从 context 取(硬约束 3:`active`/`busy` 仍是 props,**不引入 useSearch**):

```tsx
import { useNavActions } from '@/components/project-nav/nav-context'
// …
const { selectProject, changeProjectStatus } = useNavActions()
```

卡片点击/状态动作改调 `selectProject(project.id)` / `changeProjectStatus(project.id, action)`。memo 比较项现在只剩 `{ project, active, busy }`。

- [ ] **Step 4: 改 project-nav.tsx** — `<ListContent>` 只传 `visible={listExpanded}`;删掉其余十几个传参。ProjectNav 里若 `params2`/`allCount`/`unassignedCount`/`mineCount`/`selectProject`(仍需给 context)等有的已只服务于 context 就保留、只服务于旧穿参就删——由 typecheck unused 指认。

- [ ] **Step 5: 验证**(Recipe)+ `pnpm build`。

- [ ] **Step 6: 浏览器冒烟 + 性能核对(关键):** 搜索/筛选/排序/选中/状态变更全部生效;**打字时 Profiler 确认卡片不整表重渲染**(context value 稳定 + ProjectCard 不读 useSearch)。若整表重渲染 → 检查 `actions` memo identity 是否稳、ProjectCard 是否误读了易变 hook。

- [ ] **Step 7: Commit**

```bash
git add src/components/project-nav/list src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): list panel consumes nav context, drop prop drilling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: 详情面板改读 context,丢掉穿层 props

**Files:**
- Modify: `src/components/project-nav/detail/detail-content.tsx`
- Modify: `src/components/project-nav/detail/asset-grid.tsx`(若其 `onChangeStatus` 类回调来自穿参,一并改 context)
- Modify: `src/components/project-nav.tsx`(`<DetailContent>` 传参缩减)

**Interfaces:**
- 变更后:`DetailContent` props 仅剩 `{ visible: boolean }`;`project`/`loading` 就地 `useProject(selectedId)`,`onBack`/`onChangeStatus`/`statusBusy` 改 context/就地。

- [ ] **Step 1: DetailContent 改造** — 删掉 `loading/project/onBack/onChangeStatus/statusBusy` props,改为:

```tsx
import { useSearch } from '@tanstack/react-router'
import { useNavActions, useStatusChangingId } from '@/components/project-nav/nav-context'
import { useProject } from '@/api/projects/projects'
// …
const selectedId = useSearch({ from: '/' }).project ?? null
const detail = useProject(selectedId)
const loading = detail.isPending && Boolean(selectedId)
const project = detail.data
const { backToList, changeProjectStatus } = useNavActions()
const statusBusy = useStatusChangingId() === selectedId
```

`onBack()` → `backToList()`;`onChangeStatus(id, action)` → `changeProjectStatus(id, action)`;`ProjectStatusMenu` 的 `busy`/`onAction`、`VisibilityMenu` 等接线相应改。

- [ ] **Step 2: 改 project-nav.tsx** — `<DetailContent>` 只传 `visible={detailExpanded}`;删掉 `loading/project/onBack/onChangeStatus/statusBusy` 五个传参。ProjectNav 里 `detail = useProject(selectedId)` 若已无其它用处则删(typecheck 指认)。

- [ ] **Step 3: 验证**(Recipe)+ `pnpm build`。

- [ ] **Step 4: 浏览器冒烟:** 详情所有子功能(编辑/保存、状态、可见性、资产、overlays、评论、tab 动画)与 Task 10 一致;从列表卡片点状态变更时,详情面板 busy 态仍同步(共享 StatusChanging context)。

- [ ] **Step 5: Commit**

```bash
git add src/components/project-nav/detail src/components/project-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): detail panel consumes nav context, drop prop drilling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: 迁 ProjectNav → `index.tsx`,更新 app-shell,删旧文件

**Files:**
- Create: `src/components/project-nav/index.tsx`(内容 = 现 `project-nav.tsx` 的 ProjectNav 本体)
- Delete: `src/components/project-nav.tsx`
- Modify: `src/app-shell.tsx`(import 路径)

**Interfaces:**
- Produces:`export function ProjectNav()`(从 `@/components/project-nav` 目录 barrel 导出)。

- [ ] **Step 1: 迁移** — 把 `src/components/project-nav.tsx` 整体移动为 `src/components/project-nav/index.tsx`:

```bash
git mv src/components/project-nav.tsx src/components/project-nav/index.tsx
```

移动后修正 index.tsx 内的相对 import:原来 `@/components/project-nav/xxx` 仍可用(绝对路径不变);检查有无对自身旧路径的引用。

- [ ] **Step 2: 确认 app-shell import** — `src/app-shell.tsx` 里 `import { ProjectNav } from '@/components/project-nav'` 现在解析到 `project-nav/index.tsx`,通常无需改动。若它写的是 `'@/components/project-nav.tsx'` 或深路径,改为 `'@/components/project-nav'`。

Run: `grep -rn "components/project-nav" src --include=*.tsx --include=*.ts | grep -v "project-nav/"`
Expected: 除 barrel 消费者外,无人再引旧的 `.tsx` 具体文件。

- [ ] **Step 3: 验证**(Recipe)+ `pnpm build`。

- [ ] **Step 4: 全量浏览器回归:** 冷启动 `/` → 列表加载;选项目 → 详情;所有前述子功能过一遍;刷新/后退还原正确(URL 状态);侧边栏折叠/展开动画正常。

- [ ] **Step 5: Commit**

```bash
git add src/components/project-nav src/app-shell.tsx
git commit -m "$(cat <<'EOF'
refactor(project-nav): relocate ProjectNav to index.tsx, retire god-file

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完成判据

- `src/components/project-nav.tsx`(2034 行 god-file)不复存在;取而代之为 `project-nav/` 下 ~18 个聚焦文件 + `lib/format.ts`。
- `ListContent`/`ListHeader`/`ProjectCard`/`DetailContent` 不再接收穿层 props;稳定回调走 `NavActions` context,易变值就地读 hook,memo 热路径不变。
- `pnpm typecheck` 0 errors、`pnpm test` 全绿(含 3 处新增 assert 自检)、`pnpm build` 成功。
- 浏览器回归:列表/详情/overlays/评论/状态机/滚动锚定/tab 动画行为与拆分前一致;打字时无全表重渲染。
- 6 条硬约束全程未破(路由环仍 type-erased、verbatimModuleSyntax 合规、editor-app 单向、渲染 bundle 隔离、纯变换分层)。
