# workbench-v2

基于 `@gedatou/editor`(Remotion 视频编辑器)重新起步的产品工作台。干净起点,**暂不含 XChangeAI 集成**。

## 现状(里程碑 1 + 渲染服务器)

- 独立 Vite + React 19 + TS 应用(`src/`),挂载 `<EditorRoot>`(时间轴 / 画布 / inspector)。
- 通过 **pnpm `link:`** 以 TS 源码消费 `@gedatou/editor` + `@gedatou/shared`(来自 sibling 仓 `../Remotion-demo/packages/*`)——**改库即时生效,免发版**。
- 默认适配器:`/api` transport + localStorage/IndexedDB storage + sonner 提示。
- **渲染服务器(`server/`)**:Fastify + `@remotion/{bundler,renderer}`,实现编辑器 transport 契约的 5 个端点。
  **去掉了 S3/minio**——素材上传与渲染产物落盘 `.data/`,经静态 `/media` 提供(免 docker)。
  - `/api/upload` 签发本地上传地址、`/api/blob/*` 收原始流入盘、`/api/delete-asset` 删除
  - `/api/render` 入队(内存 FIFO 单 worker)、`/api/progress` 轮询进度、产物 `.data/renders/*.mp4`
  - `/api/captions` 字幕转录(whisper.cpp,逐词时间戳);**复用 Remotion-demo 已构建的 `.whisper/`(binary + base 模型),免编译免下载**,`WHISPER_DIR`/`WHISPER_MODEL` 可覆盖
- **BFF(`bff/`,前端入口)**:Fastify + `@fastify/http-proxy`,:4100。控制面 `/api/*` 透明代理到渲染服务;自有产品面 `/bff/*`(session/projects,**内存桩**);鉴权 seam(`onRequest` 钩子,现恒放行,接 XChangeAI 时在此拦 401)。
  - 权威模型 = `UndoableState`,产品字段挂 `metadata` sidecar,**BFF 不做模型翻译、不搬运媒体**。详见 `bff/README.md`。
- 已验证端到端:编辑器点「渲染」→ vite → **BFF** → 渲染服务 → bundle → headless chrome → 1080×1920/30fps mp4 → 下载;素材 upload/取回/删除闭环;`/bff/session`、`/bff/projects` 桩可用。
- **暂缺(下一步)**:BFF 下游接 XChangeAI(登录/项目/交付,现为桩)。

## 前置

- Node ≥ 20,pnpm(与 Remotion-demo 一致,pnpm@10)。
- sibling 仓 `../Remotion-demo` 存在且已 `pnpm install`(link: 消费其 `packages/*` 源码 + 依赖)。

## 运行

需三个进程(三个终端):

```bash
pnpm install
pnpm server   # 渲染服务(下游) :3011（首次渲染会自动下载 headless chrome）
pnpm bff      # BFF(前端入口) :4100（/api 代理到 :3011，自有 /bff/*）
pnpm dev      # 编辑器 :5273（/api + /bff 代理到 :4100）
```

拓扑:`编辑器 :5273 → BFF :4100 →(代理)→ 渲染服务 :3011`;素材/产物走 `:3011/media` 直连。详见 `bff/README.md`。

## 关键决策

- **为何 link: 而非 npm 装 0.3.0**:短期还要同时打磨编辑器库,link: 吃源码改动即时生效(选型 B)。
- **dedupe**:`vite.config.ts` 强制 react/remotion/base-ui/zustand/mediabunny 单实例,否则库副本与 app 副本分裂导致 context 断裂。
- **Tailwind**:策略1——本仓拥有 Tailwind v4,`@source` 扫描 `../Remotion-demo/packages/editor/src` 生成工具类,再叠加库的 token 层。
