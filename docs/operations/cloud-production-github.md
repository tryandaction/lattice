# 云端 AI、协作历史与 GitHub 的生产接入准备

本页只针对云端服务运营者，不是普通用户的操作前置条件。用户在 Lattice 内授权自己的 GitHub；个人 AI 在个人设置配置，团队模型由库 owner/admin 在团队 AI 面板配置。开发和发布产品无需提供开发者个人 GitHub 登录或 AI API key。本文和生成包不表示已部署，缺少真实回执的迁移、平台密钥、授权、双账号验收和恢复仍属未验证。

本地准备脚本不更新桌面、不部署、不写生产 API、不执行远端迁移。生产写入、GitHub 发布文件和平台调度配置，应在审核具体产物并取得相应授权后执行。

## 1. 本地只读预检

~~~powershell
node "scripts/cloud-production-readiness.mjs" --offline
node "scripts/cloud-production-readiness.mjs" --offline --package-dir ".lattice-build/cloud-service-setup-20261027-supabase" --public-config "<explicit-public-config.json>" --migration-ledger "<explicit-migration-ledger.json>"
~~~

预检只读取当前进程环境、已知默认生成目录及显式提供的文件；不会搜索 .env、CLI 登录目录、个人 token 文件，也不会执行网络、部署、迁移或写文件。不要把 secret 值放入 CLI 参数、公共 JSON 或聊天。路径必须指向运营者明确选定的工件，不需要向预检提供数据库密码、GitHub 用户 token 或 Supabase 登录 token。

默认包目录为 .lattice-build/cloud-service-setup-20261027-supabase。若重新生成到其他目录，显式传入 --package-dir。--public-config 未指定时先检查进程中的 NEXT_PUBLIC_LATTICE_CLOUD_SERVICE，否则检查包内 service-public.example.json；示例占位符不算合法生产配置。--offline 仍可检查显式进程环境是否存在及格式是否合法，不自动加载任何密钥文件。

报告只包含固定字段名、存在/合法布尔值、固定迁移名和状态，不打印地址、key、模型名、配置正文、ledger SQL 或原始异常。格式合法仅代表本地语法满足约束，不证明密钥有效、实际已绑定到服务器、App 权限已批准或域名可达。

- 缺配置、缺迁移账本、生成包 hash/正文不符：status=blocked，退出码 2。
- 本地静态条件齐全：status=configured-unverified，退出码 0。
- 所有情况 productionReady=false、deploymentVerified=false、networkRequests=0；退出码 0 不能代替上线验收。
- 普通 Supabase ledger 只有 version 时可核对迁移版本存在，但 ledgerChecksumVerified=false；可选 sha256 只有与仓库原始 SQL 一致才验证内容 hash。提供的 ledger 只是本地快照，不证明远端当前状态。

## 2. 必须核对的 Supabase 迁移

完整顺序为：

| 文件 | 能力 |
| --- | --- |
| 202608200001_shared_library_core.sql | 核心数据表 |
| 202608200002_shared_library_rls.sql | 共享库 RLS |
| 202608300001_shared_library_security_hardening.sql | 权限强化 |
| 202610080001_cloud_team_library.sql | 云库同步与邀请等 |
| 202610120001_cloud_member_display_names.sql | 成员昵称 |
| 202610130001_cloud_supabase_storage.sql | 私有 Storage |
| 202610130002_cloud_function_privileges.sql | 函数执行授权 |
| 202610170001_cloud_large_objects.sql | 单文件 20 MiB 与容量约束 |
| 202610270001_cloud_team_ai.sql | 库级 AI 策略及原子额度预留 |
| 202610270002_cloud_collaboration_audit.sql | 不可变协作历史，并保留显式私密标记对应的审计读取范围 |
| 202610270003_github_integration.sql | GitHub 身份、加密 token、仓库关联、成员授予与 Webhook 重试账本 |
| 202610270004_github_identity_unbind.sql | GitHub 解除授权及来源权限清理 |
| 202610280001_cloud_team_ai_owner_config.sql | 管理员在产品内配置团队模型、密文存储和模型来源隔离 |

已有项目按 supabase_migrations.schema_migrations 的真实 ledger 只应用缺失迁移，不能重放全量初始化脚本。initialize-new-project.sql 仅用于新的空项目，并有已有库保护。迁移版本曾执行过，不代表可以通过修改同名 SQL 再次应用；若生产已存在相同版本但 SQL 不同，先评审差异并创建新的升级迁移，不删除 ledger 来绕过。

