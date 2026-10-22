# 已有平台结构的恢复准备

普通 Lattice 用户无需配置此流程。它供运营者将数据迁移到已初始化、业务数据为空的独立项目。数据导出和受保护导入已有实现；托管平台 API/Auth/SMTP 与完整生产恢复仍需单独验收。

## 导出

```powershell
node "scripts/cloud-library-platform-snapshot.mjs" "exports/new-platform-point" "source-project-ref"
node "scripts/cloud-library-platform-snapshot.mjs" "exports/new-platform-point" "source-project-ref" --capture
```

第一条默认只检查参数，不读文件、环境凭据或网络。显式 `--capture` 才使用 `LATTICE_BACKUP_PG_BIN/HOST/PORT/DATABASE/USER/PASSWORD/SSLMODE` 运营进程配置。连接规则沿用[原生数据库工具](cloud-postgres-recovery.md)：官方项目域或对应 pooler 身份、远端 verify-full，loopback 仅 synthetic 项目。禁止使用普通成员身份代替完整运营数据库身份。

输出为新的私有目录，包含：

- `platform-data.dump`：实际 PostgreSQL custom-format 数据归档，含 public/auth 的非扩展所属表及序列；不含 auth 平台迁移表、Storage 行、schema 创建或全局角色。
- `catalog.json`：来源表/序列所有者及有效授权、列授权、RLS/force RLS、策略、约束、触发器、独立索引及有效状态、public/auth 非扩展函数/过程的定义、执行授权与安全属性、精确行数和序列观测值。表数据/目录读取使用同一 exported snapshot；序列是非事务值，状态为 `unverified-nontransactional`，不能据此宣称已冻结或确认维护窗口。
- `migration-ledger.json`、`storage-config.json`、`inventory.json`：应用迁移账本、私有共享桶配置、全项目库及当前/历史 blob 清单。
- `platform-capture.json`：仅全部成功才发布，绑定每份工件的大小、SHA256 和快照 ID。

归档含 Auth 账号数据及可能的认证秘密，必须与其他敏感备份一起加密保管。结果不打印账号正文或凭据，不含平台加密根密钥。目录私有权限不等于已存在独立加密副本；密钥和副本仍需运营流程。

受限 RLS、过期租约、错误项目、已有输出、公共桶或额外应用桶均拒绝。本工具针对独立 Lattice 项目，不静默将其他应用的桶或扩展所属表当作已备份。失败目录不能复用或标成完整恢复点。

## 导入

```powershell
node "scripts/cloud-library-platform-restore.mjs" "exports/platform-point" "different-target-ref"
node "scripts/cloud-library-platform-restore.mjs" "exports/platform-point" "different-target-ref" --restore-platform-data
```

第一条只检查参数，不读文件或凭据。第二条才读取 `LATTICE_RESTORE_PG_BIN/HOST/PORT/DATABASE/USER/PASSWORD/SSLMODE` 的显式运营配置。目标必须先预装对应平台和正式仓库迁移，停止写入并保持独立维护窗口。这里只接受运营者可信且受保护的归档；hash 是完整性绑定，不是归档签名，也不能使恶意 SQL 成为可信数据。

导入器先把逐项大小/SHA/快照绑定校验的工件放入私有临时目录，再仅提取归档内声明的 public/auth TABLE DATA。事务中锁定表，核对实际数据库身份、完整结构及辅助函数定义、应用迁移账本、私有桶配置和空目标。仅允许仓库迁移预置的单行 `cloud_storage_limits=950000000`，该行在同一事务中替换为来源配置。其他已有业务数据一律拒绝。

归档中的 sequence SET 不执行；依据单独观测值使用事务性的 `ALTER SEQUENCE RESTART`。复制后验证所有表计数、完整库/blob清单及实际外键关联，失败时数据、预置配置和序列重启一并回滚。source序列仍不是事务快照，维护窗口及来源序列是否追上表数据需运营者单独核实。

不创建/删除平台 schema、角色、迁移账本或 Storage 行，不通过 DROP 绕过保护。默认不接受缺少新增结构/函数绑定的旧捕获，需重新导出。不能把另一份“空数据库恢复器”直接指向托管平台。

Storage 文件从[物理对象工具](cloud-storage-recovery.md)通过 API 写回，不能直接写 storage.objects 伪造文件存在。Auth/JWT、SMTP、API/Worker、扩展和加密根密钥需分开恢复并验收；数据导出成功不会自动使原会话、邮件或登录可用。本机已用固定版实际Auth/PostgREST与现有API处理器验证合成账号恢复后新登录、权限和刷新退出，见[真实服务专项](../tests/2026-10-22-real-auth-recovery.md)；本机SMTP替身和SQL文件描述不代替生产邮件或Storage字节恢复。

原生合成导出见 [导出记录](../tests/2026-10-22-platform-recovery.md)，导入与独立审查见 [导入记录](../tests/2026-10-22-platform-restore.md)。这些检查不包含任意扩展/其他 schema、全局角色、托管平台根密钥兼容性；生产/托管兼容标记仍为 false，未进行生产恢复。
