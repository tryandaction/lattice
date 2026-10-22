# Lattice 共享研究库：跨平台、云端同步与多格式协作设计

> 文档状态：设计基线 v1.0
>
> 日期：2026-08-20
>
> 适用范围：Lattice Web、Lattice Desktop、云端共享服务、同步客户端、文件预览、子文件、批注、搜索、权限、安全和运维
>
> 本文是后续实现的产品与架构事实源。实现计划见 `docs/superpowers/plans/2026-08-20-lattice-shared-library-implementation.md`；可直接交给 AI 开发代理的提示词见 `docs/prompts/lattice-shared-library-ai-development-prompt.md`。

---

## 1. Executive Summary

Lattice 要构建的不是“把本地文件上传到云端”的网盘，而是一个以研究 Item 为中心的共享工作区：PDF、代码、Markdown、Notebook、Word、PPT、图片、网页快照和数据文件都可以进入同一个 Library；每个 Item 具有版本、子文件、结构化批注、评论、证据定位和活动记录。

核心产品判断：

1. Lattice 继续保持 **local-first**。桌面端可以在无网络时打开、阅读、批注和编辑；联网后再同步。
2. 云端是 **共享事实层**，负责身份、权限、元数据、文件对象、操作日志、索引和恢复能力。
3. 当前 PDF item workspace 和批注系统是差异化基础，不能被普通附件模型替代。
4. 子文件不是简单的目录展示，而是 Item 的一等组成部分，可以独立打开、搜索、关联和版本化。
5. 实时消息只负责降低延迟，不能作为唯一持久化来源；所有共享变更必须可恢复、可重放、可审计。
6. 第一版不追求 Google Docs 级别的所有内容实时协作，先保证可靠的版本同步和 PDF 批注协作，再对 Markdown/评论引入 CRDT。

最终体验目标：

> 用户打开一个共享研究库，选中一篇论文；左侧看到论文、代码、笔记、Notebook、数据和网页子文件，中央阅读或编辑内容，右侧看到批注、讨论、引用和变更历史，并能在网页端、桌面端和离线状态下保持同一份工作上下文。

---

## 2. 当前 Lattice 基线

### 2.0 共享库前置完整性门禁

共享库开发必须建立在 PDF Item Workspace 已通过移动、重命名、嵌套工作区和权限恢复回归的基础上。具体不变量如下：

- PDF 的 stable `documentId`、content fingerprint 和 item workspace folder 相互独立；路径变化不能导致 companion folder 被重建或删除。
- 从嵌套目录打开 PDF 时，读取、创建子文件、批注和 Markdown 镜像都必须回到祖先 `.lattice` root，并使用完整 canonical path。
- PDF 被移动到另一个独立 root 时，先通过全局 location catalog 查找原 item workspace；找不到授权 root 时显示 `unavailable` 并要求重新授权，不能显示为空的 `ready`。
- PDF viewer、annotation storage、Item Workspace panel 和 Explorer virtual children 必须使用同一个 resolved item root；PDF 二进制仍使用当前位置的 file handle。
- 只有这些不变量通过 focused tests、全量 tests、typecheck、build 和 Tauri build 后，才允许继续接入共享库云端同步，避免把路径错误扩大到远程数据。

### 2.1 已有能力

当前仓库已经具备以下可以直接复用的能力：

- Next.js 16、React 19、Tauri 2 的 Web/Desktop 共享壳层
- File System Access API、IndexedDB、Tauri 文件系统桥接
- Zustand 工作区状态与 Jotai 编辑器状态
- CodeMirror 6 代码编辑
- Tiptap/Markdown 渲染与编辑
- PDF 阅读、搜索、文本坐标、批注、引用定位和批注侧栏
- PDF Item Workspace：`paper.pdf` 对应 `.lattice/items/<fileId>/`
- PDF 批注 sidecar：`.lattice/annotations/<itemId>.json`
- Word、HTML、图片、Notebook、PPT 等预览入口
- 共享搜索抽取工具 `src/lib/searchable-text.ts`
- 统一 link router、EvidenceRef 和 AI 上下文图

依据：

- [Lattice Architecture](C:/universe/software%20development/me/Lattice/docs/ARCHITECTURE.md)
- [PDF Item Workspace Routing Design](C:/universe/software%20development/me/Lattice/docs/PDF_ITEM_WORKSPACE_ROUTING_DESIGN.md)
- [Zotero-grade PDF Reading Design](C:/universe/software%20development/me/Lattice/docs/superpowers/specs/2026-07-26-zotero-grade-pdf-reading-design.md)
- [package.json](C:/universe/software%20development/me/Lattice/package.json)

### 2.2 当前边界

仓库当前定位仍然是本地优先研究工作台，未形成完整的多租户云端数据平面。实现共享库时不能假设已有以下能力：

- 用户注册、登录、会话刷新和设备管理
- Organization、Library、Member、Role 等云端实体
- 云端对象存储和大文件分片上传
- 持久化同步游标、操作日志和冲突队列
- 远程全文索引和增量索引任务
- 共享库级别的访问审计、配额、限流和删除恢复

所以本项目必须增加清晰的 remote adapter，而不是把远程请求散落到现有 viewer 和 store 中。

### 2.3 兼容性原则

- 不改变现有本地工作区的文件布局和打开方式。
- 不把云端登录强制注入纯本地使用流程。
- 不让 PDF 批注从现有规范化坐标退回到浏览器 client rect。
- 不把 `.lattice/` 内部文件暴露为用户普通文件。
- 不让桌面端持有服务端密钥。
- 不用一个“万能共享文件组件”吞掉 PDF、代码、文档各自已有的编辑器能力。

---

## 3. 产品定义

### 3.1 核心对象

```text
Account
  └── Organization
        └── Library
              ├── Collection（可嵌套分类）
              │     └── Item
              │           ├── Item Workspace
              │           │     ├── 子文件
              │           │     ├── 子文件夹
              │           │     └── 关系链接
              │           ├── 批注与评论线程
              │           ├── 文件版本
              │           └── 活动记录
              ├── 成员、邀请和角色
              ├── 标签与保存的搜索
              └── 审计日志、配额和回收站
```

### 3.2 术语