生成包包含 20261027 升级材料；还须核对 202610270004_github_identity_unbind.sql 和 202610280001_cloud_team_ai_owner_config.sql。后者创建服务端专属的库级加密模型表及配置/删除 RPC。始终按真实账本仅应用缺失文件，不能重放已登记迁移。旧 upgrade-20261013-existing-project.sql 仍仅选择 large_objects 存储升级。

运营者可在已授权的只读数据库会话导出以下查询结果为显式 ledger JSON；预检本身不会连接数据库：

~~~sql
select coalesce(json_agg(json_build_object('version', version) order by version), '[]'::json)
from supabase_migrations.schema_migrations;
~~~

只导出 version 即可，不需要导出可能包含敏感业务内容的 statements。现有平台快照工具产出的 migration-ledger.json 数组也可作为本地输入；其中额外字段不会被打印。预检核对生成 manifest 的 SHA256 与初始化脚本中的完整迁移正文，不能仅凭文件名、BEGIN 标记或 migrationCount 宣称完整。

## 3. 服务器配置与公开配置

通过目标平台 secret 管理器绑定以下名称，预检仅报告存在和格式，不需要把实际值交给文档或聊天：

| 名称 | 所需内容与保管要求 |
| --- | --- |
| SUPABASE_URL | 目标项目 HTTPS 根地址 |
| SUPABASE_ANON_KEY | 同项目 publishable key 或 role=anon 的旧 JWT；是公开配置 |
| SUPABASE_SERVICE_ROLE_KEY | 同项目服务器 secret/service-role；仅用于已验证身份后的专属集成、后台账本与预算 RPC，不替换普通请求的用户 JWT/RLS |
| ALLOWED_ORIGINS | 精确来源列表，逗号分隔，无通配符；与实际网页来源及 OAuth 回调来源一致 |
| GITHUB_APP_CLIENT_ID | GitHub App 的 Client ID；不是 App ID、安装 ID 或用户 ID |
| GITHUB_APP_CLIENT_SECRET | GitHub App client secret，仅服务器 |
| GITHUB_TOKEN_ENCRYPTION_KEY | 随机 32 字节 AES-256 key 的标准 Base64 编码，必须独立加密备份 |
| GITHUB_OAUTH_REDIRECT_URI | 完整精确 HTTPS 浏览器回调 URL，无 OAuth code/state 等动态参数 |
| GITHUB_WEBHOOK_SECRET | App Webhook 页面与服务器一致的独立随机 secret，建议至少 32 字符 |
| GITHUB_SYNC_JOB_SECRET | 独立随机后台任务 Bearer secret，建议至少 32 字符；与 Webhook/client/encryption key 分开 |
| TEAM_AI_ENCRYPTION_KEY | 平台独立随机生成的 32 字节 AES-256 主密钥，标准 Base64；不是模型 Key，须独立加密备份 |
| TEAM_AI_ALLOWED_ORIGINS | 可选，自定义团队模型网关的受信任 HTTPS origin 列表；固定官方 origin 内置，禁止内网/IP 或任意代理 |
| TEAM_AI_PROVIDERS_JSON | 可选旧部署兼容。用户自配团队模式不需要此项，禁止为了发布填入开发者个人 Key |

不要把这些服务器 secret 写入 NEXT_PUBLIC_、wrangler vars、公开仓库、日志或面板返回。Supabase 函数由显式 Deno.env 绑定，Cloudflare 使用平台 secret binding；本地生成 wrapper 不等于平台已有 secret。Supabase 默认提供的服务器 key 也仍需确认当前运行时可读，不应以本地存在推断远端已配置。

服务端调用兼容两种 Supabase key：新式 sb_secret_ 仅发送 apikey，不把它当作 Bearer JWT；旧 service-role JWT 同时保留其 apikey/Bearer 路径。普通用户请求继续使用自己的用户 JWT，不能用服务端密钥替代成员授权。

