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

1. 在文件浏览器上方切到「共享库」，通过管理按钮连接或登录已有云端服务。
2. 在管理面板创建小组库，或接受成员邀请；在文件树中新建或上传文件。
3. 点击云文件即在现有工作区标签打开，使用相应的 PDF / Markdown / 代码 / Notebook 等阅读器和编辑器。

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

## 10. 在日常工作区共享共创

云端文件继续使用本地文件相同的编辑器、标签和分栏。文件顶部增加轻量工具条：

- **共享与成员**：直接打开此文件所属库的成员面板。管理员可邀请成员并指定只读、可批注或可编辑；非管理员可查看成员。邀请仍由成员管理面板生成和复制，不自动发送消息。
- **云端 AI**：把当前文件明确带入现有 AI 面板；云目录上方的「带入 AI」可选择整个目录。入口准备问题草稿，不自动发送。既有草稿和会话保留，新来源按需使用新会话。来源行显示选择范围；切换云账号或连接后必须重新选择来源。
- **版本历史**：查看每次内容保存的版本、作者昵称和时间。文本可预览并与当前内容逐行比较；其他格式可下载对应版本原文件。恢复旧内容会创建新版本，保留旧版本，并记录恢复来源版本。

「云端 AI」使用当前用户在个人设置配置的模型或本机工具。「团队 AI」由库 owner/admin 在面板中添加、编辑、移除团队模型，配置兼容 API 地址、模型、团队自己的 Key 与请求额度；普通成员只使用模型而不能读取 Key。Key 在服务端加密绑定此库，编辑同地址可留空保留，换地址需新 Key。默认未启用时不能发送，保存配置不代表上游 Key 或模型已验证。上传和 GitHub 同步不要求 AI Key，也不使用开发者的个人账号。服务器再次验证成员并原子预留额度；资料仅在发送时提交，回答不自动改文件。

管理面板新增「GitHub 仓库」：登录 GitHub 并授权 App 可访问的私库，管理员可关联当前云库。绑定稳定 GitHub 身份后，仓库 write/maintain/admin 权限可自动授予云库 editor；权限变化通过签名 Webhook 与持久重试同步，人工成员权限独立保留。可显式导入普通仓库文件（每个最多 1 MB）、拉取新版本，确认后发布 GitHub 提交；SHA 或仓库基线变化会中止，不静默覆盖。需要服务器已配置 GitHub App 和事件调度，单有登录按钮不代表线上已启用。

「协作记录」显示文件版本、条目元数据、批注、评论和成员权限变化的操作者、时间与前后详情，可打开对应内容历史。事件由数据库触发器写入，普通成员不能伪造、修改或删除。生产启用步骤见 [生产接入准备](../operations/cloud-production-github.md)。

多人共创采用版本同步和可见冲突处理，尚不是多人同时输入的实时光标编辑。其他成员保存新内容后，云文件工具条提示「加载最新版本」，由用户决定读取。打开分栏中的草稿不被自动覆盖；恢复操作在有未保存草稿、待同步内容或冲突时被阻止。在恢复读取期间开始新编辑也会取消恢复。

PDF 顶部「批注显示」提供全部、仅自己、仅他人、全部隐藏，也可勾选具体成员。偏好按连接、账号和文件保存在本机；同文件分栏保持一致，跨内容版本保留。页面、侧栏及「带批注导出」使用同一可见集合。隐藏只改变自己的视图，不会删除共享批注，也不改变其他成员可以读取的内容。PDF 批注绑定其原始内容版本，不会自动迁移到另一份 PDF 内容。

同步提示区分「已保存到本机，等待同步」「已同步」「离线」和「同步有冲突」。本机保存成功不等于云端提交成功。点击同步状态可打开详情，暂停、重试或处理冲突。离线历史预览只提供已读取并缓存的版本；恢复需要联网核对成员资格与最新版本。
