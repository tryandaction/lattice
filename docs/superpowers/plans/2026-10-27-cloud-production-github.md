# 云端真实使用与 GitHub 集成实施计划

规格：../specs/2026-10-27-cloud-production-github-design.md。按用户要求本窗口持续执行，不更新桌面产品。

- [x] completed：核对现有 Auth/Storage/Edge、客户端模型和版本协议，确定增量实现范围。
- [x] completed：团队 AI、不可变协作审计、GitHub App 后端及现有管理面板、文件流程接入。
- [x] completed：真实 PostgreSQL/RLS、权限撤销、SHA/版本并发与凭据安全聚焦测试。
- [x] completed：生产静态页面 Playwright 协作入口与版本/PDF流程验收；最新记录按数字序号排序并显示最新修改作者。
- [ ] pending：生产配置与迁移账本、App安装/模型密钥、远端部署和真实双账号验收；当前未取得这些执行条件，不冒充已上线。
- [x] completed：源码冻结批次 5656 项通过/3 项跳过；后续定向回归通过；最终 Web 优化/类型检查/21 页导出及浏览器验收通过。交付记录见 ../../tests/2026-10-27-cloud-production-github.md。

## 文件分工

- `workers/shared-library-api/src/team-ai.ts` 和 `supabase/migrations/202610270001_cloud_team_ai.sql`：团队 AI 路由及预算。
- `workers/shared-library-api/src/collaboration-audit.ts` 和 `supabase/migrations/202610270002_cloud_collaboration_audit.sql`：不可变协作审计。
- `workers/shared-library-api/src/github.ts` 和 `supabase/migrations/202610270003_github_integration.sql`：GitHub 授权、成员来源、Webhook重试、仓库内容同步及元数据 CAS。
- `workers/shared-library-api/src/integration-context.ts`：模块共享用户 JWT 数据库接口；主 handler 统一鉴权及 CORS。
- 前端复用 cloud controller 和既有聊天模型接口，管理面板按需展开团队 AI/GitHub，文件工具条提供审计。
