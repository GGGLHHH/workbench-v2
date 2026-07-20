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
- 已验证端到端:编辑器点「渲染」→ bundle 组合 → headless chrome → 1080×1920/30fps mp4 → 下载;素材 upload/取回/删除闭环。
- **暂缺(下一步)**:`/api/captions` 字幕转录(whisper,现为 501 桩)、XChangeAI 集成。

## 前置

- Node ≥ 20,pnpm(与 Remotion-demo 一致,pnpm@10)。
- sibling 仓 `../Remotion-demo` 存在且已 `pnpm install`(link: 消费其 `packages/*` 源码 + 依赖)。

## 运行

需两个进程(两个终端):

```bash
pnpm install
pnpm server   # 渲染服务器 :3011（首次渲染会自动下载 headless chrome）
pnpm dev      # 编辑器 :5273（/api 代理到 :3011）
```

## 关键决策

- **为何 link: 而非 npm 装 0.3.0**:短期还要同时打磨编辑器库,link: 吃源码改动即时生效(选型 B)。
- **dedupe**:`vite.config.ts` 强制 react/remotion/base-ui/zustand/mediabunny 单实例,否则库副本与 app 副本分裂导致 context 断裂。
- **Tailwind**:策略1——本仓拥有 Tailwind v4,`@source` 扫描 `../Remotion-demo/packages/editor/src` 生成工具类,再叠加库的 token 层。
