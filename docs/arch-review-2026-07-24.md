# workbench-v2 架构优化设计(2026-07-24)

> 方法:8 个子系统并行精读(每个子系统一个 reader agent)→ 架构师综合去重排序。
> 视角:ponytail —— 能复用不新造、拒绝为单一实现造抽象、最短可行 diff。

## 一、总体判断

**架构是健康的**,不需要推倒重来。关注点分层清晰,且多数子系统已经收敛到正确模式:

- **BFF 契约层** `bff/src` —— 把 xchangeai-server(typed client)+ 本地渲染 server 翻译成前端唯一认得的 `/bff/*` 契约。`session.ts`/`clips.ts` 已是「一个 `register*Routes(app)` + 独立文件」。
- **前端数据层** `src/api` + `src/lib` —— TanStack Query 乐观更新 hook + ky 鉴权重放,query-key 集中管理。
- **渲染服务** `server/src/clip` —— 「provider 元数据表 + 一个 HTTP 执行器」,加新 provider 只填一条定义,扩展点清晰;是三层里最健康的。
- **编辑器宿主** `editor-app.tsx` —— 接入 `@gedatou/editor` 用「库默认实现 + 覆盖一个方法」的最小侵入,边界干净。
- **shadcn ui** `src/components/ui`(60 文件)—— 纯生成物,grep 业务标记 0 命中,禁止手改的边界守得住。
- **lib 纯函数**(25 文件)—— 单一职责、普遍 <60 行、命名即语义、关键文件配同名 `.test.ts`。

**债集中在三类**,且都能用「纯移动 / 复用已有导出 / 抽几行小工具」解决,几乎无需引入新抽象:

1. **错误兜底 + 乐观回滚样板重复**:`api-client.ts` 有个**已导出却零调用**的 `extractErrorMessage`,而 `src/api/projects/projects.ts` 里 11 处手写了等价逻辑 + 7 处逐字复制的 `cancel→snapshot→onError 回滚`。零成本可消,最高 ROI。
2. **UI 模式复制粘贴而非抽薄共享原语**:二次确认状态机(3×)、无限下拉状态插槽 JSX(3×)、clip 生成表单三联块(2×)、缩略图渲染(2×)。作者注释里已多次自认「与 XX 同套」。
3. **两个未跟上既有拆分模式的 God 文件**:BFF `projects.ts`(1540 行,一个 register 揉 8 资源域)、数据层 `projects.ts`(886 行混 5 类关注点)。

## 二、跨子系统重复模式

| # | 模式 | 出现处 | 收敛方式 |
|---|---|---|---|
| T1 | 错误兜底 + 乐观回滚样板 | `api/projects/projects.ts`(11+7);`api-client.ts` 死导出 | 先复用 `extractErrorMessage`(0 新增),再抽几行 `rollbackOnError`。**不造通用 mutation 工厂** |
| T2 | UI 交互/展示壳复制粘贴 | 二次确认(status-menu/asset-grid/comment-pane 3×)、下拉状态插槽(3×)、clip 三联块(2×)、缩略图(2×)、药丸菜单(2×) | 逐个抽薄组件/小 hook,只统一状态机本体或 JSX 壳。**不上配置驱动泛型工厂**;3 处的先在 2 处验证再扩散 |
| T3 | 同构 stateful hook 未抽 | clip panel vs group(表单兜底 effect + 单任务轮询);infinite-select vs infinite-combobox(selectedIds 回显缓存) | 抽 `useClipGenForm`/`useClipTaskWatcher`/`useSelectedItemsCache`,只搬逻辑不泛型化 |
| T4 | 零依赖小工具/schema 手抄多份 | BFF `nullable`(2×)、分页 envelope(4×);server 文件索引(2×)、FIFO 队列(2×)、provider `model/durations` 闭包(9×) | 各抽一个零依赖小函数,行为不变 |
| T5 | God 文件混多关注点 | BFF `projects.ts`(1540);数据层 `projects.ts`(886);`detail-content.tsx`(424) | 纯移动式按子资源拆分,补齐已确立的「一子资源一文件」模式 |

## 三、优化路线(按 ROI 排序)

### A 组 —— 零/低风险,先做(全部 S、风险低,不引入新抽象或只抽几行小工具)

