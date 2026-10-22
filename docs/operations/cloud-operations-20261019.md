# 2026-10-19 云运维本地收尾记录

本轮只使用回环 HTTP 服务与 `.lattice-build/` 下的合成文件。没有访问生产、读取凭据文件、调用模型、发送通知、安装系统任务、上传私人备份或执行 Git 操作。已通过的生产 28 项验收没有重跑。

## 状态和实际修复

| 范围 | 本地结果 | 生产状态 |
| --- | --- | --- |
| C1 健康监控 | completed：探针失败结果、单次 runner、持久事件和去重验证 | pending：运行主机、登录刷新身份、通知适配、供应商费用告警、受控过期清理 |
| C2 备份 | completed：对象清单与字节完整性、恢复点本地工件及来源覆盖核对 | pending：真实全项目导出、其他 bucket/R2 覆盖、独立加密位置、密钥和保留期 |
| C3 恢复 | completed：离线读取恢复点并拒绝缺件/越界/损坏 | pending：独立恢复项目、真实导入、Auth/SMTP/RLS/权限及 20 MiB 验收、实际 RTO |

健康探针旧实现忽略调用者取消，网络/超时直接抛错，HTTP 失败没有检查时间；失效上传计数为负或缺失会显示正常，非布尔的私有桶字段也能通过。现对所有请求结果返回时间、耗时和安全的请求 ID；超时、取消、网络、鉴权和坏响应分别编码。超时涵盖响应正文读取，失败响应主动取消正文。请求 ID 若包含当前凭据则不输出；不记录原始上游错误或响应正文。

对象备份旧实现允许重复 blob 记录抬高覆盖数，Storage key 中的 `..` 也能通过前缀检查；本地校验会跟随 `objects` 符号链接读取根目录以外的文件。现拒绝重复 id/key、不安全 key 和符号链接；内容以 SHA 命名并排他创建。只有全部对象 size/SHA 校验、写入完成后才生成 `complete=true`。v2 manifest 明确 `member-visible-library-objects` 作用域、对象数量和总逻辑字节；继续校验旧 v1 备份，但旧备份没有 v2 汇总字段。导出失败可留下部分字节，不会留下完整 manifest，不能把该目录当成功备份。

## C1 单次 runner 的接入边界

默认准备命令不读取凭据、不请求网络、不读写状态，只校验参数并输出建议的 5 分钟间隔：

```powershell
node "scripts/cloud-library-operations-runner.mjs" "<operator-state-directory>/library-health.json" "https://<api-base>" "<library-id>"
```

运营环境落实后，现有调度平台可显式追加 `--run` 执行一次检查。JWT 只能通过运行进程环境 `LATTICE_CLOUD_USER_JWT` 注入；每次运行读取当次身份，脚本不存 token、不自动刷新身份、不请求 service-role。运营者应使用已授权登录刷新流程，不能把长期 access token 写进任务参数或任务描述。状态目录应位于受控可写位置；本轮没有创建生产运行目录或任务。

runner 的实际规则：

- 第一次网络/超时失败只增加连续计数；第二次才写 critical 事件。它不会把一次失败当作已有故障的恢复。
- 401/403 或未提供运行身份立即写鉴权事件；不重试登录，也不降低权限边界。
- warning、严重程度变化和恢复各生成一次事件；重复同一状态不追加。取消不落检查状态、不增加网络失败计数。
- 使用排他锁避免并行检查，状态写临时文件后原子替换；错误状态或不同目标的状态文件直接拒绝。事件序号回退、重复或超出已保存序号同样拒绝。
- `pendingEvents` 是未投递的本地事件，具有稳定 id。没有通知已送达的含义。接入渠道后需要幂等投递及确认流程，不能仅凭进程退出码声称通知演练完成。

锁内记录进程 id、开始时间和目标摘要。进程强制中断可能留下 `.lock`；运维者确认对应检查进程已结束后再处理锁，脚本不会擅自抢占或自动删除未知运行锁。状态写入错误不会确认本次事件已持久化；下次应修复存储故障后重跑。

该 runner 不执行上传清理。过期清理仍按原操作文档，授权后调用既有 cleanup API、每次最多 25 条直至 `cleaned=0`；失败保留预留。不能根据本地事件直接删除 Storage 或已提交历史对象。流量、请求次数和费用需在供应商平台独立监测，本地容量比不能替代费用告警。

