# Lattice Shared Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking. Do not commit, push, deploy, or modify release artifacts unless the user explicitly requests it.

**Goal:** 在不破坏 Lattice 本地优先工作区和现有 PDF 批注体验的前提下，构建跨 Web/Desktop 的共享 Library、通用 Item Workspace、云端文件版本、权限、同步、批注协作和搜索基础。

**Architecture:** 共享能力通过 domain/repository/sync/blob 四个边界接入。Web 和 Desktop 共用领域模型、权限矩阵、操作协议和同步核心；Web 使用浏览器缓存，Desktop 使用 Tauri 文件系统；云端使用 Auth + Postgres/RLS 保存元数据和操作日志，R2/S3 保存大文件，通过 Worker/Pages Function 签发短时 URL。

**Tech Stack:** Next.js 16、React 19、TypeScript、Zustand、Jotai、Tauri 2、Supabase Auth/Postgres/RLS、Cloudflare Worker/R2、Vitest、Playwright、现有 PDF/Markdown/Code/Word/Notebook/PPT renderer。

**Source of truth:** `docs/superpowers/specs/2026-08-20-lattice-shared-library-design.md`

---

## 0. 执行规则

- 每次只实现一个 Task，Task 完成后运行它的验证命令。
- 不在 React 组件里直接访问 Supabase 表或 R2。
- 所有跨端写入必须生成可幂等的 operation。
- 不修改现有 PDF annotation 的坐标语义。
- 不使用 service role key 运行浏览器或桌面代码。
- 不提交 Git，不部署 Web，不刷新 `releases/`，除非用户明确要求。
- 每个 Task 都要保留 deterministic fake，确保本地测试无需真实云资源。

---

## Task 1: 建立共享库领域类型与错误契约

**Files:**
- Create: `src/lib/shared-library/domain.ts`
- Create: `src/lib/shared-library/errors.ts`
- Create: `src/lib/shared-library/validators.ts`
- Create: `src/lib/shared-library/__tests__/domain.test.ts`
- Create: `src/lib/shared-library/__tests__/validators.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖以下行为：

```ts
it('normalizes item kinds without changing unknown values', () => {
  expect(normalizeItemKind('application/pdf')).toBe('pdf');
  expect(normalizeItemKind('text/x-typescript')).toBe('code');
  expect(normalizeItemKind('application/octet-stream')).toBe('data');
});

it('rejects annotation geometry that uses viewport pixels', () => {
  expect(() => parseAnnotationTarget({ viewportX: 10 })).toThrow('normalized');
});

