# bff — 产品后端 / 前端入口（骨架）

前端的**唯一控制面入口**。当前是**结构骨架 + 桩**:seam 已立,下游 XChangeAI 未接。

## 拓扑

```
浏览器 :5273 (editor)
  ├─ /api/*  控制面  ─vite→ BFF :4100 ─代理→ 渲染服务 :3011  (透明转发编辑器 transport 契约)
  ├─ /bff/*  产品面  ─vite→ BFF :4100                        (session / projects,自有)
  └─ 素材/产物       ── 直连 :3011/media (资产源,带 CORS)     (数据面,BFF 不搬运大文件)
```

## 职责边界

- **鉴权 seam**(`session.ts`):`onRequest` 钩子解析会话,现在恒放行。接 XChangeAI 时在此对未登录返 401,`getSession` 读真实会话。
- **产品面**(`projects.ts`):项目 CRUD,内存桩。**权威模型 = `UndoableState`**,产品字段挂 `metadata` sidecar,**BFF 不做模型翻译**(避免重演旧 ListingCut 的 mapProject/itemMeta 牵掣)。
- **协议代理**(`index.ts`):`/api/*` 原样转发到渲染服务。BFF 只翻译**协议 + 鉴权**,不翻译模型、不搬运媒体。

## 现为桩、待接 XChangeAI 的点(搜 `TODO`)

- `session.ts`:登录/登出/会话 → XChangeAI 真实鉴权
- `projects.ts`:内存 store → XChangeAI projects/assets(仅换取数,契约不变)

## 升级路径(生产)

- 数据面现在走渲染服务 `/media`(本地盘)。生产改为**签名 URL 直连对象存储/CDN**,浏览器不经 BFF 取媒体——BFF 保持只管控制面。

## 运行

`pnpm bff`(:4100)。需下游渲染服务(`pnpm server` :3011)在跑。见根 README 的三进程启动。