客户端 NEXT_PUBLIC_LATTICE_CLOUD_SERVICE 只允许 name、apiUrl、supabaseUrl、publicKey、maxFileBytes。publicKey 只允许 publishable/anon，maxFileBytes 不超过 20971520。生产公开 JSON 中禁止任何 service-role、数据库密码、GitHub secret 或 TEAM_AI_PROVIDERS_JSON。静态网页构建会把 NEXT_PUBLIC_ 固化到浏览器产物，公开配置调整需重新构建和授权发布网页；本阶段不涉及桌面更新。

CORS 不是授权机制。主 API 必须继续真实验证 Supabase 用户并保留 RLS；生产不能留空 ALLOWED_ORIGINS，也不能因为 Webhook 不带 Origin 而给主 API 放开任意来源。需要桌面既有来源时只保留明确的 tauri 来源，不把开发 localhost 来源带入生产网页来源清单。

## 4. GitHub App 用户授权、PKCE 与安装

当前实现使用 GitHub App **expiring user access token**，不是 classic OAuth App，也不是手填 PAT 或单独的安装 token。必须开启用户 token 到期/刷新机制；服务端要求 access_token、refresh_token、expires_in、refresh_token_expires_in，缺少刷新字段会拒绝绑定。

授权在 GitHub 官方页面进行：服务器生成一次性 state 和 S256 PKCE challenge，verifier 加密保存在服务器，state 绑定当前 Lattice 用户、10 分钟期限和精确 redirect URI。回调 code 由原发起用户的已认证会话交换；state 原子消费后不能重放。浏览器 sessionStorage 短期保存一次性 code 和账号绑定以恢复登录期间的刷新，成功或终止性错误即清除；不保存 access/refresh token 或 verifier，也不把授权码记入日志。

回调必须三处逐字符一致：GitHub App Callback URL、GITHUB_OAUTH_REDIRECT_URI、客户端 authorize/exchange 提交的 redirectUri。示例根路径是 https://app.example.com/；实际应以本次客户端提交的完整值为准。末尾斜杠、路径、协议、域名或端口差异都会失败。不能只匹配 origin，不能使用通配符，不能把 Worker API 路径误当浏览器回调。预检只校验格式和回调 origin 是否在 CORS，不代替实际完整回调验收。

App 仓库权限至少配置 Contents: Read and write、Metadata: Read。用户必须同时拥有目标仓库 push/maintain/admin 之一，App 必须已安装到正确个人/组织并获准访问目标仓库。网页授权用户和 App 安装是两个步骤：有 user token 不代表 App 已安装，有安装也不代表该用户具有仓库写权限。组织策略、待批准安装或未选中的仓库需由对应管理员处理。

自动成员变更 Webhook 另外需要相应事件订阅权限。GitHub 官方文档对 member 和 membership 事件要求组织 Members: Read 或更高；只批准 Contents/Metadata 不足以宣称组织成员自动同步。需要组织管理员批准该组织权限并实际订阅/验收 member、membership、team、organization 等适用事件；个人仓库或不支持的组织策略要明确采用的同步边界，不能假称实时自动撤权。

关联仓库按稳定 GitHub numeric user/repository/installation ID 识别，不按可改名 login 或文件名推断身份。成员需先用自己的 Lattice 用户绑定其 GitHub 身份；无法匹配的 GitHub 用户不会被伪造为云库账号。GitHub 源授予与人工邀请成员分开追踪；撤销 GitHub 源权限不得删除原有人工成员资格。关联/解关联需要库管理权限，文件发布还需当前用户的仓库写权限与 expected SHA 冲突校验。

## 5. Webhook 入口与后台重试

Supabase 部署分开三个入口：

| 函数 | 平台 JWT | 认证与用途 |
| --- | --- | --- |
| shared-library-api | verify_jwt=true | 正常用户 API，继续 Supabase 会话验证与 RLS |
| shared-library-github-webhook | verify_jwt=false | 仅 Webhook POST，原始请求体 HMAC-SHA256 与 X-Hub-Signature-256 验证 |
| shared-library-github-jobs | verify_jwt=false | 仅 POST，Bearer GITHUB_SYNC_JOB_SECRET 的恒定时间校验后执行待重试任务 |

GitHub App Webhook URL 精确设置为 https://<project>.supabase.co/functions/v1/shared-library-github-webhook，secret 与 GITHUB_WEBHOOK_SECRET 相同。不要把 GitHub Webhook 指向要求用户 JWT 的主函数，也不要为了接收 GitHub 请求关闭整套主 API 的 JWT 校验。

