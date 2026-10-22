# 托管平台数据导出开发验收

状态：适配已有 Supabase 平台结构的数据导出已实现并通过本机原生 PostgreSQL 合成验收和独立复审；序列标记复审项已修复。后续已增加受保护导入实现，见[导入记录](2026-10-22-platform-restore.md)；托管项目 API/Auth/SMTP 和生产运行仍未完成。客户端 3.1.3 未改变。

实现 `capturePostgresPlatformRecoverySnapshot` 与 `cloud-library-platform-snapshot.mjs`：

- 在已有 exported repeatable-read snapshot 内记录 public/auth 自定义表的列、RLS 标记和精确计数，并用 custom-format `pg_dump --data-only` 保存数据；不执行 schema、全局角色或 Storage 表数据恢复。
- 排除 `auth.schema_migrations`、`supabase_migrations` 记录和 `storage.objects`；单独保存迁移账本、私有共享桶配置和库/blob清单，物理对象继续由 Storage 写回工具负责。
- 捕获文件只允许新目录、私有权限、逐项 SHA/大小/快照 ID；Auth 数据属于敏感备份，凭据不写结果。不包含平台加密根密钥，结果明确要求单独保存平台密钥和 Auth/JWT/SMTP/API 配置。
- 受限 RLS 账号、公共/多余桶、过期租约、缺表、重复输出均拒绝，不能发布 `platform-capture.json`。sequence 数值不受数据库事务快照冻结，必须单独处理，不自动声称维护窗口已确认。

## 证据

`.lattice-build/turn-20261021/platform-snapshot-final.json`：8 项通过、0 失败、0 跳过；包括实际合成 Auth 用户/身份、Lattice 库/blob 数据、并发变更隔离、平台迁移和 Storage 行排除、RLS 账号拒绝、公共/额外桶拒绝、租约和输出冲突。指定 ESLint、全项目 `npm run typecheck` 通过。

独立复审发现序列标记过强，`platform-sequence-red.json` 已在原生测试复现；修复后 catalog、manifest 和结果均为 `unverified-nontransactional`，独立窄复审确认无新 P1/P2。原始缺实现失败 `platform-snapshot-red.json` 和候选记录保留，不冒充最终结果。

该测试使用新建临时 PostgreSQL 数据目录和 loopback 端口，不连接任何现有服务、Supabase 项目或真实凭据。官方规则明确数据库备份不包含 Storage 文件字节，平台 Auth/JWT、Storage 设置、Edge Functions 和扩展需要单独处理，因此本实现没有把平台数据导出冒充成完整生产恢复。

## 后续仍需开发

受保护恢复执行器的当前验证见[导入记录](2026-10-22-platform-restore.md)。后续需接物理 Storage 写回、API/Auth/SMTP 全链路合成演练。真实平台需要独立运维身份、平台加密根密钥/SMTP/API 配置、维护窗口和获准恢复项目。

[操作说明](../operations/cloud-platform-recovery.md) · [计划](../superpowers/plans/2026-10-22-platform-recovery.md) · [物理 Storage 恢复](2026-10-22-storage-recovery.md) · [数据库恢复](../operations/cloud-postgres-recovery.md)
