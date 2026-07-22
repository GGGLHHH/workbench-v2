# project-nav.tsx 拆分封装设计

- 日期:2026-07-22
- 范围:`src/components/project-nav.tsx`(2034 行 god-file)
- 目标:切成聚焦模块 + 用 nav Context 治理 prop-drilling
- 力度决定(用户拍板):**搬移 + 引入 nav Context 治理 prop-drilling**;目录**分子目录 `list/ detail/ overlays/`**

---

## 1. 现状诊断

`project-nav.tsx` 在 `AppShell` 里**零 props 挂载一次**,内部组合约 25 个组件,横跨 6 个不相关职责:动画双栏 shell、虚拟化+滚动锚定的列表面板、项目卡片、三个 pill-下拉菜单(状态 FSM / 可见性 / 分析)、整套 video-overlays 编辑器面板、详情面板(资产网格 + 15 字段元信息表单 + embla 分页编排器)。

大部分单元是**纯的、无闭包**——只因同住一个文件才显得纠缠。真正的纠缠集中在 3 处:

| 纠缠点 | 为什么难 | extractability |
|---|---|---|
| `ProjectNav`(编排器,236-374) | 独占全部 URL/localStorage/query 状态,往下穿 ~20 个回调 | hard |
| `ListContent`(608-824) | ~13 个 prop 中转站 + 虚拟列表 anchor 副作用,在 `React.memo` 性能契约下 | needs-shared-context |
| `DetailContent`(1667-2034) | hub,手接 ~14 个 sibling + 一套 embla 下划线动画 | hard |

**关键洞察:** ProjectNav 独占的状态几乎全是 URL 派生(`useSearch({from:'/'})`)或全局 query hook(`useProjectStats` / `useAssigneeCount` / `useSession`)。这些 prop 被穿 2-3 层只是因为 ProjectNav 算一次往下传;**任何后代都能自己调这些 hook 拿到**(tanstack-query 自动去重、useSearch 极廉价)。这正是 Context 治理能成立、且能真正消解穿层的根据。

---

## 2. nav Context 治理设计(核心)

**踩坑警告:** 天真地把状态塞进一个 Context value,会让每次搜索输入触发**所有** ProjectCard 重渲染,直接砸掉虚拟列表的 memo 性能契约。正确做法是**按变化频率分层**。

### ① `NavActionsContext` —— 只装稳定回调

value = 全部 useCallback 回调:`selectProject` / `changeProjectStatus` / `onSearch` / `onAssigneeChange` / `onSortChange` / `refreshStats` / `openPanel` / `setCollapsed`。value 用 `useMemo` 包一次,**identity 恒定 → 读它的组件永不因它重渲染**。一举消解大部分穿层,零性能代价。

### ② 易变值不进共享 value,叶子就地读 hook

| 组件 | 易变值来源 | 结果 |
|---|---|---|
| `ListHeader` | `useSearch()` 拿 search/assignee/sort + 计数 hook 直读 | 从 ~11 props 降到只剩 `tabsViewportRef` |
| `ListContent` | 自己用 `useSearch`+`useSession` 组 `params` | 甩掉 ~13 个中转 props,只留虚拟化/anchor 内部逻辑 |
| `DetailContent` | 自己 `useProject(selectedId)` | 只从 context 取回调 |

### ③ memo 热路径原样不动

`ProjectCard`(memo,热路径)仍把 `{project, active, busy}` 当**直接 props** 从虚拟化循环拿——**绝不让它读 `useSearch`**(否则每次打字全表重渲染),只从 context 取 `onSelect/onChangeStatus`。卡片仍只在自己 active/busy 翻转时重渲染,与现状完全一致,memo 契约保住。

### ④ 唯一跨面板共享的易变态:状态 mutation 的 pending id

