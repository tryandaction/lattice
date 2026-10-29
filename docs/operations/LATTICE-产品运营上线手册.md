# Lattice 产品运营上线手册

更新日期：2026-10-28。本手册适用于把当前代码发布成可供普通用户使用的云端库。

## 0. 结论

产品运营方不需要提供个人 GitHub 登录、GitHub token、个人 AI API key 或任何普通用户密码。运营方只配置平台基础设施和产品级 GitHub App。

普通用户在产品内完成：授权自己的 GitHub、配置自己的个人 AI。库 owner/admin 在产品内配置团队模型和团队 Key。

## 1. 你要有的权限

需要能管理同一个正式环境的 Supabase、Cloudflare Pages 和 GitHub 产品账号/组织。仓库中的 wrangler.json 与 wrangler.deployment.json 是 Pages 部署目标；如果正式项目不同，先改目标并审核。

运营者在官方页面完成一次 CLI 平台账号授权，并确认正式项目与部署范围后，代理可使用该授权执行后续配置和部署。注册产品 GitHub App、批准组织权限仍需对应管理员操作；无需把个人 GitHub token、个人 AI Key 或平台密码发给代理。

## 2. 登录 CLI

在仓库根目录运行：

~~~powershell
node --version
npm --version
npx supabase --version
npx wrangler --version
npx supabase login
npx wrangler login
$SupabaseProjectRef = '<SUPABASE_PROJECT_REF>'
npx supabase link --project-ref $SupabaseProjectRef
npx supabase projects list
npx wrangler whoami
~~~

supabase projects list 必须包含目标正式项目；wrangler whoami 显示的授权账号必须能管理 wrangler.deployment.json 指定账号的 Pages 项目。不要运行 supabase db reset --linked，它会清空远程库。

开放注册前，在 Supabase Authentication 中核对以下配置：

- 保持邮箱确认开启，配置可向普通用户投递的自定义 SMTP；发信凭据只放 Supabase Auth 配置。已有环境也要核验当前投递状态，不能沿用旧验收结论。
- 将 Site URL 设置为本次正式网页地址，在 Redirect URLs 中允许实际邮件确认/找回密码返回地址；正式域名变更时同步更新并实测。

邮件配置与历史验收见 [QQ SMTP 配置与核验](./qq-mail-smtp-setup.md)、[托管云服务](./managed-cloud-service.md)。历史记录不代表本次环境已配置完成。

## 3. 生成材料

~~~powershell
node scripts/prepare-cloud-service.mjs --storage=supabase
node scripts/prepare-supabase-cloud-function.mjs
~~~

成功后应有 .lattice-build/cloud-service-setup-20261027-supabase、三个 supabase/functions 入口，以及 13 个迁移的 manifest。最后两个迁移是 202610270004_github_identity_unbind.sql 和 202610280001_cloud_team_ai_owner_config.sql。

## 4. 应用数据库迁移

先备份，再查看差异：

~~~powershell
npx supabase migration list --linked
npx supabase db push --dry-run --linked
~~~

确认只包含缺失迁移后运行：

~~~powershell
npx supabase db push --linked
npx supabase migration list --linked
~~~

不要重放 initialize-new-project.sql，不要删 migration ledger，不要修改已执行版本。现有项目只应用缺失迁移。