Supabase 的 pg_cron/外部受控调度器每 5 分钟 POST 到 https://<project>.supabase.co/functions/v1/shared-library-github-jobs，并通过受保护运行时提供任务 Bearer secret。调度器 secret 应由平台 secret/Vault 引用，不能写进公共 SQL、仓库或任务日志。创建函数和生成 wrapper 不会自动创建 pg_cron/外部调度任务，需运营者单独配置并验收。

Cloudflare 路线固定 POST /v1/integrations/github/webhook 只接受 HMAC；POST /v1/integrations/github/jobs/run 只接受 job secret；Worker scheduled 每 5 分钟调用待重试处理。只有真正部署相应 Cron trigger 才有周期重试，不能以 scheduled 函数代码存在推断已经调度。

验签必须基于原始字节正文，签名前不重排 JSON。ping 可验证签名入口；已识别成员/仓库/安装事件先落持久 delivery 账本，再处理。相同 X-GitHub-Delivery 去重，失败和过期租约可由后台重试。202 accepted 仅代表已接收，必须核对 delivery 的 complete/failed 状态、失败代码和下一次重试结果，不能把 202 当成成员同步完成。

后台任务处理持久队列，不能把它描述成无条件扫描所有仓库的全量 reconcile。丢失事件或订阅不足时，运营者仍需触发受控手动同步并核查权限。不能通过把用户 token 或服务端密钥发给浏览器来补偿未配置的 Webhook/调度器。

## 6. 私密 AI 配置与库策略

默认产品流程是库 owner/admin 在 Lattice“团队 AI → 添加团队模型”输入团队自己的接口、模型与 Key，并设置库额度。平台只提供 TEAM_AI_ENCRYPTION_KEY；Key 经 AES-GCM 加密，附加认证数据绑定 libraryId/providerId。API 不回传 Key 或密文；同地址编辑留空保留，变更地址需新 Key，删除后停止新调用。普通成员不能读写配置表或调用管理 RPC。加密不等于端到端加密，平台调用时可解密。

以下 TEAM_AI_PROVIDERS_JSON 仅为旧平台托管模式兼容示例，不是普通用户或用户自配团队模式的发布必填项：

~~~json
[{"id":"team","label":"团队模型","baseUrl":"https://approved-provider.example.com/v1","apiKey":"SERVER_SECRET_PLACEHOLDER","models":["approved-model"],"maxOutputTokens":1024,"requestBudgetUsdMicros":10000}]
~~~

用户配置上游受平台批准 origin 限制，不接受任意服务器转发地址；禁止 URL 用户密码、query/fragment、IP/本地域及重定向。当前支持 OpenAI-compatible 非流式文本 chat/completions 与 max_tokens；实际模型兼容性需显式验证。自定义允许域名由平台审核公开解析与出站策略，不能把 DNS 名称语法校验当成完整 SSRF 防护。

用户自配模式通过保护的配置 RPC 原子保存 provider 与库策略，无需运营者为每个库手写 SQL。库管理员调整的是本团队 Key 的请求预留，不是获得平台补贴额度；保存本团队模型后，白名单只包含该库自配 provider，不混用旧平台 Key。默认未启用时不能发送。旧平台付费托管额度仍由运营者独立管理。

输出 token 同时受 provider、库策略和全局最多 8192 限制；最多 64 条消息、65536 个消息字符及 128 KiB JSON 请求/响应。客户端文件勾选和对话发送由用户显式操作，回答不自动写文件。取消或关闭浏览器不保证上游取消计费。

每次上游尝试前，数据库事务锁按库原子预留每日次数与月度额度，period 使用 UTC；预留由 service-role 专属 RPC 完成并再次检查成员和策略。requestBudgetUsdMicros 是每次尝试固定的保守额度分配，不是上游实际发票成本。一美元是 1000000 microdollars；运营者必须将分配值设到所允许输入/输出的最坏成本之上，供应商调价后重新评估。错误/超时不自动退款，不由客户端自行报告 token 用量来退还额度。

配置错误、未启用策略或无可用模型应在 UI 明确不可发送，不能以模型读取成功推断上游 key 有效。真实密钥和授权成员访问前不运行付费 smoke；先用受控合成资料和小额度验收，不擅自上传论文/用户私有数据。

## 7. 两个真实账号的验收清单

