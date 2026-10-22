# 云库健康、备份和恢复操作

本页是可执行运维方案。2026-10-17 的备份/恢复演练在本地合成服务与 PGlite 执行，**未创建生产定时任务、未导出全项目生产备份、未执行生产恢复**。同日20MiB生产升级与临时账号验收另见[验收记录](../tests/2026-10-17-cloud-large-production-acceptance.md)。应用上传、健康探针及物理对象导出均使用当前成员 JWT 与公开 key，不接受 service-role。

## 健康与容量

应用 `202610170001_cloud_large_objects.sql` 并部署新 Worker/Edge 后，admin/owner 可访问 `GET /v1/libraries/{id}/health`。数据库验证真实成员身份，返回 schema 版本、桶是否私有、桶上限、active/expired 会话数与库/服务用量。普通 viewer、外部账号和匿名用户不能调用。它验证 API→JWT→Postgres 连接；不执行写入，也不替代合成对象上传验收。

运营者在运行进程内安全注入 `LATTICE_CLOUD_USER_JWT` 后执行；不得把 JWT 写入命令参数、仓库、任务描述或日志：

```powershell
node "scripts/cloud-library-health.mjs" "https://<project>.supabase.co/functions/v1/shared-library-api" "<library-uuid>"
```

探针只输出状态、问题代码、耗时、检查时间和请求 ID。退出码：`0=ok`、`1=warning`、`2=critical`。80% 开始 warning，90% 为 critical；分母使用应用库/服务额度，分子包括已占字节和预留字节。任何过期上传为 warning；迁移版本过旧、桶不私有、20 MiB 配置不一致或 HTTP/鉴权失败为 critical。用户 JWT 会过期，生产调度器必须通过授权登录流程刷新，不得存入长期用户 access token。

生产待办：运营者选择现有监控平台或操作系统任务计划，每 5 分钟运行，只在从 ok 转为 warning/critical、等级升高或恢复时通知负责人；连续两个网络失败后告警，保留请求 ID。**本代码未安装调度器、未接通知渠道**。Storage/Edge 出站、请求次数和收费预算仍须通过供应商 Dashboard 告警配置，应用容量不能证明费用受控。

清理 warning 时使用已有 `POST /v1/libraries/{id}/uploads/cleanup`，每次最多 25 条，直到 `cleaned=0`。此操作先 Storage API 删除，再确认 DB 状态，失败继续保留预留。它不是健康探针的一部分。升级前清理过期会话，因为升级后没有物理对象的旧会话也按 20 MiB 保守预留。

## 备份内容与验证

