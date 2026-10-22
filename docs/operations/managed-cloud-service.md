# 开发者托管的 Lattice 云库

## 使用者与运维的边界

普通使用者在 Lattice 中登录自己的云库账号、设置昵称、创建库或接受小组邀请。无需登录 Supabase/Cloudflare 控制台、运行数据库迁移或配置 API 地址。

产品运营者配置一次 Supabase Auth/Postgres 项目、API 与私有对象存储，并提供公开的应用连接配置。当前生产使用 Supabase Edge + 私有 Storage，无需开通 R2；已应用第八份迁移，单文件上限 20 MiB。原 Cloudflare Worker 与 R2 路线保留，详细限制见 [Supabase 私有存储路线](./supabase-library-storage.md)。项目创建权限、账单与管理凭据留在运营侧。程序代码与本地 HTTP/数据库测试不能代替托管基础设施，不得把测试服务当作正式云库。

## 已准备的发布接入

`src/lib/shared-library/managed-service.ts` 从 `NEXT_PUBLIC_LATTICE_CLOUD_SERVICE` 读取运营者填写的公开 JSON。首次打开共享库自动选用托管服务；选用托管服务时界面直接显示产品登录，不要求用户粘贴连接配置。已有自托管服务及邀请保留。

公开配置允许 name、apiUrl、supabaseUrl、publicKey、maxFileBytes，禁止任何其他字段。只能使用 HTTPS 和 Supabase publishable/anon key，不接受数据库密码、service-role key、运营令牌。

Next 静态构建将 `NEXT_PUBLIC_` 值写入客户端，所以地址配置必须在发布构建前由运营者提供；这不能保存管理密钥。未填写该配置时应用不会编造已上线的服务。

## 新建服务的具体操作

运行 `node scripts/prepare-cloud-service.mjs` 生成 `.lattice-build/cloud-service-setup-20261017-supabase/`：八份迁移合成的事务初始化 SQL、增量存储迁移、无 R2 绑定的 Worker 配置、公开配置示例及迁移 hash。此脚本只准备本地文件，不创建资源或部署；不要直接覆盖已填写的部署目录。使用 `--storage=r2` 可以生成 R2 路线的独立配置。函数执行权限迁移收紧内部 trigger 与匿名 RPC 的默认权限。

1. 运营者创建 Free 组织下的 Supabase 新项目。数据库密码及账号验证通过服务方官方流程处理。
2. 新空项目执行 `initialize-new-project.sql`，包含昵称同步、数据库访问隔离、版本校验及 PDF 子文件关联。已有资料库必须走迁移记录，不运行全量初始化 SQL。
3. 默认由第六份迁移准备 private Supabase 桶 `lattice-shared-library` 和用户 RLS，第八份迁移升级到 20 MiB；确认桶限制、项目全局限制和策略。已有七份迁移的项目只执行增量升级，详见存储路线。只有选择 R2 路线时，才需开通 R2、创建私有 Standard 桶并绑定 `LIBRARY_BLOBS`。
4. 在 Worker 配置 `SUPABASE_URL`、公开的 `SUPABASE_ANON_KEY`。Worker 转发用户 JWT，由数据库 RLS 验证权限，不能使用 service-role 绕过用户权限。
5. 先执行 Wrangler `deploy --dry-run` 检查产物及绑定，再取得运营者部署授权后部署；Supabase Edge 的生成及部署步骤见存储路线。配置内包含桌面及现有网页来源；两条存储路线当前单文件上限均为 20 MiB。更新时须同时交付会话片长协商支持，不能只提高桶限制。
6. 把真实 Worker URL、Supabase URL 及公开 key 写入产品构建的公开服务 JSON，执行产品门禁后发布桌面。不要把示例中的占位符当作上线配置。
7. 验收两个实际成员：登录、上传合成 PDF/批注/子文件、设置各自昵称、相互看到批注作者、权限撤销与版本冲突。未经许可不上传使用者论文或私有文件。

## 费用依据与实际限制