测试前记录授权的环境、独立合成库/仓库、两个真实 Lattice 账号 A/B、对应 GitHub 身份及清理范围。不得凭本地 mock/PGlite 测试声称线上通过，不在报告中保存 token、邮箱确认 code 或 private file 正文。

1. Auth/CORS：A/B 各自邮箱确认、新登录、刷新、退出；批准来源可用，第三方 origin 不能读响应，未登录请求不能访问主 API。
2. 云库：A 创建独立库并邀请 B；上传合成文件/PDF/子链接，跨账号读取、昵称、评论、冲突、只读与撤权行为均有实测回执。
3. 协作历史：A/B 可见合法共享事件和已读状态；私有批注事件不得向另一账号泄露；普通成员不能修改或删除审计账本。
4. GitHub OAuth：精确回调成功，state 重放/错账号/过期失败；API/browser/storage/log 中没有 user/refresh/client secret；验证 expiring token 刷新和失效重连。
5. 仓库：App 仅安装授权测试仓库；A/B 绑定身份后正确显示关联和 GitHub 源成员；手动 sync、文件读取和授权发布一次合成改动，旧 expectedSha 必须冲突，读取或重试不能额外提交文件。
6. 撤权：从仓库 collaborator/team/installation 实际撤销 B，签名 Webhook 交付后同步收敛，B 对库/文件按来源规则失权；原人工成员资格保留。错误签名、不支持事件、重复 delivery 均验证，故意暂时失败任务在 5 分钟调度后恢复。
7. AI：A/B 中活动成员可列出已启用模型；非成员/撤权不可付费调用；库禁用或缺配置显示不可用。小请求实测一次，日次数/月度预算耗尽不触达上游，错误正文不泄露 key、URL 或异常栈。
8. 备份：完成独立加密副本和隔离恢复演练，再重新验证新登录、库权限、文件字节 hash、历史、GitHub 与 AI 策略；保留必要脱敏证据后按授权清理合成数据。

## 8. 备份与隔离恢复

沿用 [PostgreSQL 快照](cloud-postgres-recovery.md)、[平台恢复](cloud-platform-recovery.md)、[物理 Storage 恢复](cloud-storage-recovery.md) 和 [离线恢复组装](cloud-recovery-offline.md)。数据库 public 中新增的 AI 策略/请求账本、不可变历史、已读游标、GitHub 身份/token ciphertext/关联/成员授予/Webhook delivery 都必须进入同一恢复点；仅备份 files 或 library items 不足以恢复权限和额度。

新迁移的 schema、函数定义/授权、RLS 和 ledger 应与备份数据一起绑定版本和 hash。对象文件物理字节与数据库元数据需要分别备份并校验；public/auth dump 包含认证数据及加密 GitHub token，必须加密保管，不能公开。

GITHUB_TOKEN_ENCRYPTION_KEY、TEAM_AI_ENCRYPTION_KEY、App client secret、Webhook/job secret 和平台 Auth/JWT/SMTP 配置须独立加密恢复，不写入公开 manifest。cloud_ai_library_providers 的密文和其模型/额度策略须处于同一恢复点。丢失主密钥无法解密旧凭据；换 key 需受控重新加密或让受影响用户重新配置，不可直接改字符串后宣称可用。

恢复到不同项目/独立隔离目标，禁止覆盖生产以“测试能否恢复”。切换任何用户入口前保持 AI 禁用/写入暂停，核对 snapshot 之后已消耗但账本尚未恢复的 AI 配额，重新校准当期预算；否则从旧快照恢复可能重复获得本月额度。GitHub OAuth code/state 和 refresh token 在快照之后可能已消费，不能保证还有效；需失效旧尝试并让受影响用户重新授权，重新同步所有关联仓库权限和待处理 delivery，再开放访问。

恢复器成功、数据库 hash 一致、GitHub ping 通过或本地 readiness 通过，均不能代替托管平台 Auth/邮件/对象字节/两账号/AI 成本边界的完整验收。

## 参考依据

- [GitHub App user access token、S256 PKCE 与过期刷新](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub App 权限选择](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Webhook HMAC-SHA256 验签](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Webhook member/membership 事件与组织 Members 权限](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [Supabase 服务端函数授权与 SECURITY DEFINER 限制](https://supabase.com/docs/guides/database/functions)
- [Supabase 服务器真实用户验证](https://supabase.com/docs/reference/javascript/auth-getuser)