数据库备份只包含 Storage 元数据，不能恢复 Storage 物理字节。Supabase 官方建议 Free 项目定期 CLI 导出并离机保存；自动日备份与 PITR 的产品条件由运营者决定。依据：[Database Backups](https://supabase.com/docs/guides/platform/backups)、[CLI 备份恢复及对象迁移](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)。

一个恢复点必须同时保存：数据库 roles/schema/data、迁移账本、仓库迁移与 Worker/Edge 版本、每个库的物理对象 manifest/bytes、公开配置以及独立受控的 Auth/SMTP/供应商恢复信息。正式备份进入维护窗口，暂停客户端写入，避免数据库和分页对象清单在不同时间变化。不得把 backup 或生产内容加入 Git。

数据库由已授权项目运营者使用已经安装的 Supabase CLI 执行，`--linked` 使用已核验项目并交互取得凭据；下列命令不由应用执行：

```powershell
supabase db dump --linked --role-only --file "<new-backup-directory>/roles.sql"
supabase db dump --linked --file "<new-backup-directory>/schema.sql"
supabase db dump --linked --data-only --use-copy --file "<new-backup-directory>/data.sql"
supabase db dump --linked --schema supabase_migrations --file "<new-backup-directory>/history-schema.sql"
supabase db dump --linked --schema supabase_migrations --data-only --use-copy --file "<new-backup-directory>/history-data.sql"
```

按官方当前 CLI 版本核验托管 schema 的自定义策略是否包含在 dump 中；`storage.objects` 的 Lattice RLS 需要从仓库迁移恢复，不能假定普通 schema dump 已包含。源项目的 `auth` 与 `storage` 平台对象不能把本地合成 schema 直接套用。

已在目标库有读取权限的运营者，在进程环境注入 `LATTICE_SUPABASE_URL`、`LATTICE_SUPABASE_PUBLIC_KEY`、`LATTICE_CLOUD_USER_JWT` 后执行对象导出。输出目录必须不存在，脚本会拒绝覆盖已有备份：

```powershell
node "scripts/cloud-library-object-backup.mjs" export "<new-library-backup-directory>" "<library-uuid>"
node "scripts/cloud-library-object-backup.mjs" verify "<new-library-backup-directory>"
```

导出通过用户 RLS 分页读取该库全部已提交 blob（包含历史版本），逐个从 private Storage 下载，核对精确 size/SHA-256 后才写 `complete=true` manifest。文件以 SHA 命名避免路径穿越；失败的目录没有完整 manifest，不能列为成功备份。`verify` 只读取本地备份，不需要任何凭据，可用于离机复制后校验。未提交上传、其他库、其他项目 bucket 和 R2 对象不属于此导出；源 DB 全量库/blob 数量必须与备份覆盖表逐项核对，缺少成员权限可能导致空清单，不能把它当全项目备份。

运营者初始目标：每日一次独立加密离机副本、保留最近 7 日与 4 周、每月在独立测试项目恢复演练；接受 24 小时 RPO 与实际测得的 RTO 后才对用户承诺。保留期、备份位置、密钥管理和账号/套餐尚需运营者落实。本轮未作可用性或灾备承诺。

## 本地合成恢复演练

```powershell
node "workers/shared-library-api/test-support/supabase-storage-rls.mjs"
npx vitest run "src/lib/shared-library/__tests__/cloud-large-object.test.ts" "workers/shared-library-api/src/cloud-operations.test.ts" --maxWorkers=1
```

第一条使用已存在的 PGlite 运行时执行全部八份迁移、20 MiB 元数据/额度与 RLS 回归；之后把合成 DB archive、16 字节物理对象及 manifest 分开保存到 `.lattice-build/cloud-restore-drill-20261017/`，从 archive 创建全新数据库并加载备份对象，验证 hash、长度、授权管理员可读、外部用户拒读。它验证“数据库与字节必须同时恢复”，不代表托管 Supabase 版本或 20 MiB 云端恢复已验收。

第二条验证真实本地 HTTP、PostgreSQL 用户 RLS 与 20 MiB 不可变对象重试，并验证导出对象损坏能被发现。所有输入为合成字节，生产请求数为零。

## 生产恢复演练清单

仅在运营者授权的**独立恢复项目**进行；不得把演练命令指向生产库。先核对源/目标 project ref、维护窗口及恢复点，并保存当时生产状态以便回退。

1. 创建空测试项目，按官方恢复文档导入 roles/schema/data/迁移历史，恢复自定义 Storage RLS 和 bucket private/20 MiB 设置；使用单事务及 `ON_ERROR_STOP=1`。数据库身份由项目运营者掌握，产品端不接收数据库凭据。
2. 从已校验的物理对象备份经供应商支持的 Storage API/迁移工具恢复原 key；仅导入 `storage.objects` SQL 不能恢复物理字节。正常 Lattice 用户不能覆盖已提交对象，这条权限边界不可为演练放宽。全项目物理恢复仍须运营者按供应商恢复流程单独执行，本仓库没有授予用户覆盖权限的后门。
3. 重新部署同一版本 Worker/Edge，`verify_jwt=true`，公开配置指向恢复项目；Auth/邮件设置由运营者单独恢复。重跑 health、两个合成账号私有读/写/撤销、20 MiB 上传/下载 SHA、历史版本引用、配额、过期物理清理。
4. 对备份 manifest 中每个对象比较恢复后的 size/SHA-256、DB 引用计数、库/用户数，逐项记录；发现缺失字节则演练失败。测量实际 RTO，保存请求 ID、迁移 hash 和不含密钥/正文的结果。
5. 只有完整演练通过且运营者批准切换，才更新生产公开连接。源项目和上一份备份保留到回滚窗口结束。

目前已完成的是本地合成演练与可执行检查/导出工具；生产备份覆盖、物理恢复工具执行、定时监控、通知渠道及收费告警仍为独立待办。当前生产 QQ SMTP 已配置且用户实际收到过邮件，不重复列为“未配置”；独立恢复项目的 Auth/SMTP 恢复和投递验证仍需随恢复演练执行。责任与收尾条件见 [安全完善收尾清单](../superpowers/plans/2026-10-19-safe-closeout.md)。
