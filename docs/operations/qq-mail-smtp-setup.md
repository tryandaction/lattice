# 用 QQ 邮箱配置 Lattice 注册确认邮件

适用项目：`lattice-cloud`（`gxsauhzganbnqflmlpnk`）。用户选用发件邮箱：`xingduoweiyun@qq.com`。

## 1. 在 QQ 邮箱取得专用授权码

在你自己的浏览器打开 [QQ 邮箱](https://mail.qq.com/)，自行登录。进入“设置”，查找“账户”或“账号与安全”里的“POP3/IMAP/SMTP”服务。开启包含 SMTP 的服务，按 QQ 要求完成手机验证，生成一枚专用于 Lattice 的授权码。

授权码属于发信凭据。不要发到聊天、截图、仓库或 Lattice 的 AI API 配置。它只需填入下面 Supabase 官方页面的 SMTP Password 字段。QQ 登录密码不能代替授权码。

## 2. 填入 Supabase 项目

打开 [lattice-cloud 项目](https://supabase.com/dashboard/project/gxsauhzganbnqflmlpnk)，进入 **Authentication → Email → SMTP Settings**（界面中也可能显示 **Custom SMTP**），开启 **Enable custom SMTP**。

| 字段 | 填写内容 |
| --- | --- |
| Sender email / 发件地址 | `xingduoweiyun@qq.com` |
| Sender name / 发件人名称 | `Lattice 格致` |
| Host / SMTP 服务器 | `smtp.qq.com` |
| Port / 端口 | `465` |
| Username / 用户名 | `xingduoweiyun@qq.com` |
| Password / 密码 | 第一步生成的 **QQ 邮箱授权码** |
| 加密（若有该选项） | `SSL/TLS`，与 465 端口对应 |

点击 **Save changes**。保留邮箱确认（Confirm email）开启。不要修改项目 API key 或把邮箱凭据填进 Worker/Edge/桌面环境变量。

若 QQ 拒绝英文别名登录，查看 QQ 邮箱设置显示的主账号；可将 Username 改成该邮箱对应的数字 QQ 邮箱地址，发件地址仍需是账号允许使用的地址。不要猜测主账号或反复生成授权码。

## 3. 完成后如何回复

只回复：**“QQ SMTP 已保存”**。不附授权码或密码截图。随后检查真实配置状态和投递链路；保存成功本身不证明邮件已送达。

发送测试邮件或触发注册邮件前，明确测试收件邮箱。测试只发送合成确认内容；不附论文、日志或个人文件。收到后再验收确认链接与 Lattice 登录。公网注册仍需验证实际投递和发送限制，QQ 个人邮箱方案不能视为大规模商业邮件服务承诺。

## 依据

- [腾讯官方 Email 连接器：QQ 邮箱使用授权码](https://cloud.tencent.com/document/product/1270/55456)
- [腾讯官方邮箱 SMTP 参数：smtp.qq.com / SSL 465](https://intl.cloud.tencent.com/zh/document/product/1266/71700)
- [Supabase 自定义 SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

本说明未保存任何授权码，也未自动发送邮件。参数已核查，最终连通和投递需配置后实测。

## 2026-10-15 配置核验

用户已在官方控制台保存 QQ SMTP。使用已有 CLI 部署授权只读核验：SMTP enabled=true、host=smtp.qq.com、port=465、发件地址及用户名=xingduoweiyun@qq.com、发件人名称=Lattice 格致；邮箱确认保持开启，当前邮件发送限制为30封/小时。未读取、打印或保存SMTP授权码，也没有向产品或Worker配置发信凭据。

核验发现 auth.site_url 仍是 http://localhost:3000，已通过单字段配置变更改为 `https://lattice-apq.pages.dev/`。该地址实测返回HTTP 200。发布预览只包含 auth.site_url 一项变化；应用后重新核验无待更新项，SMTP和邮箱确认设置保留。旧 `/library` 网页路径返回404，未将其用作返回地址。在线页面作为确认后的返回页，桌面用户仍需回到Lattice登录。

用户随后已自行注册并收到确认邮件，邮件投递链路得到实际确认。旧 `lattice-apq.pages.dev` 不在当前授权 Cloudflare 账号，可管理项目是 `lattice-apq`、域名 `lattice-apq-7xj.pages.dev`，发布命令已修正。2026-10-15 已将当前网页发布至新域，并将 auth.site_url 再次修正为 `https://lattice-apq-7xj.pages.dev/`，只更改返回地址，SMTP 与邮箱确认保留。线上浏览器已验收过期链接提示、回调敏感参数清理、合成确认会话持久化与移动布局；未使用用户的确认令牌，未验收个人账号登录。

无需重新创建已注册账号。完成新版发布后，先使用同一邮箱及注册时自行设置的密码登录；若明确提示邮箱未确认，使用“重新发送确认邮件”并打开最新邮件。Supabase 控制台运营者账号与产品账号不是同一身份。不要发送确认链接、密码或授权码。配置核验记录：`.lattice-build/smtp-acceptance-20261015/configuration.json`、`redirect-preview.json`、`redirect-applied.json`，均只保存白名单非敏感配置。