it('keeps operation idempotency key stable', () => {
  expect(buildIdempotencyKey({ deviceId: 'd1', clientSequence: 2 })).toBe('d1:2');
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`npm run test:run -- src/lib/shared-library/__tests__/domain.test.ts src/lib/shared-library/__tests__/validators.test.ts`

预期：因模块和函数尚不存在而失败。

- [ ] **Step 3: 实现类型和校验**

定义 `LibraryRole`、`Library`、`Collection`、`Item`、`ItemVersion`、`Annotation`、`SharedEvidenceRef`、`SyncOperation`、`SyncConflict`、`SyncStatus`。所有日期使用 ISO 字符串；所有实体 ID 使用 branded string 或清晰命名，不使用文件路径作为主键。

- [ ] **Step 4: 运行测试确认通过**

运行同一命令，预期所有断言通过。

- [ ] **Step 5: 运行类型检查**

运行：`npm run typecheck`

预期：无新增 TypeScript 错误。

---

## Task 2: 实现权限矩阵与 capability 检查

**Files:**
- Create: `src/lib/shared-library/permissions.ts`
- Create: `src/lib/shared-library/__tests__/permissions.test.ts`
- Modify: `src/lib/shared-library/domain.ts`

- [ ] **Step 1: 写失败测试**

覆盖 owner/admin/editor/commenter/viewer 对以下操作的结果：读取 Item、上传版本、创建批注、编辑自己的评论、编辑别人的评论、管理成员、删除 Library、恢复 Item。

- [ ] **Step 2: 运行失败测试**

运行：`npm run test:run -- src/lib/shared-library/__tests__/permissions.test.ts`

- [ ] **Step 3: 实现纯函数权限表**

使用 `can(role, capability)` 和 `assertCan(role, capability)`；不得读取 React state，不得访问网络。

- [ ] **Step 4: 测试和类型检查**

运行：`npm run test:run -- src/lib/shared-library/__tests__/permissions.test.ts`、`npm run typecheck`。

---

## Task 3: 建立本地和远程 Repository 接口

**Files:**
- Create: `src/lib/shared-library/repository.ts`
- Create: `src/lib/shared-library/local-repository.ts`
- Create: `src/lib/shared-library/remote-repository.ts`
- Create: `src/lib/shared-library/__tests__/repository-contract.test.ts`

- [ ] **Step 1: 定义接口**

接口至少包含：

```ts
interface SharedLibraryRepository {
  listLibraries(): Promise<Library[]>;
  getLibrary(libraryId: string): Promise<Library>;
  listItems(input: { libraryId: string; collectionId?: string }): Promise<Item[]>;
  getItem(itemId: string): Promise<Item>;
  createItem(input: CreateItemInput): Promise<Item>;
  updateItem(input: UpdateItemInput): Promise<Item>;
  listAnnotations(itemId: string): Promise<Annotation[]>;
  appendOperation(operation: SyncOperation): Promise<void>;
}
```

- [ ] **Step 2: 为 local repository 写 contract tests**

测试创建 Library、Item、子 Item、版本、批注和删除恢复；测试数据必须在每个用例前重置。

- [ ] **Step 3: 实现内存 deterministic local adapter**

第一版可以用 Map 实现测试 adapter；不要把 Map 代码混进生产 repository。

- [ ] **Step 4: 为 remote repository 留出 transport 注入点**

`RemoteRepository` 接收 `SharedLibraryTransport`，transport 负责 HTTP；repository 只负责请求/响应映射和 schema 校验。

- [ ] **Step 5: 运行测试**

运行：`npm run test:run -- src/lib/shared-library/__tests__/repository-contract.test.ts`。

---

## Task 4: 增加本地持久化同步队列

**Files:**
- Create: `src/lib/shared-library/sync-queue.ts`
- Create: `src/lib/shared-library/sync-engine.ts`
- Create: `src/stores/shared-library-sync-store.ts`
- Create: `src/lib/shared-library/__tests__/sync-queue.test.ts`
- Create: `src/lib/shared-library/__tests__/sync-engine.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：入队、按 client sequence 排序、重复 idempotency key 去重、指数退避、网络失败后保留、成功后删除、永久拒绝进入 conflict。

- [ ] **Step 2: 实现 queue storage adapter**

定义 `SyncQueueStorage`：`put`、`listPending`、`markAccepted`、`markRetryable`、`markConflict`。Web 使用 IndexedDB adapter；测试使用内存 adapter；Desktop 后续接 Tauri 文件 adapter。

- [ ] **Step 3: 实现 SyncEngine 状态机**

状态只允许 `offline`、`registering`、`pulling`、`ready`、`pushing`、`conflicted`、`failed`。任何网络异常都不能删除 pending operation。

- [ ] **Step 4: 验证崩溃恢复**

测试在 push 过程中抛出异常，重新创建 engine 后仍能读取 pending operations。

- [ ] **Step 5: 运行测试和类型检查**

运行：`npm run test:run -- src/lib/shared-library/__tests__/sync-queue.test.ts src/lib/shared-library/__tests__/sync-engine.test.ts`、`npm run typecheck`。

---

## Task 5: 建立数据库 migration、索引和 RLS

**Files:**
- Create: `supabase/migrations/202608200001_shared_library_core.sql`
- Create: `supabase/migrations/202608200002_shared_library_rls.sql`
- Create: `supabase/seed/shared-library.sql`
- Create: `src/lib/shared-library/__tests__/shared-library-schema.test.ts`

- [ ] **Step 1: 创建核心表**

按设计文档创建 organizations、organization_members、libraries、library_members、collections、items、item_children、blobs、item_versions、annotations、annotation_comments、annotation_operations、sync_operations、sync_cursors、activities、invitations、trash_entries、search_documents。

- [ ] **Step 2: 添加约束和索引**

添加 Library membership、Item library ownership、唯一 idempotency key、`(library_id, updated_at)`、`(item_id, version_number)`、全文搜索索引和活动时间索引。

- [ ] **Step 3: 写 RLS**

每个表至少包含 authenticated select/insert/update/delete policy；所有 policy 必须通过 library membership 或 organization membership 验证，不能依赖客户端传入 role。

- [ ] **Step 4: 写 schema smoke test**

使用 Supabase local 或 SQL parser 检查所有必需表、约束和 policy 存在；CI 没有 Supabase runtime 时运行静态 migration contract test。

- [ ] **Step 5: 本地执行 migration**

运行：`supabase db reset`（若本机安装 Supabase CLI）；否则执行仓库定义的 migration check，并记录缺少 CLI 的事实，不伪造通过。

---

## Task 6: 实现 Auth、设备和会话边界

**Files:**
- Create: `src/lib/shared-library/auth-session.ts`
- Create: `src/lib/shared-library/device-identity.ts`
- Create: `src/lib/shared-library/__tests__/auth-session.test.ts`
- Modify: `src/lib/persist-storage.ts`
- Modify: `src/lib/desktop-window.ts`（仅在现有桌面 bridge 适合的位置接入）

- [ ] **Step 1: 写 session contract tests**

覆盖登录、登出、刷新、过期、撤销设备、纯本地模式不触发登录请求。

- [ ] **Step 2: 实现 platform-neutral session interface**

定义 `AuthSessionProvider`，Web 和 Desktop 只替换 token storage 与 OAuth callback adapter。

- [ ] **Step 3: 实现设备 ID**

首次启动生成稳定 `deviceId`；不使用 IP、机器名或用户文件路径作为设备 ID。

- [ ] **Step 4: 运行测试**

运行：`npm run test:run -- src/lib/shared-library/__tests__/auth-session.test.ts`。

---

## Task 7: 实现 Cloud API transport 和结构化错误

**Files:**
- Create: `src/lib/shared-library/api-transport.ts`
- Create: `src/lib/shared-library/api-contracts.ts`
- Create: `src/lib/shared-library/__tests__/api-transport.test.ts`
- Create: `workers/shared-library-api/src/index.ts`
- Create: `workers/shared-library-api/src/errors.ts`
- Create: `workers/shared-library-api/src/auth-context.ts`

- [ ] **Step 1: 定义 API envelope**

所有响应包含 `requestId`；错误包含 `code`、`message`、`retryable`、`entityType`、`entityId`。

- [ ] **Step 2: 实现 transport**

transport 负责 base URL、Bearer token、Idempotency-Key、超时、JSON 校验和错误映射；不得暴露 service role key。

- [ ] **Step 3: 实现 Worker auth context**

Worker 从 Supabase JWT 获取 userId，只把最小身份上下文传递给 handler；每个 handler 再检查 library capability。

- [ ] **Step 4: 写越权测试**

测试无 token、过期 token、非成员、viewer 写操作和 libraryId/itemId 不匹配都返回明确错误。

- [ ] **Step 5: 运行测试**

运行：`npm run test:run -- src/lib/shared-library/__tests__/api-transport.test.ts`。

---

## Task 8: 实现对象存储、分片上传和版本提交

**Files:**
- Create: `src/lib/shared-library/blob-store.ts`
- Create: `src/lib/shared-library/upload-session.ts`
- Create: `src/lib/shared-library/__tests__/upload-session.test.ts`
- Create: `workers/shared-library-api/src/blob-routes.ts`
- Create: `workers/shared-library-api/src/storage-signing.ts`

- [ ] **Step 1: 写上传状态测试**

覆盖 create、upload part、retry part、complete hash mismatch、abort、expired session、duplicate complete。

- [ ] **Step 2: 实现 BlobStore 接口**

定义 `createUpload`、`getPartUrl`、`completeUpload`、`getDownloadUrl`、`abortUpload`。R2 实现只在 Worker 侧调用；测试实现使用 fake object store。

- [ ] **Step 3: 实现客户端上传调度器**

限制并发分片数；每个分片单独 retry；页面关闭前把 upload session 写入本地 storage。

- [ ] **Step 4: 完成版本事务**

complete 后先校验 hash，再写 blob、item_version、current_version 和 operation；任一步失败不得把 Item 标记为 ready。

- [ ] **Step 5: 运行测试**

运行：`npm run test:run -- src/lib/shared-library/__tests__/upload-session.test.ts`。

---

## Task 9: 把 PDF Item Workspace 迁移到通用 Item Workspace

**Files:**
- Create: `src/lib/shared-library/item-workspace.ts`
- Create: `src/lib/shared-library/migration.ts`
- Create: `src/lib/shared-library/__tests__/item-workspace.test.ts`
- Create: `src/lib/shared-library/__tests__/migration.test.ts`
- Modify: `src/lib/pdf-item.ts`
- Modify: `src/components/renderers/pdf-item-workspace-panel.tsx`

- [ ] **Step 1: 写兼容测试**

读取现有 `.lattice/items/<fileId>/manifest.json`、子文件和 annotation sidecar，断言迁移后 `itemId`、相对路径、manifest version、annotation payload 和原始文件保持可回溯。

- [ ] **Step 2: 实现通用 workspace projection**

将 child relation 投影为现有 Explorer 能理解的虚拟子节点；不得把 `.lattice/` 内部目录直接暴露出来。

- [ ] **Step 3: 实现 migration planner**

planner 只生成迁移 operation 和 upload plan，不直接删除本地文件；实际写入由 approved executor 执行。

- [ ] **Step 4: 保持 PDF 专用逻辑**

PDF text kernel、normalized geometry、annotation repair 和 page navigation 继续使用现有实现；通用 Item 层只承载 identity、version、child relation 和 remote state。

- [ ] **Step 5: 运行 PDF 回归测试**

运行：`npm run test:run -- src/lib/__tests__/pdf-item.test.ts src/components/renderers/__tests__/pdf-item-workspace-panel.test.tsx`。

---

## Task 10: 实现 Annotation Remote Adapter 与评论线程

**Files:**
- Create: `src/lib/shared-library/annotation-remote-adapter.ts`
- Create: `src/lib/shared-library/comment-thread.ts`
- Create: `src/lib/shared-library/__tests__/annotation-remote-adapter.test.ts`
- Create: `src/lib/shared-library/__tests__/comment-thread.test.ts`
- Modify: `src/lib/annotation-storage.ts`
- Modify: `src/lib/universal-annotation-storage.ts`
- Modify: `src/components/renderers/pdf-annotation-sidebar.tsx`

- [ ] **Step 1: 写 schema compatibility tests**

旧 sidecar -> remote annotation -> 旧 viewer projection 往返转换；规范化坐标、quote、page、style、comment metadata 不丢失。

- [ ] **Step 2: 实现 annotation operation mapping**

`create/update/delete/resolve` 都生成带 `annotationId`、`revision`、`baseVersion` 和 `idempotencyKey` 的 operation。

- [ ] **Step 3: 实现评论线程**

评论只追加新消息；编辑和删除保留 activity；commenter 只能修改自己的未锁定评论。

- [ ] **Step 4: 接入 PDF sidebar**

sidebar 展示作者、时间、同步状态和冲突入口；继续通过现有导航 store 跳到 PDF 页和 annotation。

- [ ] **Step 5: 运行 focused tests**

运行：`npm run test:run -- src/lib/shared-library/__tests__/annotation-remote-adapter.test.ts src/lib/shared-library/__tests__/comment-thread.test.ts src/components/renderers/__tests__/pdf-annotation-sidebar.test.tsx`。

---

## Task 11: 实现 Web Library Shell 与 Item Workspace UI

**Files:**
- Create: `src/app/library/page.tsx`
- Create: `src/app/library/[libraryId]/page.tsx`
- Create: `src/app/library/[libraryId]/item/[itemId]/page.tsx`
- Create: `src/components/shared-library/library-shell.tsx`
- Create: `src/components/shared-library/library-sidebar.tsx`
- Create: `src/components/shared-library/library-home.tsx`
- Create: `src/components/shared-library/item-workspace-shell.tsx`
- Create: `src/components/shared-library/item-tree.tsx`
- Create: `src/components/shared-library/item-context-panel.tsx`
- Create: `src/components/shared-library/sync-status-indicator.tsx`
- Create: `src/components/shared-library/__tests__/library-shell.test.tsx`
- Create: `src/components/shared-library/__tests__/item-workspace-shell.test.tsx`

- [ ] **Step 1: 写 UI contract tests**

测试：无 Library、加载中、已加载、无权限、离线、冲突、空 Collection、Item 有子文件和批注等状态。

- [ ] **Step 2: 实现 route-level loading/error 状态**

不能用无限 spinner；所有失败状态显示错误码摘要、重试按钮和返回路径。

- [ ] **Step 3: 实现三栏 shell**

桌面宽度显示 Library sidebar / workbench / context panel；窄屏将 sidebar/context panel 变为抽屉，固定 viewer 尺寸不随状态文字变化。

- [ ] **Step 4: 接入现有 viewer route**

根据 `FileKind` 进入现有 PDF、code、markdown、word、notebook、pptx、html viewer，不复制 viewer 实现。

- [ ] **Step 5: 运行浏览器级组件测试**

运行：`npm run test:run -- src/components/shared-library/__tests__/library-shell.test.tsx src/components/shared-library/__tests__/item-workspace-shell.test.tsx`。

---

## Task 12: 实现 Desktop 同步桥接和后台队列

**Files:**
- Create: `src/lib/shared-library/desktop-sync-adapter.ts`
- Create: `src/lib/shared-library/__tests__/desktop-sync-adapter.test.ts`
- Create: `src-tauri/src/shared_library.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/hooks/use-file-system.ts`
- Modify: `src/stores/shared-library-sync-store.ts`

- [ ] **Step 1: 定义 Tauri commands**

至少包含：`shared_library_read_identity`、`shared_library_write_queue_entry`、`shared_library_list_queue`、`shared_library_remove_queue_entry`、`shared_library_atomic_write`。

- [ ] **Step 2: 写 Tauri command tests**

测试路径规范化、workspace root 限制、原子写入临时文件替换、队列重启恢复和无效路径拒绝。

- [ ] **Step 3: 接入文件 watcher**

只把已绑定到 Shared Item 的本地文件变更加入 queue；外部 `.lattice/` 文件变化不能直接广播为用户文件变更。

- [ ] **Step 4: 验证离线编辑**

桌面端断网后编辑 Markdown、创建 PDF annotation、退出并重启，断言 queue 和本地文件均保留。

- [ ] **Step 5: 运行 desktop focused tests**

运行：`npm run test:run -- src/lib/shared-library/__tests__/desktop-sync-adapter.test.ts`，再运行对应 Rust tests。

---

## Task 13: 实现搜索、索引任务和网页快照

**Files:**
- Create: `src/lib/shared-library/search-client.ts`
- Create: `src/lib/shared-library/web-snapshot.ts`
- Create: `src/lib/shared-library/__tests__/search-client.test.ts`
- Create: `src/lib/shared-library/__tests__/web-snapshot.test.ts`
- Create: `workers/shared-library-api/src/jobs/index.ts`
- Create: `workers/shared-library-api/src/jobs/extract-text.ts`
- Create: `workers/shared-library-api/src/jobs/snapshot-url.ts`
- Create: `workers/shared-library-api/src/jobs/generate-thumbnail.ts`
- Modify: `src/lib/searchable-text.ts`

- [ ] **Step 1: 写搜索结果 contract tests**

结果必须带 itemId、childItemId、sourceType、snippet、locator、permission snapshot 和更新时间。

- [ ] **Step 2: 复用本地 searchable text**

本地索引和远程索引共用 text normalization；不要实现第二套 markdown/PDF 文本清洗逻辑。

- [ ] **Step 3: 实现 URL-only/snapshot-ready 状态机**

阻止 SSRF、私有 IP、危险协议和未净化 HTML；快照失败后仍保留 URL-only Item。

- [ ] **Step 4: 实现抽取/缩略图任务**

任务幂等；失败记录 reason、attempts、nextRetryAt；任务状态可从 UI 读取。

- [ ] **Step 5: 运行测试**

运行：`npm run test:run -- src/lib/shared-library/__tests__/search-client.test.ts src/lib/shared-library/__tests__/web-snapshot.test.ts src/lib/__tests__/searchable-text.test.ts`。

---

## Task 14: 实现冲突中心、活动流和管理员成员页

**Files:**
- Create: `src/lib/shared-library/conflict-model.ts`
- Create: `src/lib/shared-library/activity.ts`
- Create: `src/components/shared-library/conflict-center.tsx`
- Create: `src/components/shared-library/member-management.tsx`
- Create: `src/components/shared-library/activity-panel.tsx`
- Create: `src/components/shared-library/__tests__/conflict-center.test.tsx`
- Create: `src/components/shared-library/__tests__/member-management.test.tsx`

- [ ] **Step 1: 写冲突分类测试**

覆盖 binary version conflict、annotation revision conflict、delete/edit conflict、permission revoked、quota exceeded。

- [ ] **Step 2: 实现冲突 view model**

UI 必须显示 entity、双方版本、创建人、时间、推荐动作和可恢复 payload；不能只显示“同步失败”。

- [ ] **Step 3: 实现解决动作**

保留本地、采用远程、复制为新 Item、合并批注、恢复删除分别调用不同 operation。

- [ ] **Step 4: 实现成员管理**

邀请、角色变更、暂停和撤销访问都显示影响范围；viewer 不应看到管理入口。

- [ ] **Step 5: 运行测试**

运行：`npm run test:run -- src/components/shared-library/__tests__/conflict-center.test.tsx src/components/shared-library/__tests__/member-management.test.tsx`。

---

## Task 15: 集成 Web/Desktop/Cloud 冒烟流程

**Files:**
- Create: `scripts/shared-library-smoke.mjs`
- Create: `src/lib/shared-library/__tests__/shared-library-e2e-contract.test.ts`
- Create: `docs/tests/shared-library-smoke-checklist.md`

- [ ] **Step 1: 写端到端 contract test**

模拟两个用户和两个设备：创建 Library、邀请、上传 PDF、创建子 Markdown、批注、断网、恢复、拉取、搜索、删除、恢复。

- [ ] **Step 2: 实现 smoke runner**

runner 使用 fake transport/blob/job，不依赖真实 Supabase/R2；输出 JSON 结果，包含每一步 operationId、状态和失败原因。

- [ ] **Step 3: 加入浏览器流程**

使用 Playwright 验证 Web route、三栏布局、PDF 打开、批注跳转、离线状态和 conflict panel。

- [ ] **Step 4: 加入桌面流程**

在 Tauri smoke 环境验证登录回调、本地 workspace、queue 恢复和关闭重启。

- [ ] **Step 5: 运行完整门禁**

运行：

```powershell
npm run lint
npm run typecheck
npm run test:docs
npm run test:run
npm run build
npm run qa:gate
```

只有命令真实退出码为 0，才能把该阶段标记为完成。

---

## Task 16: 文档、迁移和发布准备

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/USER_GUIDE.md`
- Create: `docs/guides/shared-library.md`
- Create: `docs/guides/shared-library-admin.md`
- Create: `docs/operations/shared-library-runbook.md`
- Create: `docs/tests/shared-library-release-checklist.md`

- [ ] **Step 1: 更新架构文档**

写清 Shared Library repository、sync engine、RLS、R2、Worker 和 local-first 边界。

- [ ] **Step 2: 更新用户指南**

写清创建 Library、邀请成员、批注、子文件、离线、冲突和恢复，不宣传尚未通过验收的实时协作。

- [ ] **Step 3: 写运维手册**

包含 migration、备份恢复、队列积压、R2 失败、索引失败、签名 URL 泄漏响应和账号撤销流程。

- [ ] **Step 4: 运行文档检查**

运行：`npm run test:docs`。

- [ ] **Step 5: 运行项目质量门禁**

运行：`npm run qa:gate`。不执行部署、release refresh 或 Git commit。

---

## 验收总表

- [ ] 未授权用户无法从 API、对象 URL、缓存或搜索读取内容。
- [ ] PDF normalized geometry 在 Web/Desktop 一致。
- [ ] 离线变更重新联网后最终可见。
- [ ] 重复 operation 不产生重复实体。
- [ ] 冲突可见且不会静默覆盖。
- [ ] Item 子文件、版本、批注和回收站恢复关系完整。
- [ ] PDF、Markdown、代码、Notebook、Word、PPT、HTML 至少有正确 renderer 路由。
- [ ] 任务失败有状态和重试入口。
- [ ] Web/Desktop UI 在宽屏、窄屏和离线状态无重叠或不可操作控件。
- [ ] `lint`、`typecheck`、focused tests、`build` 和 `qa:gate` 有新鲜输出证据。

