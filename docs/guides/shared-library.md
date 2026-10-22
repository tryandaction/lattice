# 共享研究库（Shared Library）指南

> 本地优先的共享研究库：多人在同一 Library 内协同管理 PDF、Markdown、代码、
> Notebook 及其批注。所有变更先落到本地，再经同步队列异步上传。

## 1. 概念

- **Library**：一个共享研究库，隶属于一个组织，可设为 private / public。
- **Item**：库中的条目（PDF、Markdown、代码、Notebook、DOCX、PPTX、图片、
  web_snapshot、data、folder）。每个 Item 有稳定且**与文件路径无关**的 id。
- **ItemChild**：挂在 Item 下的子文件（例如 PDF 的 `.md` 笔记、`.ipynb`、
  `figures/`、`numerical_data/`、`source_data/`）。
- **Version**：Item 内容的版本（blobId + contentHash）。
- **Annotation**：批注（高亮、下划线、区域、文本、墨迹、评论），带 revision。

## 2. 创建与打开

1. 打开 Library 列表，点击「New library」创建。
2. 进入 Library 详情，点击 Item 行打开 workspace。
3. 每个 Item 按 `kind` 路由到对应 viewer（PDF / Markdown / 代码 / Notebook / …）。

## 3. 角色与权限

角色阶梯（低 → 高）：`viewer ⊂ commenter ⊂ editor ⊂ admin ⊂ owner`。

| 能力 | viewer | commenter | editor | admin | owner |
|------|:---:|:---:|:---:|:---:|:---:|
| 读 Library / Item | ✅ | ✅ | ✅ | ✅ | ✅ |
| 创建批注 / 评论 | — | ✅ | ✅ | ✅ | ✅ |
| 创建 / 更新 / 删除 Item | — | — | ✅ | ✅ | ✅ |
| 创建子文件 / 版本 | — | — | ✅ | ✅ | ✅ |
| 恢复删除、管理成员 | — | — | — | ✅ | ✅ |
| 删除 Library | — | — | — | — | ✅ |

> 权限矩阵是 UX 护栏；真正的鉴权始终在 API / RLS / Worker 边界执行。
> viewer 看不到成员管理与冲突解决入口。

## 4. 子文件与批注

- 在 PDF item 内创建子 Markdown / Notebook；子文件与 Item 同生命周期。
- 批注定位在归一化坐标空间（PDF 页内 0–1），Web 与桌面一致。

## 5. 离线与同步

- 所有本地变更先进入**持久化同步队列**；断网时队列不丢操作，恢复后自动推送。
- 同一操作以 `idempotencyKey` 去重：重复操作不会产生重复实体。
- 同步状态显示在 Library 详情顶部（`local_only / syncing / synced / offline /
  conflicted / failed`）。

## 6. 冲突

冲突**可见且不会静默覆盖**。冲突中心按类型分类：

| 类型 | 推荐动作 |
|------|---------|
| binary-version | Adopt remote（采用远程） |
| annotation-revision | Merge annotations（合并批注） |
| delete-edit | Restore deletion（恢复删除） |
| permission-revoked | Keep local（保留本地） |
| quota-exceeded | Keep local（保留本地） |

每个冲突卡片显示实体、双方版本、作者、时间与推荐动作；解决动作分别映射到不同
operation（保留本地 / 采用远程 / 复制为新 Item / 合并批注 / 恢复删除）。

## 7. 搜索与网页快照

- 搜索覆盖 Item、子文件、批注与 URL；结果携带 `itemId / childItemId / sourceType /
  snippet / locator / permissionSnapshot / updatedAt`。
- URL-only Item 可被快照；快照前会拦截 SSRF（私有 IP / 回环 / 危险协议）与
  不安全的 HTML；**快照失败仍保留 URL-only Item**。

## 8. 当前边界

- 默认 Web 路由使用持久化的 local-first repository，`sync: local_only` 表示当前
  页面尚未绑定云端身份与 API，而不是数据未保存。
- `workers/shared-library-api` 已提供 Supabase/PostgREST 的鉴权转发、搜索、同步和
  Item/Version/Annotation 路由；上线前仍需配置 Supabase Auth、RLS migration、Worker
  环境变量、CORS 域名与生产监控。
- Worker 已提供 R2 分片上传、完成、取消和受保护内容读取路由；必须配置
  `LIBRARY_BLOBS` binding、bucket 策略、病毒扫描、生命周期清理和监控后才可启用。
  未配置时本地内容仍可查看，不会伪装成已同步。
- 不做未通过验收的实时协作宣传。

## 9. 云端接入方式

Web 或 Desktop 在 Auth 完成后只需创建一次 Runtime：

```ts
import { createSharedLibraryRuntime } from "@/lib/shared-library/runtime";

const runtime = createSharedLibraryRuntime({
  baseUrl: "https://<worker-domain>",
  getAccessToken: () => authSession.getAccessToken(),
});
const useSharedLibraryStore = runtime.createStore();
```

Runtime 统一提供 `repository`、`searchClient`、`contentStore`、按 Library 创建的
`BlobStore` 和带版本提交的 `createItemWithContent`。不要在组件中直接调用
`fetch`、Supabase 或 R2；本地未登录时继续使用
默认的 `PersistentSharedLibraryRepository`，并保持 `local_only` 状态。
将 `useSharedLibraryStore` 和 `runtime.contentStore.get` 传给 `LibraryShell`，即可让
同一工作区直接读取远程版本内容；上传必须调用 Runtime 的 `createItemWithContent`。

生产启用顺序：先应用 `supabase/migrations` 中的 core/RLS/security migration，再在
Worker 配置 Supabase URL、anon key、允许来源和 `LIBRARY_BLOBS` R2 binding；最后由
Auth 回调注入 access token。任何一步未完成，客户端都应保持 local-first，不得把上传
或同步显示为成功。
