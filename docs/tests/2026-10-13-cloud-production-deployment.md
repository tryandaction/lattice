# 2026-10-13 云库部署与验收

用户完成部署授权后，正式 `lattice-cloud` 项目七份迁移已应用并登记；21 张业务表启用 RLS，5 MiB 私有桶创建成功。Cloudflare Worker 上传成功，但本机直连 workers.dev 超时，所以默认入口使用同套处理器的 Supabase Edge。平台 JWT 验证保持启用；业务查询和 Storage 请求仍转发用户 JWT，不使用管理密钥。

真实双成员合成验收 12 项通过，包含私有库创建、昵称、PDF 字节一致性、PDF 子文件、服务器作者标签、5 MiB 文件、只读禁写、撤销禁读、额度。测试先发现 hosted gateway 会把路径转成 `/shared-library-api/...`，补充路径回归后修复；私有下载 URL 保留完整函数前缀。临时账号、库和物理对象已按用户明确授权清理；数据库重新查询三种残留数量均为 0。

本轮没有额外模型请求，也没有上传私人文件。Auth 管理凭据仅在授权验收进程的内存中使用，没有写入服务、产品、文件或日志。部署及清理证据：`.lattice-build/cloud-service-setup-20261013-supabase/`。

17 项共享 API 测试和 5 项 Edge 适配测试覆盖未登录拒绝、调用者 JWT、路径转换、下载 URL 和桌面 preflight。七份迁移的合成 PostgreSQL RLS 验证 33 项通过，包含函数执行权限收紧。注册表单及公开-key注册请求测试通过；正式邮件投递需要运营者 SMTP，默认 Supabase 邮件的收件人限制未被绕过。

公开连接已准备在 `.env.production.local`，只包含可发布地址和 publishable key。桌面构建、安装和 AI 多轮论文上下文修复的完成状态由本轮最终发行记录确认；不能用前一次桌面门禁结果代替这次更新验收。