`useChangeProjectStatus` 的 `isPending`/`variables.id` 是真正跨 card/detail 共享的易变态。**默认方案:** provider 独占这一个 mutation 实例,`changeProjectStatus`(稳定回调)进 ①,而 `statusChangingId` 进一个**独立的小 context**,只有 card/detail 订阅——仅在用户点状态操作那一下(~200ms、罕见)才触发它俩重渲染,可接受。保持单实例即保留"同一份 pending 状态驱动 card 与 detail 的 busy"的现有行为,也保留 optimistic cache 更新的单一入口。

---

## 3. 目标文件树(nested)

```
src/components/project-nav/
  index.tsx            ProjectNav = Provider + shell 组装(编排器,最后收口)
  nav-context.tsx      NavActionsContext + statusChangingId context【新增·治理核心】
  types.ts             Panel / ProjectSummary / StatusAction / Anchor / MetaDraft
  constants.ts         ASSIGNEE_FILTERS / STATUS_STYLE / STATUS_ACTIONS / SORT_OPTIONS /
                       SORT_VALUES(导出给路由) / PUBLISHED_STATUSES / ROW_HEIGHT/ROW_GAP / CORNER_ARROW
  shell.tsx            Section / Layer / CollapseToggle / Rail / PanelBody
  fields.tsx           Group / Field / Metric / Row(list+detail 共用 → 放根)
  status-menu.tsx      ProjectStatusMenu(card+detail 共用 → 放根)
  list/
    list-content.tsx   ListContent(虚拟化控制器)
    list-header.tsx    ListHeader
    project-card.tsx   ProjectCard(memo)
  detail/
    detail-content.tsx DetailContent(编排 + embla 下划线整块搬)
    meta-form.tsx      MetaForm
    meta-draft.ts      MetaDraft + detailToDraft / draftToMeta / num
    asset-grid.tsx     AssetGrid + ReviewBadge
    visibility-menu.tsx VisibilityMenu(+ VISIBILITY_OPTIONS 就近放)
    analytics-panel.tsx AnalyticsPanel + Trend
  overlays/
    video-overlays-section.tsx  + useOverlayConfig / OverlaySwitchRow / ColorInput / ScaleToggle
src/lib/
  format.ts            relTime / absTime / usd / statusLabel(+ 一个 assert 自检)
  video-overlays.ts    += toMeta, sameOverlay(折进现有纯模块,保留纯变换分层)
```

**放置约定:** 子目录 = 面板专属;项目根(project-nav/ 直下)= 跨面板共享(fields / status-menu / constants / types / shell / nav-context)。`index.tsx` 保留公开 `ProjectNav` 导出;`app-shell.tsx` 的单一 import 站点相应更新(或在旧路径 `src/components/project-nav.tsx` 留一行 re-export shim,收口步再决定)。

---

## 4. 6 条硬约束(拆时不可破)

1. **路由↔nav 编译环:** `SORT_VALUES` 是 value 导出给 `routes/index.tsx` 的 `validateSearch`,而 nav 反手 `import type { ProjectSearch }` from routes/index。这个环只靠 type-only import 被 `verbatimModuleSyntax` 擦除才无害。→ `constants.ts` 必须保持**无组件依赖的叶子**,`ProjectSearch`/`ProjectListParams` 必须 `import type`。
2. **verbatimModuleSyntax 全开**(app/bff/node/server tsconfig):每个类型导入必须 `import type` 或内联 `type` 标记,否则构建失败。
3. **memo 契约(虚拟滚动性能载体):** `ListHeader`、`ProjectCard` 是 `React.memo`,依赖 ProjectNav 里 useCallback 的稳定 identity + `useProjectPages` 的 `itemAt`/`refetch` 稳定引用。搬文件不得引入新包裹组件/内联 lambda 破坏这些 identity。
4. **editor-app 单例单向:** overlays 代码 by-value 引 `editorStore`/`editorProjectRef` from `@/editor-app`,依赖严格单向 `project-nav → editor-app`,**绝不能反向**(会经单例成运行时环)。`AppShell` 是唯一合成根。
5. **渲染 bundle 隔离:** `video-overlays-section` 留 app 侧(可用 `@/`),只经 `src/overlays/overlay-design.ts` 的 data schema 与渲染器对话;不得让 `@/`/react-query/router/i18n 泄入 `src/overlays/*`。
6. **纯变换分层:** `UI → video-overlays-store`(副作用 dispatch)`→ video-overlays.ts`(纯)。抽 overlays UI 时不得把 `editorStore.getState().updateUndoable` 内联进纯模块。