这两类命令使用第 2 步 link 的项目，不接受 --project-ref；参数依据见 [db push](https://supabase.com/docs/reference/cli/supabase-db-push) 与 [migration list](https://supabase.com/docs/reference/cli/supabase-migration-list)。

## 5. 配置 Supabase Secrets

在 Supabase Dashboard 的 Edge Functions → Secrets 中填写以下值。实际值只放平台密码管理器，不发聊天、不进仓库：

| 名称 | 作用 |
| --- | --- |
| ALLOWED_ORIGINS | 正式网页 origin，逗号分隔，不能是星号 |
| GITHUB_APP_CLIENT_ID | 产品 GitHub App 的 Client ID |
| GITHUB_APP_CLIENT_SECRET | 产品 GitHub App Client secret |
| GITHUB_TOKEN_ENCRYPTION_KEY | 随机 32 字节 Base64，用于 GitHub token 密文 |
| GITHUB_OAUTH_REDIRECT_URI | GitHub Callback URL，逐字符一致 |
| GITHUB_APP_SLUG | GitHub App slug，用于安装仓库链接 |
| GITHUB_OAUTH_ALLOWED_RETURN_ORIGINS | 允许 OAuth 回到的正式网页 origin |
| GITHUB_WEBHOOK_SECRET | GitHub Webhook HMAC secret |
| GITHUB_SYNC_JOB_SECRET | Jobs 调度 Bearer secret |
| TEAM_AI_ENCRYPTION_KEY | 随机 32 字节 Base64，用于团队模型 Key 的 AES-GCM 密文 |
| TEAM_AI_ALLOWED_ORIGINS | 可选，自定义团队网关 origin，逗号分隔 |

SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY 通常由 Supabase 运行时提供。service-role 只留在服务器。

不需要配置 TEAM_AI_PROVIDERS_JSON；它只是旧平台托管兼容。团队模型由库 owner/admin 在产品内配置。

生成随机平台密钥：

~~~powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
~~~

GITHUB_TOKEN_ENCRYPTION_KEY 和 TEAM_AI_ENCRYPTION_KEY 各生成一份，分别备份，不能复用或随便替换。

## 6. 注册 GitHub App

在产品账号或组织 GitHub Settings → Developer settings → GitHub Apps 创建产品 App。

填写：

- Homepage URL：正式网页，例如 https://app.example.com/
- Callback URL：与 GITHUB_OAUTH_REDIRECT_URI 完全一致，例如 https://app.example.com/
- Webhook URL：https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/shared-library-github-webhook
- Webhook active：开启
- Repository Contents：Read and write
- Repository Metadata：Read-only
- User access tokens：开启到期与刷新（expiring user access tokens）；当前服务端要求授权响应包含 refresh_token、expires_in 和 refresh_token_expires_in，不能关闭该机制。

订阅 member、membership、team、repository、installation、installation_repositories、organization 事件。组织事件可能需要组织管理员批准 Members/organization/team 权限。

App 安装范围先选择 Only select repositories。用户首次连接时仍会在 GitHub 官方页面授权自己的账号和仓库。

## 7. 部署 Edge Functions

主 API 保留 JWT 校验；Webhook 和 Jobs 使用自己的 HMAC/Bearer 校验：

~~~powershell
npx supabase functions deploy shared-library-api --project-ref $SupabaseProjectRef --use-api
npx supabase functions deploy shared-library-github-webhook --project-ref $SupabaseProjectRef --no-verify-jwt --use-api
npx supabase functions deploy shared-library-github-jobs --project-ref $SupabaseProjectRef --no-verify-jwt --use-api
npx supabase functions list --project-ref $SupabaseProjectRef
~~~

成功判断：三个函数均已部署，主 API 未登录返回 401，Webhook 错误签名被拒绝。日志不得包含 Key、token 或上游原始异常。

## 8. 配置 GitHub 重试

在 Supabase Vault 保存 GITHUB_SYNC_JOB_SECRET。用 pg_cron 或外部调度器每 5 分钟 POST：

https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/shared-library-github-jobs

请求头为 Authorization: Bearer <GITHUB_SYNC_JOB_SECRET>。用一条合成失败 delivery 验证下一次任务可恢复。

## 9. 构建并部署网页

只把公开连接信息放入本次构建进程：

~~~powershell
$publicCloud = @{ name = 'Lattice 云库'; apiUrl = 'https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/shared-library-api'; supabaseUrl = 'https://<SUPABASE_PROJECT_REF>.supabase.co'; publicKey = '<SUPABASE_ANON_OR_PUBLISHABLE_KEY>'; maxFileBytes = 20971520 } | ConvertTo-Json -Compress
$env:NEXT_PUBLIC_LATTICE_CLOUD_SERVICE = $publicCloud
npm run qa:gate
npm run build
Get-Item -LiteralPath "web-dist/index.html", "web-dist/library.html"
node scripts/deploy-cloudflare-pages.mjs --dry-run
node scripts/deploy-cloudflare-pages.mjs
Remove-Item Env:NEXT_PUBLIC_LATTICE_CLOUD_SERVICE
~~~

dry-run 必须显示 project=lattice、branch=main、dryRun=true；accountId 应匹配 wrangler.deployment.json，version 应匹配 package.json，并包含本次产物的 indexSha256 与 builtAt。该项目的网页入口为 https://lattice-apq.pages.dev/，项目名与分配的域名不必相同。脚本不输出 directory；上面的 Get-Item 单独确认 web-dist 中两个入口存在，builtAt 还须对应本次构建。正式发布脚本会执行 wrangler whoami 后上传 Pages。不要把 $publicCloud 写入仓库。

## 10. 产品内配置第一个团队模型

1. 用测试 owner 登录正式网页。
2. 点击共享库 → 新建空库。
3. 打开团队 AI → 添加团队模型。
4. 填团队自己的兼容 API 地址、模型 ID、API Key。
5. 设置每日次数、每月额度、单次预留和输出 Token 上限。
6. 保存后发送一条合成问题。
7. 用第二个账号验证只能看到模型，不能看到 Key。
8. 编辑已有模型：Key 输入框必须为空；同地址留空保存应继续可调用。
9. 更换地址但不填新 Key 必须失败。
10. 移除模型并确认，成员不能继续调用。

## 11. 双账号验收

使用合成库、合成 PDF 和测试私库，不上传真实论文或个人资料：

- A 注册确认、建库、上传 PDF；B 接受邀请并读取。
- A/B 创建批注，验证本人、他人、指定成员和全部隐藏。
- A 绑定自己的 GitHub，关联测试私库，导入合成 Markdown。
- 拉取/发布一次；旧 SHA 必须冲突，不得静默覆盖。
- 撤销仓库权限，验证签名 Webhook 和 Jobs 收敛；人工成员规则保持不变。
- 达到 AI 日/月额度后，新的请求应在触达上游前被拒绝。
- 检查浏览器存储、响应、日志和发布产物没有 Key、token 或测试登录态。

## 12. 故障处理

| 现象 | 检查 |
| --- | --- |
| 云库不可用 | NEXT_PUBLIC_LATTICE_CLOUD_SERVICE、API URL、函数部署、ALLOWED_ORIGINS |
| GitHub 没仓库 | App 安装范围、用户写权限、组织批准、Callback URL 三处是否一致 |
| 成员不同步 | Webhook secret、事件权限、delivery、Jobs 调度 |
| 团队模型设置失败 | 202610280001 迁移、TEAM_AI_ENCRYPTION_KEY、service-role、origin 白名单 |
| 上传失败 | Storage private bucket、Storage 迁移、20 MiB 限制和成员权限 |

不要关闭 RLS，不要把 service-role 放到网页，不要把用户 Key 放进 NEXT_PUBLIC_*，不要删除 migration ledger 来绕过错误。

官方命令依据：Supabase 的 link/db push/functions deploy 流程见 Supabase 官方文档；Pages 发布使用 wrangler pages deploy；GitHub App callback、权限和 webhook 在 GitHub App 设置中配置。

## 13. 2026-10-28 本次执行状态

以下为本次已实测的状态；正式云服务和网页已发布，桌面更新与最终验收继续进行：

| 项目 | 状态与下一步 |
| --- | --- |
| Cloudflare 账号与目标 | 已核验并修正：原站所属账号为 2b234c5cf6eee4c634410cd05c5c2d21，Pages 项目名为 lattice，生产分支 main，正式入口为 https://lattice-apq.pages.dev/。带 7xj 的旧替代项目不作为本轮发布目标。 |
| Supabase 项目与迁移 | 已恢复并升级：gxsauhzganbnqflmlpnk / lattice-cloud 为 ACTIVE_HEALTHY；前 8 份没有重放，新增 5 份迁移已应用；fresh 账本 13 份本地与远端一致。 |
| 数据库备份 | 已完成：原生 PostgreSQL 18.6 通过 verify-full 备份 public、supabase_migrations 的结构、数据与 ACL，归档检查及两次 DPAPI 解密哈希验证通过，临时明文已清除。此为本轮迁移范围备份，不含 auth、storage、物理文件或全局角色；恢复依赖原 Windows 用户 DPAPI 密钥及原环境外部依赖。 |
| 生产 Edge Functions | 已部署并核验：shared-library-api v8 保持 JWT=true，shared-library-github-webhook v1 与 shared-library-github-jobs v1 使用各自 HMAC/Bearer 认证；三个函数 ACTIVE。未登录/错误签名请求返回 401，合法合成 Webhook ping 返回 200。 |
| 生产 Secrets 与来源限制 | 已配置并复核：为该项目新增 4 个随机平台密钥（GitHub token 加密、Webhook、Jobs、团队 AI 加密）及 3 项正式域名配置；平台摘要与本机 DPAPI 加密备份匹配，临时明文文件已清除。 |
| 本地发布材料与专项测试 | 已完成：已刷新含 13 个迁移的生成包和 3 个 Edge 入口，95 项专项测试通过；本地通过不替代生产验收。 |
| 正式网页与质量检查 | 已发布：原站 3.1.9 的 build-info 与本地产物哈希一致，主页和 /library 均返回 200。最终 Web 构建生成 21 页，5,890 项测试通过、3 项跳过；类型检查、文档检查和 lint 通过（0 错误、162 条警告）。首次使用→共享库→登录入口已在 1440×950 与 390×844 验证，无横向溢出、无运行时错误；两条首次插件 OPFS 缺失警告使用内置回退。 |
| 生产 Secrets 写入授权 | 已完成：用户明确授权向 lattice-cloud 项目写入以上字段；没有使用个人 GitHub token 或个人 AI Key。 |
| GitHub App | 已创建并接入：[Lattice Gezhi Cloud](https://github.com/apps/lattice-gezhi-cloud)，归属 tryandaction，公开可安装；Contents=write、Metadata=read、组织 Members=read。产品 Client ID/Client secret/slug 已写入服务端，secret 摘要核验通过并加密备份。主页与唯一精确回调均为原站，SSL 校验开启；注册时 expiring user tokens 开启。未将 App 安装到任何用户仓库，仓库由各用户在产品内自行授权。 |
| 邮件服务 | 当前 QQ SMTP 已核验：smtp.qq.com:465，发件邮箱与用户名 xingduoweiyun@qq.com，发件人 Lattice 格致；邮箱确认开启、30 封/小时。已单字段把 auth.site_url 改为 https://lattice-apq.pages.dev/ 并复核 SMTP/邮箱确认不变；额外重定向为空。本轮未发送真实邮件，不把历史投递成功当作本轮投递验收。 |
| 五分钟重试 | 已启用并实测：pg_cron + 私有同步 HTTP + Vault，任务 lattice-shared-library-github-retry-5m 为 active，每 5 分钟执行。手动 POST 与首轮定时任务均成功（HTTP 200）；普通角色不能访问私有 HTTP schema 或读取 Vault。未使用会持久保存请求头的 pg_net 队列。 |
| 双账号业务验收与桌面 | 进行中：合成双账号验收脚本已准备，桌面已按用户新要求加入本轮更新并运行完整 qa:gate；结果以最终验收记录为准。 |

本轮没有 Git 提交或推送。当前原站使用直接上传的本地构建；以后通过 Git 自动发布时，须先按仓库流程纳入这些源码与目标配置，避免旧源码覆盖现网。

## 14. 普通用户现在怎么使用

打开 https://lattice-apq.pages.dev/，点击共享库，注册或登录自己的 Lattice 账号，然后新建库并上传文件。共享与协作在库内完成；连接 GitHub 时到 GitHub 官方页面授权自己的账号，并仅选择希望访问的仓库。个人 AI 在自己的设置中配置，团队 AI 由该库 owner/admin 在产品内添加模型和团队 Key。

用户不需要创建 Supabase 项目、产品 GitHub App、运行迁移或填写平台加密密钥。运营者的发信和平台凭据保留在服务端，不进入网页或桌面分发包。

## 15. 2026-10-29 注册确认与自动部署复核

- 正式网页、注册确认、重发确认、密码恢复与邀请链接统一使用 https://lattice-apq.pages.dev/；代码不再把正式域名改写为旧的 7xj 入口。
- 注册界面依据服务端结果区分已发送、发送状态未知和登录时邮箱未确认；成功 HTTP 状态不等于收件箱实际投递成功，不据此宣称整个注册闭环已验收。
- 用户授权的一次真实注册请求返回 HTTP 200 和 confirmation_sent_at。2026-10-29 用户确认已在垃圾邮件文件夹找到本次确认邮件，证明此次真实收件，但不能视为稳定进入收件箱的投递质量验收；确认链接激活、返回网页和个人账号登录仍须分别验证。没有重复发送、点击私人确认链接或保存测试密码。
- 此次投递测试使用仅驻留内存的随机密码，不向用户提供默认密码。若使用该测试账号继续验收，由用户通过产品内“忘记密码”设置自己的密码，不反复注册，也不在聊天中提交密码、验证码或确认链接。
- SMTP 已启用，smtp.qq.com:465，发件地址和用户名 xingduoweiyun@qq.com，发件人 Lattice 格致，确认开启，30 封/小时；site_url 为正式网页，额外回跳白名单为空。模板和 Auth 投递错误日志未获安全可读证据。
- GitHub Actions 运行 40816858848（e4a5d22）在 runner 启动前因账号账单限制失败，执行步骤为零。该通知不是 Lattice 注册邮件；网页可使用已授权的 Cloudflare Pages 直接部署流程。账号所有者须在 GitHub Billing 页面自行核实并解除限制，不通过修改代码或自动重试绕过。
- 当时计划为不重新构建、安装或发布桌面产品；该计划已被 2026-10-29 后续用户要求更新版本并完成桌面验收的指示取代。网页部署、桌面安装和真实邮件收件仍须分别报告，不能互相代替。

## 16. 2026-10-29 邮箱验证码与 3.2.0 收尾

本节记录本次 OTP 方案及当前可确认边界；旧确认链接流程的历史记录保留作审计，不代表新验证码已实测投递。

- 正式网页和 Auth Site URL：`https://lattice-apq.pages.dev/`。正式 SMTP 保持启用：QQ SMTP `smtp.qq.com:465`，发件地址/用户名 `xingduoweiyun@qq.com`，发件人“Lattice 格致”，邮箱确认开启，服务端显示限额为 30 封/小时。
- Supabase Confirm Signup 邮件模板已保存并回读：主题“Lattice 格致 · 邮箱验证码”，正文使用 `{{ .Token }}`，不含确认 URL 占位符；OTP 配置为 8 位、有效期 3600 秒。密码恢复仍走独立的恢复邮件流程。
- 3.2.0 产品代码实现注册后输入 8 位验证码、服务端校验、验证成功后建立登录会话，并提供 60 秒界面重发冷却；运营者不要把界面冷却当作服务端发送限流。
- 最终安全依赖验证：lint 为 0 错误、159 项既有警告，类型检查与文档校验通过；完整测试为 5930 项通过、3 项跳过。生产依赖审计为 0 告警。公式安全回归覆盖五条真实渲染路径，阻止公式中的外部链接、图片和 HTML 命令，并保留分数、矩阵与物理宏。
- 邮件实际测试边界：用户此前确认在垃圾邮件中收到的是旧确认链接邮件。OTP 模板保存后没有再发送验证码邮件；OTP 的真实到达、邮箱验证、登录和协作操作均未据此实测通过。不要为验证而重复注册或发送测试邮件；需要真实 OTP 验收时，先指定测试收件邮箱并取得该次发送授权。
- 运营方要改善投递质量，可选择自有发信域和邮件服务商，在服务商配置并验证 SPF、DKIM、DMARC，再更新 Supabase Auth 的自定义 SMTP。QQ 个人邮箱设置不构成商业邮件到达率承诺。SMTP 授权码只保存在 Supabase Auth，不进入网页、桌面包、仓库或 AI 配置。
- 普通用户仍在产品内授权自己的 GitHub 仓库并设置自己的个人 AI；库 owner/admin 按产品设计配置团队 AI。产品运营者不需要把个人 GitHub token 或 AI API Key 注入产品，也不应索取普通用户的此类凭据。
- 网页 3.2.0 安全构建已于 2026-10-29 部署至原站；首页、`/library` 和 `/build-info.json` 均为 HTTP 200，首页 SHA256 为 `968a78a5e2fb6dbd86da38d8799f216046d5ab323c8dc3892eb13df7d4ba405d`，与桌面/移动浏览器验收构建一致。浏览器还验证了 OTP 成功后库列表返回 503 时可以改用密码登录恢复，所有外部请求均使用合成响应。
- 桌面 3.2.0 已通过 NSIS 安装器更新到本机 `AppData/Local/Lattice/lattice.exe`，安装退出码为 0，程序 SHA256 与发布包一致（`aa3359631bfa6653b7aa9086229972558b63865ed8621e42440a30824d7d69d8`）。正常窗口标题为“Lattice 格致”，进程响应正常。独立诊断配置的真实 PDF 烟测通过，覆盖画布和文字层、文字选择与复制、批注及搜索命中状态保持。
- 本轮本地安装包交付为 NSIS，位于 `releases/v3.2.0-cloud-otp-20261029`，含校验清单；没有将安装包上传 GitHub Release，也没有把早先失败的 MSI 作为可用产物。产品代码提交 `a36bfb3` 已推送 `main`，其余并行 AI 开发改动没有纳入。网页部署、桌面安装、GitHub 推送和真实 OTP 收件是四项独立状态；真实 OTP 邮件投递仍沿用前述未重复验收边界。
