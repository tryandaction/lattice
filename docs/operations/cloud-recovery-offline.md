# 云库离线恢复点与副本验收

本流程用于运营者已取得的本地导出。普通共享库用户无需填写这些配置。它不代替数据库一致快照导出、独立云项目还原或生产通知渠道。

四个Lattice相关schema的一致数据库导出与独立空库恢复已有 [原生PostgreSQL工具](cloud-postgres-recovery.md)；其快照ID及工件hash可用于下方组装。该工具不覆盖托管Supabase平台预建schema，Storage物理文件与平台Auth/SMTP恢复仍分开处理。

经过v2清单绑定的物理对象已有[单独写回工具](cloud-storage-recovery.md)：只创建缺失对象、逐项实际回读hash、支持中断重跑，不删除或覆盖。其本地HTTP验收不等于生产独立项目API/Auth/SMTP恢复完成。

## 组装

准备8类工件：`roles`、`schema`、`data`、`history-schema`、`history-data`、`repository-migrations`、`deployment-version`、`public-config`。每类是已有本地导出，角色/数据库导出可能敏感，应在受控加密介质中处理。来源清单必须从具有全项目可见性的数据库导出生成；不能用普通成员受RLS过滤的库列表代替。

计划文件结构：

```json
{
  "version": 1,
  "projectRef": "operator-project",
  "snapshotId": "operator-maintenance-point",
  "sourceInventory": { "path": "inventory.json", "sizeBytes": 123, "sha256": "实际文件的64位SHA256" },
  "artifacts": [
    { "kind": "roles", "path": "roles.sql", "sizeBytes": 123, "sha256": "实际文件的64位SHA256", "snapshotId": "operator-maintenance-point" }
  ],
  "libraries": [
    { "libraryId": "library-id", "path": "exports/library-id", "manifestSha256": "manifest.json的实际SHA256", "snapshotId": "operator-maintenance-point" }
  ]
}
```

示例展示单项结构；实际计划必须提供全部8种工件，及来源清单中的每个库。来源清单字段为 `version=1`、`scope=full-project`、`projectRef`、同一 `snapshotId`、`libraryIds`、`objects`。objects包括当前和历史的全部blob记录，每条包含 `libraryId/id/storage_key/storage_backend/size_bytes/sha256`；库导出沿用现有 `cloud-library-object-backup.mjs` 的manifest/objects目录，空库也要有完整空清单和objects目录。

```powershell
node "scripts/cloud-library-recovery-assemble.mjs" "exports/assembly-plan.json" "recovery/new-point"
node "scripts/cloud-library-recovery-assemble.mjs" "exports/assembly-plan.json" "recovery/new-point" --assemble
```

第一条只预检；第二条输出目录必须不存在且与输入树分开。读取期间源变化、大小/hash错误、缺库/历史blob、快照不一致或输出冲突均失败。部分文件可能留在失败目录，但只有完整校验成功才排他发布 `recovery-point.json`，不要在失败目录中覆盖重试。

新恢复点v2绑定来源清单原始字节hash，任何替换均拒绝。`snapshotConsistency=operator-attested`表示维护窗口和导出快照由运营者声明，脚本不伪造数据库全局一致性。旧v1可以离线检查，但明确未绑定，不接受为新版副本交付回执。

## 加密与副本

沿用 `cloud-library-recovery-archive.mjs seal|open`，密钥仅通过受控进程的 `LATTICE_RECOVERY_KEY_BASE64` 提供，不放命令行或备份包。将加密归档通过获准流程保存到独立位置后，核对实际复制的文件：

```powershell
node "scripts/cloud-library-recovery-retention.mjs" verify-copy "source/point.lattice-backup" "independent/point.lattice-backup" "归档实际SHA256" "verify/new-restore"
node "scripts/cloud-library-recovery-retention.mjs" verify-copy "source/point.lattice-backup" "independent/point.lattice-backup" "归档实际SHA256" "verify/new-restore" --verify
```

默认不读归档/密钥。显式验证核对源与副本双hash、拒绝相同文件/硬链接，再从副本实际解密恢复至新目录。成功返回带原归档SHA、项目/快照和验证时间的回执；不会输出密钥或原路径。归档完整性和离线还原通过仍不证明物理独立存储、生产Auth/RLS配置或恢复项目已验收。

## 保留规划

本地catalog格式：`version=1`、`keepDays`、`minimumSnapshots`、`entries`。每个entry包含唯一 `id`、`archivePath`（相对catalog目录或绝对路径）、真实记录的ISO毫秒 `createdAt`、`protected` 布尔值，以及刚才实际验证取得的 `receipt`。不要手工编造交付回执。运营者负责日期/回执来源与保存。

```powershell
node "scripts/cloud-library-recovery-retention.mjs" plan-retention "independent/catalog.json"
```

命令重哈希所有文件，损坏/缺失/未验证回执则整体失败。每项目至少保留2个不同快照（默认3）、30天内快照和受保护快照；重复副本不增加独立快照数量。只返回候选ID，始终不删除文件。实际删除前需按运营授权重新核对归档、目录、独立副本和恢复条件；当前没有自动删除功能。