| # | 事项 | 动哪里 | 收益 |
|---|---|---|---|
| 1 | 复用 `extractErrorMessage` | `api/projects/projects.ts` 11 处 onError → `toast.error(extractErrorMessage(error, t('...Failed')))` | **0 新增代码**,复活死导出,去 11 处三段式复制 |
| 2 | 抽 `rollbackOnError` | 同文件顶部加几行,7 个 mutation 的 onError 各收敛成一行;onMutate 的 cancel+snapshot 不抽 | 减 ~30 行逐字重复,不接管 mutationFn/onMutate |
| 3 | 抽 `InfiniteSelectStateSlots` 薄组件 | `select/infinite-select.tsx` 旁;member/tag/prompt-preset 三处传算好的文案 | 省 3×8 行 Empty/Loading/LoadingMore/Error 结构复制 |
| 4 | 抽 `useSelectedItemsCache` | `select/`;infinite-select 与 infinite-combobox 两处替换 | 合并 ~15 行「id 为权威、items 尽力回显」重复 |
| 5 | 抽 `useConfirmAction`(先 2 处) | 新增 hook;替换 status-menu 的 `pendingConfirm` 与 asset-grid 的 `confirmDel`;图标/onBlur vs onOpenChange 留各自组件 | 统一 armed-then-fire 状态机,2 处验证后再定是否扩散 comment-pane |
| 6 | clip 生成三件套 | `use-clip-gen-form.ts` + 纯展示 `ClipGenControlsRow` + `api/clips.ts` 的 `useClipTaskWatcher`;panel 与 group 消费 | 消 ~40 行表单 effect + ~40 行三联块 JSX + 两处轮询样板 |
| 7 | comment-item 复用 `Thumb` | `comment-item.tsx:196-200` → `<Thumb .../>`,删手写 video/img 分支 | 去一处缩略图规则复制,Thumb 签名不变 |
| 8 | server 去重三连 | `file-index.ts`(`createFileIndex<T>`)+ `task-queue.ts`(`createQueue`);registry 的 `http(def)` 单参签名 | 消 ~30+10+15 行重复,原子写将来加锁只改一处 |
| 9 | BFF `schema-helpers.ts` | 合并 `nullable`(2×)+ `pageSchema(id,itemRef)` 工厂(4×) | 去 helper 复制 + 分页模板手抄,新增分页资源不再漏改 |

### B 组 —— 结构拆分,单独落地(纯移动为主,B2/B3 需评审目标结构)

| # | 事项 | 动哪里 | 风险 |
|---|---|---|---|
| 10 (B1) | 数据层 `projects.ts` 按子资源拆 | 886 行 → `projects-comments.ts`(~270)+ `projects-assets.ts`(~230)+ 主文件(~380 列表/字段/状态机)。不细拆到一 hook 一文件 | 低(纯移动,风险仅漏搬 import) |
| 11 (B2) | BFF `projects.ts` 拆 `projects/` 目录 | 1540 → `mappers.ts`(纯函数可单测)/`schemas.ts`/`routes-project|assets|comments|content.ts`;`registerProjectRoutes` 只做编排。顺手为 upstream 定义最小 interface 收敛 ~9 处裸 `any`+eslint-disable | 中 |
| 12 (B3) | `detail-content.tsx` 拆 | 424 → `useSlidingTabs()` hook(embla↔Tabs+下划线跟手)+ `project-detail-view.tsx`(只读态,与 MetaForm 编辑态对称);父组件降到 ~150 行 | 中 |

## 四、明确不动(避免为重构而重构)

- **`components/ui/` 60 文件**:纯 shadcn 生成物,保持「禁止手改」边界。其中 ~15 个 0 引用组件是 registry 整包拉取的正常副作用,不打包进产物、无运行时成本,不清理(嫌杂可 `npx shadcn diff` 后手动 rm)。
- **路由鉴权 5 文件**(`api-client`/`router-auth`/`login-redirect`/`global-router`/`router-context`):有意分层,`login-redirect` 是独立的开放重定向消毒安全边界,合并会破坏已做对的关注点分离。至多挪进 `lib/auth/` 物理归组(纯路径品味)。
- **`editor-app.tsx`**:接入边界清晰,模块级单例是刻意桥接 React 外单例。唯一债「切项目丢未保存改动」是产品决策阻塞,等拍板脏检查方案再补,不臆测抢先实现。
- **`lib/` 扁平结构**:每类仅 1-2 文件,拆子目录只多路径不减认知;某类 ≥4-5 文件且互相依赖时再议。
- **`video-overlays.ts` 状态机主体**:类型/轨道/apply/read/迁移是同一件事,有测试覆盖、分区清晰,不拆。至多把纯几何 `bannerBox/watermarkBox` 挪进 `video-overlays-geometry.ts`(可选)。
- **药丸菜单 / fields Group 标题 / replace-clip 的 fit**:均 ≤2 处且各自很短,现在抽是为 DRY 而 DRY,等第三个消费点再评估。
- **clip 两处 `onAssist`、infinite-combobox 的 commitOnClose vs closeOnSelect**:字段集合/机制本质不同,硬统一只会把两套可选参数塞进通用签名徒增理解成本,不合并(各加一行注释点明「非同一开关的单/多选形态」)。

## 五、执行顺序建议

A 组 9 项彼此独立、可各自 typecheck+test 验证后单独提交;B 组 3 项各自一个提交。建议 **A 组 → B1 → B2 → B3**,每步一提交,便于回溯。