| 术语 | 定义 |
|---|---|
| Organization | 计费、成员和安全策略的边界；个人用户也拥有一个默认 Organization |
| Library | 可共享的研究库；权限、同步和搜索的主要边界 |
| Collection | Library 内的逻辑分类，可嵌套；不直接决定文件的物理路径 |
| Item | 一个可被阅读、编辑、引用和批注的主对象，例如论文 PDF、代码仓库快照、网页快照或文档 |
| Item Workspace | Item 的子文件和关联资源集合；PDF 现有 item workspace 将迁移到通用模型 |
| Annotation | 绑定到 Item 内容位置的结构化批注，可包含高亮、区域、文字、手写、评论和标签 |
| Evidence Ref | 可跳回 PDF 页码、PDF 批注、Markdown 标题、代码行、Notebook cell 或网页段落的稳定定位 |
| Version | 内容或结构的一次不可变版本；批注和评论不直接覆盖历史版本 |
| Operation | 对 Item、子文件、批注、评论或权限的可审计变更 |

### 3.3 目标用户

1. 个人研究者：在桌面端管理论文、笔记、代码和实验数据。
2. 研究小组：共同阅读论文、批注、讨论和维护实验记录。
3. 教师/学生：分发阅读材料，保留问题、答案和引用证据。
4. 工程团队：把技术文档、源码、设计稿、运行结果和评审意见放到一个 Item Workspace。
5. 组织管理员：管理成员、权限、配额、审计和生命周期策略。

### 3.4 成功指标

第一阶段不以注册量为唯一目标，而以可靠工作流为目标：

- 用户可以在 60 秒内创建 Library 并邀请成员。
- 100 MB 以内文件的首次上传在稳定网络下可恢复，不因刷新而丢失。
- 同一批 PDF 批注在 Web/Desktop 两端的页码和几何位置一致。
- 无网络时创建的批注和笔记在重新联网后最终可见，不能静默丢失。
- 查看者无法读取未授权 Library 的对象 URL。
- 删除文件后可以从回收站恢复版本、子文件和批注。
- 工作区搜索能区分 Item 正文、子文件、批注和评论结果。
- 同步失败时界面明确显示原因、重试动作和冲突对象。

---

## 4. 产品范围与非目标

### 4.1 第一版本必须包含

- Email/OAuth 登录和设备会话
- 创建、重命名、归档和删除 Library
- 邀请成员、角色变更和撤销访问
- Collection 和嵌套 Collection
- 上传和导入 PDF、Markdown、代码、Notebook、Word、PPT、图片、HTML
- URL 导入为网页快照；动态网页可降级为 URL 元数据
- Item Workspace 子文件和关联资源
- PDF 高亮、区域、文字、手写和评论批注同步
- Item/子文件版本、回收站和恢复
- Library 内全文搜索、过滤、标签和保存搜索
- Web 与 Desktop 的本地缓存和同步状态
- 审计活动流、配额提示和错误重试

### 4.2 第一版本明确不做

- 公开互联网论文发现与全文下载平台
- 复制 Zotero 的品牌、私有代码或未经授权的数据源
- 无限制多人同时编辑所有文件格式
- 把任意网页的登录态或私人页面上传到服务器
- 自动替用户执行上传文件中的代码
- 自动删除或覆盖冲突版本
- 在没有用户确认的情况下由 AI 修改原始文件或批注
- 企业级 SSO、SCIM、HIPAA、复杂账单和跨区域主从复制

---

## 5. 产品与视觉设计

### 5.1 总体界面

共享库采用“工作区优先”而不是营销首页。进入应用后直接落在最近使用的 Library 和 Item。

```text
┌──────────────────────────────────────────────────────────────────┐
│ Lattice | Library Switcher | 搜索 | Sync 状态 | 账户            │
├───────────────┬───────────────────────────┬──────────────────────┤
│ Library 导航  │ Item / 阅读编辑工作区      │ Context 面板          │
│               │                           │                      │
│ 收藏          │ Tab / 面包屑              │ 批注                 │
│ Collections   │                           │ 评论线程             │
│ 标签          │ PDF / Code / 文档 / 网页   │ 子文件               │
│ 回收站        │                           │ 版本                 │
│ 成员(管理员)  │                           │ 活动                 │
└───────────────┴───────────────────────────┴──────────────────────┘
```

设计原则：

- 页面是连续工作区，不使用层层嵌套卡片堆叠。
- Item、批注、子文件、版本使用同一右侧 Context 面板切换。
- 状态优先显示“已同步、待同步、冲突、离线、无权限、上传失败”，而不是只显示旋转加载。
- 熟悉操作使用图标按钮和工具提示；带风险的操作必须有明确文字确认。
- 桌面端支持紧凑三栏和多窗格，Web 端支持两栏和移动端抽屉。

### 5.2 Library 首页

Library 首页包含：

1. 最近打开的 Item。
2. 待处理同步和冲突。
3. 最近批注与评论。
4. Collection 树。
5. 过滤器：类型、标签、作者、更新时间、是否有未读评论、是否有冲突。
6. 创建入口：上传文件、导入 URL、新建笔记、新建 Notebook、创建空 Item。

不做大幅 Hero 或宣传语，第一屏必须让用户直接开始管理和阅读。

### 5.3 Item Workspace

Item Workspace 顶部固定显示：

- Item 标题、类型徽标、所属 Collection
- 当前版本和同步状态
- 权限摘要
- 分享/复制内部链接
- 更多菜单：移动、复制、导出、归档、回收站

左侧显示子文件树，中间显示当前文件，右侧显示 Context 面板。PDF 的批注工具栏继续复用现有 PDF viewer，不在共享库层重新实现。

### 5.4 批注设计

- PDF 批注继续采用现有选择、Highlight、Area、Text Note 模式。
- 每条批注都显示作者、创建时间、颜色、评论状态和同步状态。
- 评论线程与几何批注分离存储，但通过 `annotationId` 关联。
- 批注点击后可以打开关联 Markdown 笔记草稿、Evidence Ref 或评论线程。
- 批注删除先进入软删除，其他客户端收到删除操作后保留历史审计。
- 冲突时不覆盖已有批注，生成“需要处理的批注版本”并允许合并或保留两个版本。

### 5.5 Web 与 Desktop 的 UX 差异

