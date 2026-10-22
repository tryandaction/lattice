# 原生 PostgreSQL 快照与隔离恢复

这两个工具供云服务运营者使用，普通Lattice用户无需配置。当前实现捕获 `public/auth/storage/supabase_migrations` 四个schema，以及单独的全局角色工件；不是整个Supabase平台的自动迁移器。

## 获取数据库快照

```powershell
node "scripts/cloud-library-postgres-snapshot.mjs" "exports/new-database-point" "source-project-ref"
node "scripts/cloud-library-postgres-snapshot.mjs" "exports/new-database-point" "source-project-ref" --capture
```

第一条默认只检查参数，不读取凭据、文件或网络；第二条才使用显式运营进程环境：`LATTICE_BACKUP_PG_BIN/HOST/PORT/DATABASE/USER/PASSWORD/SSLMODE`。不要把密码放在命令行、聊天或计划文件中。

远端必须匹配 `db.<projectRef>.supabase.co`，或官方pooler域且用户名为 `postgres.<projectRef>`；数据库必须是 `postgres`，TLS为 `verify-full`，身份字段必须是合法字符串。仅 `synthetic-` 项目名允许本机loopback/disable，用于独立合成演练。工具不会使用libpq默认账号、默认库、个人pgpass或service配置。子进程只接收基础系统环境与显式连接，关闭密码交互和psql个人启动脚本。

工具保持一个read-only/repeatable-read事务，使用同一exported snapshot导出schema/data/迁移schema/data；完整Lattice库与blob清单从该事务读取，并设置 `row_security=off`，受RLS过滤的账号会失败，不能把受限空清单当作全项目成功。需要运营数据库身份具备dump和 `pg_control_system()`身份校验权限；不会通过应用的普通用户权限绕过RLS。

输出包含 `schema.sql/data.sql/history-schema.sql/history-data.sql/roles.sql/inventory.json/database-capture.json`。每份SQL和清单均有size/hash；清单保存逻辑快照ID。目标目录必须全新。完成记录只在所有数据库工件成功后发布，部分失败目录不得作为完整恢复点覆盖重试。

角色由 `pg_dumpall --roles-only --no-role-passwords` 单独导出。全局角色不支持这里的数据库共享快照，明确标记 `global-roles-maintenance-attested`，维护窗口和全局角色稳定性由运营者确认；不会保存角色密码。四schema数据库快照通过也不代表平台其他schema、Edge函数、JWT/SMTP/供应商配置或物理Storage字节已备份。

## 向独立空数据库恢复

```powershell
node "scripts/cloud-library-postgres-restore.mjs" "exports/database-point" "different-target-project-ref"
node "scripts/cloud-library-postgres-restore.mjs" "exports/database-point" "different-target-project-ref" --restore-empty-target
```

默认仍不读文件/凭据或写数据库。显式执行读取 `LATTICE_RESTORE_PG_BIN/HOST/PORT/DATABASE/USER/PASSWORD/SSLMODE`，规则同上。恢复只允许项目ref不同、`system_identifier + database`身份hash不同且没有用户对象的空目标。已初始化的托管Supabase项目具有平台schema，此通用工具会拒绝，不能删除平台schema以绕过保护。

恢复前将SQL复制到工具自己的私有暂存目录并逐字节hash，校验来源清单原始hash、projectRef及快照ID；只执行暂存的已校验文件。事务内再次检查身份和空状态，才移除空public schema并恢复结构/数据；`ON_ERROR_STOP=1`和单事务确保普通SQL错误回滚，末尾必须核对全部库ID和blob元数据一致才提交。缺对象即使SQL全部执行也回滚。

不执行全局roles.sql，所需应用角色由运营者预先准备。工具不恢复Storage物理文件，不调整生产公开连接，不声称托管兼容或生产恢复通过。网络/进程异常可能发生在提交结果已生效但回包丢失之后，须先检查独立目标；非空目标不会被清空重试。SQL来自可信运营者管理的导出，不能向目标执行不可信来源的SQL。

## 验收范围

本机真实PostgreSQL18临时集群、随机loopback端口、新data目录，仓库八份真实迁移和合成账号数据通过快照/恢复/RLS测试。中文昵称、批注、历史版本、PDF子链接和撤权语义均核对；源数据库并发变更保持在源，目标还原原快照。私有桶20MiB配置在数据库中核对，未宣称20MiB物理文件恢复。

来源依据：[PostgreSQL pg_dump一致导出及snapshot选项](https://www.postgresql.org/docs/current/app-pgdump.html)、[导出快照生命周期](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION)、[Supabase官方备份/恢复与平台schema处理](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)。

数据库工件还需要与仓库迁移/部署版本/公开配置和物理对象一起进入[离线恢复点组装](cloud-recovery-offline.md)及独立加密副本。后续已实现单独的[物理Storage写回工具](cloud-storage-recovery.md)和[已有平台结构的数据导出工具](../tests/2026-10-22-platform-recovery.md)，本地物理字节与平台数据导出有分层证据；托管平台数据导入、全链路编排和Auth/邮件最终验收仍未完成。
