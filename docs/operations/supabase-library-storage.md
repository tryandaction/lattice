# Supabase 私有存储云库路线

这是无需开通 R2 的初始部署路线。运营者使用现有 Supabase Auth/Postgres 项目和私有 Storage 桶，Worker 继续转发每个使用者的 JWT。用户端和 Worker 只配置公开 publishable/anon key；禁止配置 service-role、数据库密码或管理令牌。

## 实际支持范围

`BLOB_BACKEND=supabase` 应用第八份迁移后单文件上限是 **20 MiB（20,971,520 字节）**。服务端在上传会话中保存并返回 `partSize=max(sizeBytes,1)`；客户端必须把该值与 outbox 一起持久化，并把完整对象发到 `parts/1`。`complete` 读回验证精确大小及 SHA-256，再通过 `cloud_complete_storage_upload` 原子写入 blob 元数据和完成状态。版本提交及版本冲突仍使用现有数据库规则。旧的 5 MiB 会话描述符没有 `partSize`，继续按旧片长处理。

这条路线提供整对象恢复重试：断网后保留本地字节及上传身份，客户端重启后复用会话；已存在对象只允许大小、内容 hash 均相同的重试，不能覆盖。上传、完成读回及下载的默认等待预算为 120 秒，其他 API 为 15 秒；部署平台仍有自己的超时/内存限额。超过上限返回 413 并保留本地文件。它没有 TUS 字节偏移断点续传；链路中断可能重传整份 20 MiB。需要更大文件或减少重传时应另行实现 TUS，或由运营者开通 R2。