| 能力 | Web | Desktop |
|---|---|---|
| 默认数据源 | 云端 Library + 浏览器缓存 | 本地工作区 + 云端同步缓存 |
| 离线 | 最近打开内容和已缓存 Item | 完整本地工作区能力 |
| 文件系统 | File System Access API（用户授权后） | Tauri 原生文件系统 |
| 大文件 | 分片上传、流式预览、服务端缩略图 | 本地读取优先，后台上传 |
| 代码执行 | 浏览器沙箱或明确禁用 | 继续使用现有本地 runner，云端文件只在用户确认后进入运行环境 |
| 多窗格 | 响应式两栏/抽屉 | 多窗格、快捷键、外部应用打开 |
| 更新策略 | Service Worker/PWA 缓存 | 桌面后台同步队列 |
| 权限 | 登录后按 Library 授权 | 设备令牌 + Library 权限，离线使用本地授权快照 |

---

## 6. 技术架构

### 6.1 推荐方案

推荐采用“Supabase 元数据 + R2 大文件 + Cloudflare Worker/Pages Function + Lattice 客户端”的组合：

```text
                   ┌───────────────────────────┐
                   │     Web / Desktop Client   │
                   │ renderer + local store     │
                   │ sync queue + remote client │
                   └─────────────┬─────────────┘
                                 │ HTTPS / WebSocket
                 ┌───────────────┴────────────────┐
                 │ Shared Library API / Worker     │
                 │ auth context, signed URLs, jobs │
                 └───────┬───────────────┬─────────┘
                         │               │
              ┌──────────▼───────┐ ┌────▼─────────────┐
              │ Supabase Auth +  │ │ Cloudflare R2    │
              │ Postgres + RLS   │ │ file blobs       │
              └──────────┬───────┘ └────┬─────────────┘
                         │               │
                  ┌──────▼──────────────▼──────┐
                  │ Jobs / index / audit /      │
                  │ thumbnail / OCR / snapshots │
                  └─────────────────────────────┘
```