---

## 5. 提取顺序(11 步,纯叶子 → 面板 → memo → Context 收口)

每步独立 `tsc -b` + `vitest run` + `vite build` 通过、可回滚。

| 步 | 内容 | 风险 |
|---|---|---|
| 1 | `lib/format.ts`(relTime/absTime/usd/statusLabel)+ assert 自检 | low |
| 2 | `types.ts` + `constants.ts`;`routes/index.tsx` 改从 constants 导入 `SORT_VALUES` | low |
| 3 | `fields.tsx`(Group/Field/Metric/Row)+ `shell.tsx`(Section/Layer/CollapseToggle/Rail/PanelBody) | low |
| 4 | `overlays/video-overlays-section.tsx`;toMeta/sameOverlay 折进 `lib/video-overlays.ts` | low |
| 5 | `status-menu.tsx` + `detail/visibility-menu.tsx` + `detail/analytics-panel.tsx`(+Trend) | low |
| 6 | `detail/meta-draft.ts` 再 `detail/meta-form.tsx` | low |
| 7 | `detail/asset-grid.tsx`(AssetGrid + ReviewBadge) | med |
| 8 | `list/project-card.tsx`(memo,回调 identity 必须稳) | med |
| 9 | `list/list-content.tsx` + `list/list-header.tsx`(改读 context;anchor 逻辑此步先留内联) | high |
| 10 | `detail/detail-content.tsx`(改读 context;embla 下划线整块搬,不趁机改) | high |
| 11 | `nav-context.tsx` + `index.tsx`=ProjectNav(建 Provider 收口;更新 app-shell import) | high |

> Context 治理并入 9/10/11:list-content / detail-content 改为读 context + 就地 hook,index.tsx 建 Provider。第 1-8 步是纯等价搬移,不碰 Context;若中途想收手,前 8 步本身已是有价值的拆分。

---

## 6. 风险清单

- **路由环退化成运行时环**:constants.ts 混入任何组件 import,或 route 类型没用 `import type` → 擦除的环变真环。
- **memo identity 被破坏**:搬文件时手滑加了包裹组件/内联 lambda → 虚拟滚动全表重渲染。
- **Context over-render**:易变值误入 `NavActionsContext` value → 打字触发全体消费者重渲染。分层设计(①②③④)就是防这个。
- **anchor 抽取(可选,本次不做)**:sessionStorage 按 filter bucket + rAF + pagehide 的滚动锚定很脆;若日后抽 `use-list-anchor` hook,单独一步、手测切 bucket 无滚动串位后再合。
- **embla 下划线动画**(useLayoutEffect + ResizeObserver + 5 refs)时序敏感:整块 verbatim 搬,拒绝"顺手清理"。
- **测试覆盖缺口**:目前仅 `lib/*` 有 co-located 测试。纯抽取(format.ts、meta-draft.ts、video-overlays 里的 toMeta/sameOverlay)是留一条 assert 自检的廉价点;有状态面板无既有测试,其搬移靠手测验证。
- **editor-app 反向 import**:抽 overlays 时误让 editor-app 引 project-nav → 单例运行时环。

---

## 7. 显式不做(YAGNI)

- **不抽 `use-list-anchor` hook**(锚定逻辑本次留在 list-content 内联,风险最高的区不叠加改动)。
- **不改 embla 下划线动画实现**(只搬位置)。
- **不把 fields 原语升到 `components/ui/`**(仅 project-nav 内 3 个 surface 复用,升级留到第 4 个消费者出现)。
- **不改任何 API/query-key/store 契约**(纯前端组件拆分)。