2026-10-12 核查官方定价：Supabase Free 为每项目 500 MB 数据库，闲置一周会暂停，且无自动备份；Workers Free 每天 100,000 请求、每次 10 ms CPU；R2 Standard 每月免费 10 GB-month、100 万次 A 类和 1,000 万次 B 类操作，出站流量免费。R2 开通仍要求有效支付方式，超额度会收费。

这些免费额度不是硬性总费用上限。当前服务上传会计算内容 hash，部署后必须用实际文件测量 Worker CPU；免费 CPU 上限不足时应先调整处理方式或由运营者明确批准 Workers 付费套餐，不能悄悄升级。数据库每库额度不等于整个 R2 账号用量上限，也不能保证所有库合计零费用。

来源：[Supabase 定价](https://supabase.com/pricing)、[Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)、[R2 定价](https://developers.cloudflare.com/r2/pricing/)、[R2 开通](https://developers.cloudflare.com/r2/get-started/)。

## 本次状态

以下 2026-10-13/15 内容保留历史验收事实。当前生产已于 2026-10-17 应用第八份迁移、部署 Edge v5，并通过 20 MiB 与故障恢复验收；5 MiB 是旧状态，不是当前上限。最新交付与运营待办见 [开发交付](../tests/2026-10-19-development-handoff.md) 和 [安全完善收尾清单](../superpowers/plans/2026-10-19-safe-closeout.md)。

2026-10-13 用户完成官方 CLI 部署授权后，已在 `gxsauhzganbnqflmlpnk` 健康空项目应用七份迁移并登记历史，准备 private `lattice-shared-library` 桶。21 张业务表启用 RLS。生产云库 API 复用同一套处理器，已部署至 Supabase Edge，公开入口为 `https://gxsauhzganbnqflmlpnk.supabase.co/functions/v1/shared-library-api`；平台 JWT 校验保持开启。

Cloudflare Worker 也部署至 `https://lattice-shared-library-api.formula-ocr.workers.dev`，版本 `31175435-8d38-4363-9c75-f3a8afc2052e`。但当前网络直连超时，故产品使用已实际验证可达的 Supabase Edge 地址；不能声称已验证 Worker 5 MiB 上传或免费 CPU 适用性。无需开通 R2，未升级付费套餐。公开连接已写入本机发布构建配置，桌面发布状态以最新交付记录为准。

线上双临时账号通过 12 项验收：真实 Auth 登录、私有库、成员昵称、PDF 上传/版本与精确下载、PDF 子文件、服务器作者标签、5 MiB 文件、只读禁写、撤销禁读和额度。用户另行明确授权的 Auth 管理凭据只在测试进程内存中使用，未配置到 Worker、Edge 或桌面；合成文件和账号测试后全部清理，数据库复核残留数量为零。证据位于 `.lattice-build/cloud-service-setup-20261013-supabase/live-acceptance.json`。

产品提供同一简洁表单内的创建账号入口并要求邮箱确认。公开注册使用运营者配置的自定义 SMTP；本项目已配置并实际收到注册邮件。保持邮箱确认，不通过管理员逐人建号或关闭确认作为注册流程。用户无需厂商账号或密钥。新建部署的默认 Supabase 邮件限制参见：[Supabase 官方邮件限制](https://supabase.com/docs/guides/auth/auth-smtp)。

2026-10-13 的邮件配置待办已由下述 10-15 核验更新。Supabase 控制台运营者账号与产品账号不是同一身份；用户个人账号是否已确认并成功登录，仍须与服务部署状态分别判断。

2026-10-15：QQ SMTP 已核验，用户已实际收到邮件。当前网页已发布到 `https://lattice-apq-7xj.pages.dev/`，Supabase 邮件返回地址已同步。确认回调清理、过期提示、共享文件静态深链、移动视口均通过线上浏览器检查；合成会话验收不代表个人账号已登录。Pages 项目为 `lattice-apq`，旧 `lattice-apq.pages.dev` 不属于当前授权账号，未更新旧域。Edge 的精确 CORS 已实测桌面与新域允许、无关域不允许。后续 AI/PDF 质量修复另行验收发布；详见 [QQ SMTP 配置与核验](./qq-mail-smtp-setup.md)。