原因：Supabase 可以集中处理 Auth、Postgres、RLS 和 Realtime；R2 适合存放 PDF、附件和网页快照，且当前标准存储约为 `$0.015/GB-month`，有免费额度并且不收取直接出站流量费。[Supabase Pricing](https://supabase.com/pricing)；[Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)

### 6.2 方案取舍

| 方案 | 优点 | 缺点 | 决策 |
|---|---|---|---|
| Supabase 全部承载 | 集成快，Auth/DB/Storage 一体 | 大文件流量和长期对象成本不够可控 | 仅用于原型或小规模 |
| Supabase + R2 | 元数据开发快，大文件成本和出站更可控 | 需要签名 URL、Worker 和双写一致性 | **推荐** |
| 自建 Postgres + MinIO | 可私有部署、长期可控 | 需要自己负责升级、备份、网络和安全 | 企业私有部署阶段 |

### 6.3 服务边界

客户端不得直接依赖数据库表结构。所有共享库能力通过以下边界访问：

- `SharedLibraryRepository`：Library、Collection、Item、成员和版本读取/写入
- `SharedBlobStore`：对象上传、分片、下载、校验、删除和恢复
- `SyncEngine`：本地队列、游标、拉取、推送、重试和冲突
- `AnnotationRepository`：批注规范化、批注操作和评论线程
- `SearchIndexer`：文本抽取、索引任务和搜索查询
- `ActivityRepository`：活动和审计事件

React 组件只能依赖 use-case 或 store，不直接拼接 fetch URL，不直接调用 Supabase service key。

### 6.4 仓库建议目录

```text
src/lib/shared-library/
  domain.ts                 # Library/Item/Annotation/Version 类型
  permissions.ts            # 权限矩阵和 capability 判断
  item-workspace.ts         # 通用 Item Workspace 规则
  file-kind.ts              # 类型分类和 renderer 路由
  annotation-model.ts       # 跨端批注模型
  evidence-ref.ts           # 共享证据定位
  repository.ts             # 抽象仓储接口
  local-repository.ts       # 本地文件系统实现
  remote-repository.ts      # API 实现
  blob-store.ts             # 对象存储抽象
  sync-engine.ts            # 同步状态机
  sync-queue.ts             # 持久化操作队列
  conflict-model.ts         # 冲突类型和合并动作
  search-client.ts          # 远程/本地搜索适配
  activity.ts               # 活动模型
  validators.ts             # 输入和响应校验

src/stores/
  shared-library-store.ts
  shared-library-sync-store.ts

src/components/shared-library/
  library-shell.tsx
  library-sidebar.tsx
  library-home.tsx
  item-workspace-shell.tsx
  item-tree.tsx
  item-context-panel.tsx
  sync-status-indicator.tsx
  conflict-center.tsx
  member-management.tsx

src/app/api/shared-library/       # 仅在部署运行时支持时使用；否则部署到 Worker
workers/shared-library-api/        # 签名 URL、队列、索引和安全边界
supabase/migrations/               # 数据库 schema、RLS、索引
```

---

## 7. 数据模型

### 7.1 逻辑实体

```text
organizations
organization_members
libraries
library_members
collections
items
item_children
item_versions
blobs
annotations
annotation_comments
annotation_operations
tags
item_tags
search_documents
sync_operations
sync_cursors
activities
invitations
trash_entries
```

### 7.2 关键字段

#### `libraries`

- `id uuid primary key`
- `organization_id uuid not null`
- `name text not null`
- `slug text not null`
- `description text`
- `visibility text check in ('private','organization')`
- `settings jsonb not null default '{}'`
- `created_by uuid not null`
- `created_at`, `updated_at`, `archived_at`

#### `library_members`

- `library_id uuid`
- `user_id uuid`
- `role text check in ('owner','admin','editor','commenter','viewer')`
- `status text check in ('active','invited','suspended')`
- `last_seen_at`
- `created_at`, `updated_at`
- 主键：`(library_id, user_id)`

#### `items`

- `id uuid primary key`
- `library_id uuid not null`
- `collection_id uuid`
- `kind text`：`pdf`, `markdown`, `code`, `notebook`, `docx`, `pptx`, `image`, `web_snapshot`, `data`, `folder`
- `title text not null`
- `canonical_name text not null`
- `source_url text`
- `metadata jsonb not null default '{}'`
- `current_version_id uuid`
- `content_hash text`
- `status text check in ('active','archived','trashed','conflicted')`
- `created_by`, `created_at`, `updated_at`, `deleted_at`

#### `item_children`

- `parent_item_id uuid not null`
- `child_item_id uuid not null`
- `relative_path text not null`
- `kind text not null`
- `sort_key text not null`
- `created_at`, `updated_at`
- 唯一约束：`(parent_item_id, relative_path)`

子文件关系使用数据库实体表示，避免把用户输入直接拼成对象存储路径；桌面端可以投影为 `.lattice/items/<itemId>/`，云端则使用稳定的 `itemId` 和 `blobId`。

#### `item_versions`

- `id uuid primary key`
- `item_id uuid not null`
- `version_number bigint not null`
- `blob_id uuid`
- `manifest jsonb not null`
- `content_hash text not null`
- `created_by uuid not null`
- `base_version_id uuid`
- `created_at`
- 唯一约束：`(item_id, version_number)`

#### `annotations`

批注必须保留现有 PDF 规范化坐标和引用定位，不使用 client rect 作为持久化字段：

- `id uuid primary key`
- `item_id uuid not null`
- `version_id uuid not null`
- `author_id uuid not null`
- `kind text check in ('highlight','underline','area','text','ink','comment')`
- `target jsonb not null`
- `quote jsonb`
- `geometry jsonb`
- `style jsonb not null default '{}'`
- `body jsonb not null default '{}'`
- `status text check in ('active','resolved','deleted','conflicted')`
- `revision bigint not null default 0`
- `created_at`, `updated_at`, `deleted_at`

`target` 至少包含 `locatorType`、`page` 或 `heading/line/cell`；PDF `geometry` 使用 page-local normalized coordinates；Markdown/代码使用稳定行列或语法节点定位；网页使用快照 DOM path + quote + 字符偏移的组合定位。

#### `sync_operations`

- `id uuid primary key`
- `library_id uuid not null`
- `actor_id uuid not null`
- `device_id text not null`
- `client_sequence bigint not null`
- `operation_type text not null`
- `entity_type text not null`
- `entity_id uuid not null`
- `base_version bigint`
- `payload jsonb not null`
- `idempotency_key text unique not null`
- `created_at`
- `applied_at`
- `rejected_at`
- `rejection_reason text`

客户端必须为每个设备维护单调递增 `client_sequence`，服务器依据 `idempotency_key` 去重。

### 7.3 RLS 规则

每个可读写表都必须有 Library membership 检查。基本规则：

```sql
create policy "library members can read items"
on public.items
for select
to authenticated
using (
  exists (
    select 1
    from public.library_members lm
    where lm.library_id = items.library_id
      and lm.user_id = auth.uid()
      and lm.status = 'active'
  )
);
```

写入策略按 capability 细分：

- `viewer`：读取 Item、版本、已公开批注和评论
- `commenter`：创建/编辑自己的评论和批注，不修改原始文件
- `editor`：创建版本、子文件和批注，可移动 Item
- `admin`：成员、Collection、回收站和 Library 设置
- `owner`：转移所有权、删除 Library、计费和组织级操作

服务密钥只能存在 Worker/服务器环境变量，不能进入 Web bundle、桌面安装包或日志。

---

## 8. 文件、版本与对象存储

### 8.1 对象 key

对象存储 key 不使用用户原始路径：

```text
libraries/{libraryId}/items/{itemId}/versions/{versionId}/content
libraries/{libraryId}/items/{itemId}/versions/{versionId}/manifest.json
libraries/{libraryId}/items/{itemId}/thumbnails/{versionId}/page-{page}.webp
libraries/{libraryId}/items/{itemId}/web-snapshot/{versionId}/index.html
libraries/{libraryId}/items/{itemId}/web-snapshot/{versionId}/assets/{assetId}
```

文件名、标题和相对路径仅作为数据库元数据。这样可以安全支持重命名、移动、复制和恢复。

### 8.2 上传流程

1. 客户端计算文件大小、MIME、SHA-256 和本地 `fileId`。
2. 调用 `POST /v1/libraries/{libraryId}/uploads` 请求上传会话。
3. API 检查 Library 权限、配额、MIME allowlist 和文件大小。
4. API 返回分片上传 URL、`uploadId`、`blobId` 和过期时间。
5. 客户端并行上传分片，可暂停、重试和恢复。
6. 客户端调用 complete；Worker 校验分片、hash 和内容类型。
7. Worker 写入 `blobs`、`item_versions`、`items.current_version_id` 和 `sync_operations`。
8. 异步任务执行病毒扫描、缩略图、文本抽取和索引。
9. 客户端收到 `ready` 或 `processing` 状态，不等待所有索引任务完成才显示文件。

### 8.3 下载与预览

- 客户端先读取受保护的 metadata。
- API 根据当前用户和 Library role 签发短时下载 URL。
- PDF 预览优先使用 range request，不把整个文件复制到 JavaScript 内存。
- 网页端需要把大文件放入 Cache Storage/IndexedDB 时，必须受配额限制。
- 桌面端可以把 blob 写入本地 workspace，再由现有 renderer 打开。
- 预览失败必须降级为下载、外部应用打开或文本提取预览，并展示实际原因。

### 8.4 版本策略

- 原始内容版本不可变。
- Item metadata、Collection 位置和权限变更通过操作记录保存。
- 当前版本只是一个指针，不删除历史版本。
- 默认保留最近 20 个版本；付费/组织策略可配置更长保留。
- 回收站至少保留 30 天，恢复时恢复 Item、子文件关系、最新批注和权限可见性。

---

## 9. 同步协议与冲突处理

### 9.1 同步状态机

```text
LOCAL_ONLY
  └─ connect ─> REGISTERING
                   └─ pull ─> READY
READY ── local change ─> PENDING_UPLOAD
PENDING_UPLOAD ── success ─> READY
PENDING_UPLOAD ── conflict ─> CONFLICTED
READY ── remote event ─> APPLYING
APPLYING ── success ─> READY
任何状态 ── network loss ─> OFFLINE
OFFLINE ── reconnect ─> REGISTERING
```

UI 只展示有限状态：已同步、同步中、离线、需要处理、失败。内部可以保留更细的诊断码。

### 9.2 Pull

```http
GET /v1/libraries/{libraryId}/sync/pull?cursor={cursor}&limit=200
Authorization: Bearer <session>
```

响应：

```json
{
  "libraryId": "...",
  "cursor": "opaque-server-cursor",
  "hasMore": true,
  "operations": [
    {
      "operationId": "...",
      "entityType": "annotation",
      "entityId": "...",
      "operationType": "annotation.upsert",
      "payload": {},
      "createdAt": "2026-08-20T00:00:00Z"
    }
  ]
}
```

客户端必须先写入本地 durable log，再更新投影；应用崩溃后可以从 log 重新应用。

### 9.3 Push

```http
POST /v1/libraries/{libraryId}/sync/push
Authorization: Bearer <session>
Content-Type: application/json
```

请求包含批量 operations 和 `deviceId`。服务器：

1. 校验用户 capability。
2. 按 `idempotency_key` 去重。
3. 检查 `base_version`。
4. 可合并的操作写入实体和操作日志。
5. 不可合并的操作写入冲突记录，不覆盖服务器版本。
6. 返回 accepted、rejected、conflicts 和最新 cursor。

### 9.4 冲突规则

| 数据 | 第一版本规则 | 后续增强 |
|---|---|---|
| PDF/Word/PPT/图片二进制 | 不做内容级合并；产生两个版本并显示冲突 | 版本比较和用户选择 |
| Markdown/代码 | 以 base version 为基础生成冲突副本 | Yjs 文本 CRDT |
| PDF 几何批注 | 以 annotation id + revision 合并；不同批注并存 | 批注字段级合并 |
| 同一批注评论 | 追加评论，不覆盖历史 | 线程级实时协作 |
| Collection 移动 | 最后一个合法操作生效，记录活动 | 允许用户撤销 |
| 删除与编辑 | 删除进入 trash；编辑不直接物理删除 | 恢复向导 |

### 9.5 Realtime 使用边界

Realtime/WebSocket 只做：

- 新活动提示
- 其他成员在线状态
- “某人正在查看/编辑”提示
- 低延迟通知客户端拉取增量

不可把 Realtime 事件当作唯一事实来源。断线重连必须以 cursor pull 补齐。

### 9.6 CRDT 采用边界

Yjs 适合 Markdown、评论和共享文本，因为它提供离线编辑、共享类型和合并能力；官方项目说明见 [Yjs](https://github.com/yjs/yjs)。第一版不强制全量引入，以免把 PDF 几何批注和二进制版本错误地建模为文本 CRDT。

---

## 10. 多格式处理管线

### 10.1 类型路由

统一 `FileKind` 只负责分类，具体 viewer 继续使用现有组件：

| FileKind | 现有能力 | 共享增强 |
|---|---|---|
| pdf | PDF highlighter、text kernel、search、annotation sidebar | 云端版本、批注同步、讨论、缩略图 |
| markdown | CodeMirror live preview / reading | 文本版本、评论锚点、协作编辑 |
| code | CodeMirror 6、outline、runner | 代码行批注、版本比较、权限执行边界 |
| notebook | Notebook renderer、local runner | cell evidence、执行输出版本 |
| docx | Mammoth/Word viewer | 文档版本、文本评论、导出 |
| pptx | PPT preview | 页级批注、缩略图 |
| image | Image viewer / tldraw state | 区域批注和讨论 |
| web_snapshot | HTML viewer、DOMPurify | URL、快照版本、段落证据 |
| data | 文本/表格降级预览 | schema、采样、下载权限 |

### 10.2 网页导入

URL 导入分三种状态：

1. `url_only`：只存 URL、标题、抓取时间和 favicon。
2. `snapshot_processing`：Worker 抓取 HTML，去除脚本和危险资源，下载 allowlist 资源。
3. `snapshot_ready`：存储净化后的 HTML、资源清单、文本抽取和快照 hash。

安全规则：

- 禁止把用户浏览器 cookie、Authorization header 或本地存储上传到服务端。
- 服务端抓取必须阻止 SSRF、内网 IP、file://、gopher:// 和任意重定向链。
- HTML 展示必须经过 DOMPurify/sandbox，禁止直接插入未净化 HTML。
- 动态页面无法可靠快照时，明确显示“仅保存 URL”，不伪造完整快照。

### 10.3 OCR 与文本抽取

- 本地优先：已有 PDF 文本内核可直接处理可搜索 PDF。
- 云端异步：扫描 PDF、图片和网页快照进入抽取队列。
- 抽取结果作为 `search_documents` 和 `evidence_blocks`，不能修改原始文件。
- OCR 失败不阻塞预览；UI 显示“可视阅读可用，全文搜索待处理”。

---

## 11. 搜索与证据系统

### 11.1 搜索层

第一阶段使用 Postgres 全文索引 + 本地 `searchable-text.ts`：

- Item 标题和 metadata
- 正文抽取文本
- 子文件文本
- 批注 quote/body
- 评论 body
- 网页快照正文

返回结果必须带：

- `itemId`
- `childItemId`（可选）
- `sourceType`
- `snippet`
- `locator`
- `permissionSnapshot`
- `updatedAt`

### 11.2 EvidenceRef

统一定位契约：

```ts
type SharedEvidenceRef = {
  libraryId: string;
  itemId: string;
  versionId?: string;
  childItemId?: string;
  sourceType: 'pdf-page' | 'pdf-annotation' | 'markdown-heading' | 'code-line'
    | 'notebook-cell' | 'docx-paragraph' | 'pptx-slide' | 'web-paragraph';
  locator: Record<string, string | number | Array<number>>;
  quote?: string;
  createdAt: string;
};
```

AI、搜索、批注、评论和内部链接都使用此结构，不再为每种 viewer 发明平行导航协议。

---

## 12. 身份、权限与安全

### 12.1 身份

- 第一阶段：Email magic link/password + Google/GitHub OAuth。
- Session 使用短期 access token + 可撤销 refresh token。
- 每个设备有稳定 `deviceId`，设备列表可查看和撤销。
- 桌面端首次登录通过系统浏览器完成，回调后只把会话令牌写入 Tauri 安全存储。
- 纯本地模式不需要登录。

### 12.2 权限

所有请求同时检查：`organization -> library -> collection/item -> operation`。

不得用前端隐藏按钮代替权限控制。前端 capability 只用于 UX，真正授权由 RLS/Worker 再校验。

### 12.3 文件安全

- MIME、扩展名、magic bytes 三重校验。
- 文件大小和每 Library 存储配额限制。
- 上传后异步病毒扫描，扫描中禁止共享下载。
- 对象 URL 短时有效，默认不公开 bucket。
- 删除使用 soft delete + 延迟物理删除。
- 关键操作写入 append-only audit log。
- 日志中禁止记录 access token、签名 URL、用户文件正文和私密 URL 参数。

### 12.4 Web 安全

- HTML 快照使用严格 CSP 和 sandbox iframe。
- Markdown/评论中的 HTML 必须 sanitize。
- 所有 API body 使用 schema validation。
- 限制批量上传、搜索、邀请和同步请求频率。
- 通过 CORS allowlist 限制客户端来源。

### 12.5 隐私和版权

- 用户上传内容默认私有，Library 成员才能访问。
- 保存网页时显示来源 URL、抓取时间和版权提示。
- 不自动抓取需要登录的页面，不绕过付费墙或访问控制。
- AI 提供商使用可配置适配器，默认不把整个 Library 发送给第三方。
- 导出和删除需要明确操作，并在审计中保留记录。

---

## 13. API 契约

API 前缀：`/v1`。所有响应带 `requestId`；所有写入接口支持 `Idempotency-Key`。

### 13.1 Library

```http
POST   /v1/libraries
GET    /v1/libraries
GET    /v1/libraries/{libraryId}
PATCH  /v1/libraries/{libraryId}
DELETE /v1/libraries/{libraryId}
```

### 13.2 Members

```http
GET    /v1/libraries/{libraryId}/members
POST   /v1/libraries/{libraryId}/invitations
PATCH  /v1/libraries/{libraryId}/members/{userId}
DELETE /v1/libraries/{libraryId}/members/{userId}
```

### 13.3 Items

```http
GET    /v1/libraries/{libraryId}/items
POST   /v1/libraries/{libraryId}/items
GET    /v1/libraries/{libraryId}/items/{itemId}
PATCH  /v1/libraries/{libraryId}/items/{itemId}
POST   /v1/libraries/{libraryId}/items/{itemId}/move
POST   /v1/libraries/{libraryId}/items/{itemId}/restore
DELETE /v1/libraries/{libraryId}/items/{itemId}
```

### 13.4 Uploads

```http
POST /v1/libraries/{libraryId}/uploads
POST /v1/libraries/{libraryId}/uploads/{uploadId}/complete
POST /v1/libraries/{libraryId}/uploads/{uploadId}/abort
GET  /v1/libraries/{libraryId}/blobs/{blobId}/download-url
```

### 13.5 Annotations and comments

```http
GET    /v1/items/{itemId}/annotations
POST   /v1/items/{itemId}/annotations
PATCH  /v1/items/{itemId}/annotations/{annotationId}
DELETE /v1/items/{itemId}/annotations/{annotationId}
GET    /v1/annotations/{annotationId}/comments
POST   /v1/annotations/{annotationId}/comments
PATCH  /v1/comments/{commentId}
DELETE /v1/comments/{commentId}
```

### 13.6 Sync

```http
GET  /v1/libraries/{libraryId}/sync/pull?cursor={cursor}&limit=200
POST /v1/libraries/{libraryId}/sync/push
GET  /v1/libraries/{libraryId}/sync/status
POST /v1/libraries/{libraryId}/sync/resolve-conflict
```

### 13.7 Search

```http
GET /v1/libraries/{libraryId}/search?q={query}&kind={kind}&cursor={cursor}
POST /v1/libraries/{libraryId}/saved-searches
GET /v1/libraries/{libraryId}/saved-searches
```

服务端返回的错误必须结构化：

```json
{
  "error": {
    "code": "SYNC_CONFLICT",
    "message": "Item has a newer remote version",
    "retryable": false,
    "entityType": "item",
    "entityId": "...",
    "requestId": "..."
  }
}
```

---

## 14. Web、Desktop、Cloud 的实现计划

### 14.1 Web

新增 Library route，但不破坏当前单页工作区：

```text
/library
/library/{libraryId}
/library/{libraryId}/collection/{collectionId}
/library/{libraryId}/item/{itemId}
/library/{libraryId}/settings/members
/library/{libraryId}/settings/storage
```

Web 客户端职责：

- 处理登录、Library 导航、远程 metadata 和权限状态。
- 通过 remote repository 获取签名 URL。
- 利用 Cache Storage/IndexedDB 缓存最近打开的 Item 和同步队列。
- 只在 File System Access API 获得用户授权后绑定本地文件夹。
- 不直接执行云端代码；Notebook 仅提供安全预览或交给明确配置的远程 runner。

### 14.2 Desktop

桌面端职责：

- 保持现有本地 workspace 作为主编辑副本。
- 在 `.lattice/shared-library/` 保存 remote identity、sync cursor、pending operation 和本地缓存索引。
- 通过 Tauri command 处理安全存储、原子文件写入、文件 watcher 和后台同步。
- 网络中断时继续使用本地文件和现有 runner。
- 大文件采用本地 hash + 后台 multipart upload。
- 桌面启动时先恢复本地 UI，再异步恢复云端会话，避免同步阻塞打开应用。

建议的桌面本地布局：

```text
.lattice/
  shared-library/
    identities.json
    cursors.json
    queue/
      {operationId}.json
    cache/
      {libraryId}/
    conflicts/
      {conflictId}.json
```

### 14.3 Cloud

云端拆成四类服务：

1. API：鉴权、权限、metadata、sync、签名 URL。
2. Storage：R2/S3 对象、分片、生命周期。
3. Jobs：OCR、缩略图、文本抽取、网页快照、病毒扫描、索引。
4. Observability：结构化日志、指标、审计、错误追踪和告警。

所有服务都必须能在本地开发环境通过 adapter 替换为 deterministic fake，测试不得依赖真实生产服务。

---

## 15. 部署与环境

### 15.1 环境

- `local`：本地 Next.js/Tauri + Supabase local + MinIO/R2 mock + fake jobs。
- `preview`：隔离的 Supabase project、R2 bucket、Worker 环境和 OAuth 回调。
- `production`：独立数据库、对象存储、队列、域名、监控和备份。

### 15.2 Secrets

```text
PUBLIC_API_BASE_URL
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY        # server/worker only
R2_ACCOUNT_ID                    # server/worker only
R2_ACCESS_KEY_ID                 # server/worker only
R2_SECRET_ACCESS_KEY             # server/worker only
R2_BUCKET_NAME
WEBHOOK_SIGNING_SECRET
OCR_PROVIDER_KEY                 # optional, server only
```

规则：

- `PUBLIC_*` 可以进入浏览器；其余变量禁止进入客户端 bundle。
- `.env*` 不提交 Git。
- CI 中只使用环境变量注入，不把密钥写入 fixture、日志或测试快照。

### 15.3 数据库迁移

- 每次 schema 变更使用独立 migration。
- migration 必须包含索引、RLS policy 和回滚说明。
- 任何删除列或数据迁移先添加兼容读路径，再在下一个版本清理。
- 生产发布前执行 dry-run、备份检查和 migration 计时。

### 15.4 备份与恢复

- Postgres 每日备份，生产保留至少 7 天。
- R2 开启版本或生命周期策略，关键对象不能随 metadata 删除立即物理删除。
- 每季度演练：误删 Library、损坏版本、同步游标丢失、对象存储不可用。
- 恢复必须保留原始 `content_hash` 和 `operationId`，避免重复同步。

---

## 16. 成本和购买决策

### 16.1 原型

可以不购买商业软件，使用本地模拟服务和免费额度完成：

- Web/Desktop UI
- 本地同步状态机
- schema 和 RLS 测试
- 小文件对象上传
- PDF 批注协作逻辑

### 16.2 小规模正式环境

建议起步配置：

- Supabase Pro：当前从 `$25/month` 起，覆盖一个生产项目的基础能力。[官方定价](https://supabase.com/pricing)
- Cloudflare R2：标准存储当前约 `$0.015/GB-month`，每月有 10 GB 存储、1M Class A、10M Class B 免费额度，直接出站不收费。[官方定价](https://developers.cloudflare.com/r2/pricing/)
- Cloudflare Pages/Worker：继续复用当前 Web 部署路径，API 使用 Worker/Pages Function。
- 域名、邮件、监控和备份：按实际用量追加。

早期基础设施可控制在约 `$30-150/month`；OCR、网页抓取、AI 和高频下载会形成额外变量成本。

### 16.3 企业环境

在需要 SSO、合规认证、专属支持、审计保留、指定区域、专有网络或私有部署时，才购买 Team/Enterprise 级服务或自行维护 Postgres/MinIO。Supabase Team 当前公开起价为 `$599/month`，但企业最终费用取决于支持、计算、数据区域和合规要求。[Supabase Pricing](https://supabase.com/pricing)

### 16.4 不建议立刻购买的东西

- 不先购买昂贵的“协作编辑 SaaS”。
- 不先购买商业全文搜索平台。
- 不先购买企业 SSO。
- 不先购买 AI 向量数据库。
- 不为每种文件格式购买独立 viewer；优先复用现有 renderer。

---

## 17. 分阶段里程碑

### Phase 0：架构准备（1-2 周）

交付：

- domain types、repository interfaces、permission matrix
- local remote fake、sync event schema、idempotency contract
- Supabase migration skeleton 和本地 fixture
- Library route shell 和 sync status UI
- `npm run typecheck`、Focused Vitest 基线

出口条件：不连接真实云服务也能通过单元测试创建 Library、Item、批注和同步操作。

### Phase 1：共享库 MVP（3-5 周）

交付：

- Auth/session/device
- Library/Collection/Member
- 小文件上传和 R2 signed URL
- Item/child item/version
- Web Library 首页和 Item Workspace
- Desktop 登录、远程 identity 和后台队列
- Viewer 复用现有 PDF/Code/Markdown/Word/PPT/HTML

出口条件：两个设备可以看到同一 Library，上传、下载、重命名、移动和恢复可用。

### Phase 2：批注与同步（3-5 周）

交付：

- PDF annotation remote model
- annotation operation log
- comment threads
- pull/push cursor sync
- offline queue/retry
- conflict center
- PDF page/annotation EvidenceRef 跨端跳转

出口条件：断网创建批注，恢复网络后另一个客户端能看到同一页同一位置的批注；冲突不丢数据。

### Phase 3：搜索与网页快照（2-4 周）

交付：

- 文本抽取任务
- Postgres full-text search
- 批注/评论搜索
- URL-only 和 sanitized snapshot
- 缩略图、OCR 状态和失败重试

出口条件：可从一个查询定位到 Item、子文件、PDF 页、批注或网页段落。

### Phase 4：协作增强（4-8 周）

交付：

- Markdown/评论 Yjs 或等价 CRDT adapter
- 在线成员和低延迟活动
- 版本比较和冲突合并向导
- 保存搜索、通知、未读状态
- 组织级审计和配额

出口条件：实时协作延迟、断线恢复和审计数据有可观测证据。

### Phase 5：商业化与企业化（按需求）

交付：

- 计费与配额
- SSO/SCIM
- 私有部署/指定区域
- SLA、合规和数据导出
- 组织管理员控制台

---

## 18. 代码实现边界

### 18.1 优先复用

- `src/lib/pdf-item.ts`
- `src/lib/annotation-storage.ts`
- `src/lib/universal-annotation-storage.ts`
- `src/lib/pdf-canonical-text-anchoring.ts`
- `src/lib/pdf-text-rects.ts`
- `src/lib/searchable-text.ts`
- `src/lib/file-identity.ts`
- `src/lib/file-open-routing.ts`
- `src/components/renderers/pdf-highlighter-adapter.tsx`
- `src/components/renderers/pdf-annotation-sidebar.tsx`
- `src/components/renderers/pdf-item-workspace-panel.tsx`
- `src/components/renderers/code-editor-viewer.tsx`
- `src/components/renderers/word-viewer.tsx`

### 18.2 不允许的实现方式

- 在组件中直接调用 Supabase client 并把表名散落在 UI。
- 复制现有 PDF annotation schema 形成第二套相似格式。
- 用文件名作为唯一 ID。
- 用 `Date.now()` 作为跨设备排序依据。
- 将浏览器 `DOMRect`、CSS 像素或 viewport 坐标写入云端。
- 用最后写入覆盖所有冲突。
- 将 service role key 放进前端或桌面资源。
- 为“看起来同步”而静默丢弃失败操作。

### 18.3 兼容迁移

现有本地 PDF Item Workspace 的迁移顺序：

1. 读取 `.lattice/items/<fileId>/manifest.json` 和 annotations sidecar。
2. 生成稳定的 remote `itemId` 映射，不改变本地 `fileId`。
3. 上传主文件和子文件，逐个生成 `item_versions`。
4. 将 sidecar annotation 转换为统一 annotation model，保留原始 payload 供回滚。
5. 写入 migration activity。
6. 迁移失败时保留本地 workspace，不删除或覆盖原文件。

---

## 19. 测试与质量门禁

### 19.1 单元测试

- 权限矩阵：每个 role × 每个 operation。
- Item identity、子文件路径和重命名迁移。
- annotation target/geometry schema。
- sync idempotency、cursor、retry/backoff。
- 冲突分类和解决策略。
- URL 规范化、SSRF blocklist 和 HTML sanitize。
- 文件 hash、版本指针和回收站恢复。

### 19.2 集成测试

- Supabase migration + RLS 访问隔离。
- signed upload/download URL 过期和越权。
- 上传中断后续传。
- Pull/Push 乱序和重复提交。
- 两个客户端同时创建/删除/恢复批注。
- Worker job 失败后重试和死信状态。

### 19.3 浏览器测试

- Web 登录、创建 Library、邀请成员。
- Library/Collection/Item 导航。
- PDF 打开、批注、评论、跳转。
- Web 断网、刷新、恢复同步。
- 手机宽度下 Context drawer 不遮挡内容。

### 19.4 桌面测试

- Tauri 首次登录和浏览器回调。
- 本地 workspace 离线打开。
- 文件 watcher 变更入队。
- 大文件后台上传不阻塞编辑器。
- 退出重启后恢复 pending queue。
- 本地 runner 不因共享库 metadata 变化而自动执行代码。

### 19.5 发布门禁

共享库阶段完成时至少运行：

```powershell
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run qa:gate
```

正式发布前遵循 [Lattice Project Flow](C:/universe/software%20development/me/Lattice/.agents/skills/lattice-project-flow/SKILL.md)：不默认部署、不默认刷新 release、不默认 commit/push。

---

## 20. 验收标准

### P0：必须通过

- 未授权成员无法通过 API、URL、缓存或搜索看到 Library 内容。
- PDF 批注使用稳定 page-local normalized geometry，Web/Desktop 显示一致。
- 断网期间产生的有效变更不会静默丢失。
- 重复提交同一 operation 不产生重复实体或重复评论。
- 冲突不会自动覆盖另一方版本。
- 删除和恢复不会破坏 Item 子文件与批注关系。
- Web 和 Desktop 都能打开同一 Item 的 PDF、代码和文档。
- 所有异步处理都有可见状态和失败重试入口。

### P1：应通过

- Library 首页支持搜索、过滤、最近访问和未读活动。
- 网页 URL 可以降级为 URL-only，不阻塞 Library 使用。
- 文件类型不支持时有明确降级路径。
- 管理员可以查看成员、配额和审计活动。
- 桌面端退出再启动后能恢复本地同步队列。

### P2：后续增强

- Markdown 实时多人编辑。
- 版本可视化 diff。
- AI 阅读摘要、批注聚合和引用建议。
- SSO、SCIM 和私有部署。

---

## 21. 主要风险与决策

| 风险 | 影响 | 处理决策 |
|---|---|---|
| 先做实时协作导致范围失控 | 高 | 第一版先做可靠版本同步和批注操作日志 |
| PDF 批注坐标在不同渲染器漂移 | 高 | 保留现有 normalized geometry 和 page text kernel |
| 大文件出站成本失控 | 中 | 元数据/对象分离，R2 优先，短时 URL |
| 浏览器缓存空间不足 | 中 | Web 只缓存最近 Item，Desktop 承担完整离线 |
| 网页快照含恶意脚本 | 高 | 服务端净化、sandbox、CSP、SSRF 防护 |
| 用户误以为同步成功 | 高 | 明确状态、持久队列、失败重试和冲突中心 |
| Supabase Realtime 丢事件 | 中 | Realtime 只做通知，cursor pull 补齐 |
| AI 误写原始内容 | 高 | AI 只读/提案优先，写入必须走审批和版本 |
| 企业客户要求私有部署 | 中 | repository/blob/job adapter 保持可替换 |

### 已确定的架构决策

1. Shared Library 是通用能力，不只服务 PDF。
2. PDF Item Workspace 迁移为通用 Item Workspace，但保留 PDF 专用 annotation adapter。
3. 本地和云端都以稳定 ID、hash、version 和 operation 为基础，不以路径为身份。
4. Web/Desktop 共用 domain、repository contract、sync engine 核心；IO adapter 分平台实现。
5. 所有新云端写入都可审计、可重放、可幂等。
6. 不在本阶段创建公共论文数据库或复杂社交网络。

---

## 22. 开发交付顺序

开发代理必须严格按以下顺序：

1. 先阅读本设计、现有 Architecture、PDF Item、annotation 和 searchable-text 代码。
2. 先建立类型、接口、权限矩阵和 fake adapter，再改 UI。
3. 先完成本地 deterministic tests，再接 Supabase/R2。
4. 先完成 Library/Item/Version，再完成 annotation/sync，再完成 search/web snapshot。
5. 每个阶段都运行 focused tests、typecheck，再考虑下一阶段。
6. 不把真实云服务、密钥、部署和计费混进前端组件。
7. 未通过 P0 验收前，不宣传“多人实时协作已完成”。

---

## 23. 参考资料

- [Lattice Architecture](C:/universe/software%20development/me/Lattice/docs/ARCHITECTURE.md)
- [PDF Item Workspace Routing Design](C:/universe/software%20development/me/Lattice/docs/PDF_ITEM_WORKSPACE_ROUTING_DESIGN.md)
- [Zotero-grade PDF Reading Design](C:/universe/software%20development/me/Lattice/docs/superpowers/specs/2026-07-26-zotero-grade-pdf-reading-design.md)
- [Supabase Pricing](https://supabase.com/pricing)
- [Supabase Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Yjs](https://github.com/yjs/yjs)