Supabase 官方明确标准上传可以承载更大文件，同时建议大于 6 MB 用 TUS 提高可靠性。此实现为现有最小协议扩展，使用不可变对象、精确校验和持久 outbox 保证重试结果；它不宣称等同 TUS。项目全局 Storage 限额也必须至少 20 MiB，桶限制不能高于项目限制。依据：[标准上传](https://supabase.com/docs/guides/storage/uploads/standard-uploads)、[TUS 上传](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)、[全局及桶限制](https://supabase.com/docs/guides/storage/uploads/file-limits)。

## 准备与部署

运行 `node scripts/prepare-cloud-service.mjs`，默认输出 `.lattice-build/cloud-service-setup-20261017-supabase/`，其中包括八份迁移的事务初始化 SQL、增量迁移、无 R2 绑定的 Worker 配置、公开服务配置示例及 hash manifest。脚本不读取管理密钥，不执行云端请求，不创建或部署资源；不要在已填写配置的部署目录上直接重跑覆盖。

1. 运营者通过 Supabase 官方控制台确认目标项目。仅新空项目执行 `initialize-new-project.sql`；已经完整应用前五份迁移的项目执行 `upgrade-storage-existing-project.sql`。已在 10-13 应用七份迁移的生产项目只应用 `upgrade-20261013-existing-project.sql`（`202610170001_cloud_large_objects.sql`），不要重放旧迁移。
2. 先清理过期上传并备份，再确认 `lattice-shared-library` 桶为 private、大小限制 20,971,520 字节，且项目全局 Storage 限额至少此值。第八份迁移设置桶和保守预留；若项目已有其他宽泛 Storage 策略，运营者需要先核查它们。Supabase 的多条允许策略会叠加，宽泛策略会削弱此隔离。
3. 在 Worker 配置 `SUPABASE_URL`、公开 `SUPABASE_ANON_KEY`、`BLOB_BACKEND=supabase` 及 `MAX_UPLOAD_BYTES=20971520`。初始配置不含 `LIBRARY_BLOBS`，无需 R2 订阅。
4. 用生成的配置运行 Wrangler `deploy --dry-run`；取得运营者明确部署授权后部署 Worker/Edge。同次发布更新客户端 `partSize` 协商支持及公开服务 JSON 的 `maxFileBytes=20971520`。旧客户端遇到大文件时会被精确长度校验拒绝，不能只部署新桶数字。
5. 在注入 `NEXT_PUBLIC_LATTICE_CLOUD_SERVICE` 的产品构建中执行完整 `qa:gate`。使用合成文件和两个实际账号验收上传、只读下载、撤销权限、过期清理和版本冲突，然后发布。

### Supabase Edge 入口

如果当前网络不能直连 `workers.dev`，执行 `node scripts/prepare-supabase-cloud-function.mjs`，再用已授权 CLI 部署 `shared-library-api`。生成入口复用 Worker 的 `handleRequest`，适配托管函数路径，并保留带函数前缀的私有下载 URL。平台 `verify_jwt=true` 保持启用；服务只转发调用者 JWT，未使用默认环境中的 service-role。

公开 API 地址为 `https://<project>.supabase.co/functions/v1/shared-library-api`。该运行方式使用 Supabase Edge Functions 的额度，Cloudflare 的 CPU 验收不能替代 Edge 实际验收。10-17目标项目已应用第八迁移并最终部署Edge v5、保持verify_jwt=true；双临时账号的合法20MiB合成PDF、响应丢失后重启重试、下载SHA/权限/清理/health共18项通过；随后小对象正文超时/取消及hash冲突清理/新会话重试10项通过，临时数据六类残留均0，详见[生产验收](../tests/2026-10-17-cloud-large-production-acceptance.md)。这证明本次托管链路通过，不表示持续内存/CPU监控或长期SLA已配置。原 Cloudflare Worker 仍是独立部署，不自动代理切换。

注册入口需要确认邮件。Supabase 默认邮件只允许发给项目组织成员且存在频率限制，面向普通用户开放注册前必须配置自定义 SMTP；禁止通过关闭邮箱确认绕过。邮件凭据只放在 Supabase Auth 配置，不写入公开服务 JSON。依据：[官方 SMTP 限制](https://supabase.com/docs/guides/auth/auth-smtp)。

生产项目 URL 或账号存在不等于管理员迁移权限已获得。准备文件、dry-run、HTTP fixture 和嵌入式数据库测试均不能证明托管 Storage 已上线。

## 权限与容量

`storage.objects` 的 INSERT 必须匹配本人的有效 editor 上传会话；没有 UPDATE 策略，已提交对象不可覆盖。只有有 viewer 权限的成员可读已提交 blob，未提交对象限创建者及库管理员读取以核验、清理。下载始终经过用户 JWT 和 Storage RLS，不返回公共 URL，也不使用绕过 RLS 的管理凭据。

Supabase 的私有下载接受用户 Authorization；Storage 控制依赖对象 RLS。依据：[访问控制](https://supabase.com/docs/guides/storage/security/access-control)、[私有下载](https://supabase.com/docs/guides/storage/serving/downloads)。

Supabase Free 当前提供 1 GB 文件存储、5 GB 出站流量；应用的全服务存储预算默认 **950,000,000 字节**，给 1 GB 额度留余量，运营者可在数据库配置中调低，最多调到 1,000,000,000。不是每个库分别获得免费 1 GB。默认单库额度也是 1,000,000,000 字节，`libraries.settings.maxStorageBytes` 可进一步限制；全服务预算始终优先。依据：[Supabase 定价](https://supabase.com/pricing)。

每个尚未持久化的 active Supabase 会话保守预留完整 20 MiB（包括升级前未持久化的旧会话）；对象持久化后按实际对象大小计数，已提交、历史版本和未提交对象都占用预算。服务总量统计项目所有 Storage 桶。Storage 授权探测可能没有 size metadata，因此不能仅预留客户端自报的小数字。保留未完成上传会导致后续上传被提前拒绝，这是防止声称已释放空间而物理对象仍占用的保护。

该预算控制 Lattice 上传会话和桶内写入，不控制运营者绕过应用的写入或其他应用并发写入；应使用专用项目并保留余量。代码不限制出站流量，完整性读回及下载都会产生流量；运营者须检查项目实际用量和 Worker CPU，不能把存储预算称作“零费用保证”。

## 过期与清理

上传会话最多 24 小时有效；过期后不能上传或提交，**过期不会自动释放容量**。未提交完整对象仍可能存在，而尚无对象的会话也继续占用预留。

上传者可调用 `POST /v1/libraries/{libraryId}/uploads/{uploadId}/abort` 清理自己的会话，包括已过期会话。运维可用当前成员 JWT 调用 `POST /v1/libraries/{libraryId}/uploads/cleanup`，每次最多处理 25 个过期 active Supabase 会话。editor 只能清理自己的会话，admin/owner 可清理本库其他成员离开后遗留的上传；多次调用直到 `cleaned=0`。返回请求 ID 可用于排查，不打印 JWT。

清理先调用 Storage DELETE API，再通过数据库检查对象已消失，最后标记 aborted 释放预留；任何一步失败都需重试。已登记为 blob 的对象不允许此路径删除，即使对应文件已进入回收站，历史版本依然需要其字节。此版本没有后台定时清理或历史 blob 垃圾回收；库管理员需要主动清理过期上传。不要直接 SQL DELETE Storage 对象元数据，官方指出这样会留下物理对象。依据：[删除对象](https://supabase.com/docs/guides/storage/management/delete-objects)。

## 保留 R2 路线与验证

`node scripts/prepare-cloud-service.mjs --storage=r2` 另生成 R2 绑定配置和 20 MiB 公开上限。R2 仍需要运营者账号开通。上传会话描述符和 blob 元数据保存各自后端；之后切换新上传后端不会自动迁移已有对象。读已有 R2 blob 必须继续保留 R2 绑定，读已有 Supabase blob 仍需保留桶和权限。

本地验证命令：

```text
npx vitest run workers/shared-library-api/src/index.test.ts workers/shared-library-api/src/supabase-storage.test.ts --maxWorkers=1
node workers/shared-library-api/test-support/supabase-storage-rls.mjs
```

第二项使用已有 `.lattice-build/cloud-team-test-runtime/` PGlite 运行时，构造独立 Auth/Storage schema，真实执行八份 SQL 和用户 RLS，不连接托管项目；还把合成数据库 archive 和物理对象分开保存，加载到新数据库验证 hash、大小及恢复后 RLS。包含匿名 SECURITY DEFINER 和内部 trigger RPC 执行权限检查。合成 Storage schema 不替代 Supabase 实际 API 验收。运维执行与生产待办见 [云库运维和恢复](cloud-library-operations.md)。