## C2/C3 本地恢复点核对

校验命令只读取本地文件，不建立云连接，也不导入或覆盖目标数据：

```powershell
node "scripts/cloud-library-recovery-verify.mjs" "<recovery-root>" "<independent-source-inventory.json>"
```

`recovery-root/recovery-point.json` 格式如下。hash 和长度必须来自保存的实际文件，示例占位值不能通过校验：

```json
{
  "version": 1,
  "scope": "project-recovery-point",
  "projectRef": "source-project-ref",
  "artifacts": [
    { "kind": "roles", "path": "roles.sql", "sizeBytes": 123, "sha256": "<64 lowercase hex>" }
  ],
  "libraries": [
    { "libraryId": "library-uuid", "path": "libraries/library-uuid", "manifestSha256": "<64 lowercase hex>" }
  ]
}
```

`artifacts` 必须分别包含 `roles`、`schema`、`data`、`history-schema`、`history-data`、`repository-migrations`、`deployment-version`、`public-config` 八类。kind 与路径不能重复；每个文件的长度及 SHA 必须吻合。这里检查的是工件是否存在且字节一致，不解析 SQL，也不能证明托管 auth/storage schema、自定义 RLS 或供应商配置已完整导出。私有 Auth/SMTP/供应商恢复信息由运营者按原恢复方案独立保护；`public-config` 不能装入密钥。

独立来源清单由授权全项目数据库清单生成，应在维护窗口与备份同一恢复点采集，不能用某个成员 JWT 返回的可见 blob 清单代替：

```json
{
  "version": 1,
  "projectRef": "source-project-ref",
  "libraryIds": ["library-uuid"],
  "objects": [
    {
      "libraryId": "library-uuid",
      "id": "blob-uuid",
      "storage_key": "libraries/library-uuid/blobs/object-uuid",
      "storage_backend": "supabase",
      "size_bytes": 123,
      "sha256": "<64 lowercase hex>"
    }
  ]
}
```

清单要列出所有库，包括空库，以及所有需要恢复的已提交 blob，包括历史版本。校验器比较库集合、blob id、key、后端、长度和 SHA，并验证每份库 manifest 及所有物理字节；少一个库或历史对象就失败。恢复点内路径只允许相对路径，拒绝绝对路径、`.`/`..`、Windows 反斜杠和任一层符号链接，不写入任何恢复目标。

返回的 `scope=local-recovery-package` 和 `productionRestoreVerified=false` 是固定能力边界。来源清单本身是否拥有全项目视野仍需运营者核验；其他 bucket、R2、账号恢复信息、加密副本及实际恢复不由该校验器证明。不能把一次本地 `passed` 标记成 C2/C3 生产完成。

## 本地证据和后续前置

2026-10-19 定向验证：

```powershell
npx vitest run "workers/shared-library-api/src/cloud-operations.test.ts" "workers/shared-library-api/src/cloud-operations-runner.test.ts" "workers/shared-library-api/src/cloud-recovery-verify.test.ts" --maxWorkers=1
```

结果：3 个文件、25 项通过。首批 7 项在旧实现下失败，修复后通过；追加的请求 ID 凭据反射和事件序号回退各先失败再通过。新 runner 与恢复点校验先记录缺失实现，再用真实回环 HTTP、临时状态文件和合成恢复点验证。覆盖通知去重、连续失败、鉴权、取消、并发、部分导出失败、符号链接、遗漏库/历史 blob、迁移账本缺件、数据库字节损坏与越界路径。没有重新运行全量 gate、Next/Tauri 构建或生产验收。

进入生产仍需运营者落实：现有运行位置与维护身份、登录刷新方式、通知接收渠道及投递确认；供应商用量/费用告警；维护窗口与具备全项目可见性的导出身份；独立加密备份位置/密钥/保留期；独立恢复项目及允许的恢复窗口。上述信息缺失时保持 pending，不安装任务、不发送测试通知、不创建收费服务、不触碰生产数据。

完整操作依据见 [云库健康、备份和恢复操作](cloud-library-operations.md)，责任与总体验收见 [安全完善收尾清单](../superpowers/plans/2026-10-19-safe-closeout.md)。
