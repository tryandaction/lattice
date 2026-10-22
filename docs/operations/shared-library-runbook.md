# 共享研究库运维手册（Runbook）

> 运维动作面向部署/维护人员。所有破坏性操作**先备份、先 dry-run、经确认后执行**。

## 0. 自动冒烟与契约

```powershell
# 独立 CLI（无 TS loader、无真实云资源）
node scripts/shared-library-smoke.mjs            # 退出码 0 = 全绿
node scripts/shared-library-smoke.mjs --json     # 结构化 JSON（operationId/status/reason）

# Vitest 契约测试（双用户双设备全生命周期）
npm run test:run -- src/lib/shared-library/__tests__/shared-library-e2e-contract.test.ts
```

## 1. 数据迁移

- **本地 Item 工作区**：移动/重命名 PDF 会改变派生 itemId；源码已通过内容指纹跟随
  与 `move/copyPdfItemWorkspace` 保留子文件与批注。
- **既有孤儿/重复 item 一次性对账**（迁移脚本，默认 dry-run）：

  ```powershell
  # 1) 备份
  Copy-Item -Recurse -Force "<workspace>\.lattice" "<workspace>\.lattice.backup-<date>"
  # 2) dry-run 计划
  node scripts/reconcile-pdf-items.mjs --workspace "<workspace>"
  # 3) 确认后执行（合并子文件不覆盖，删除被吸收目录，更新 survivor manifest）
  node scripts/reconcile-pdf-items.mjs --workspace "<workspace>" --apply
  ```

  `--apply` 只处理"同指纹、一活一死/重复"的 item；"死无活兄弟"与无 manifest 的孤儿
  目录只报告、不自动改动，需人工判断。

## 2. 备份与恢复

- 备份对象：`<workspace>/.lattice/`（items manifest、annotations、locations）。
- 恢复：整目录回滚后重启应用；同步队列会自动从持久化快照恢复。

## 3. 队列积压

- 现象：`status` 长时间 `syncing / failed`，pending 操作增长。
- 排查：
  1. 网络是否恢复（`isOnline`）；
  2. 引擎退避 `nextRetryAt` 是否不断后移；
  3. 是否存在永久性拒绝（conflicted）导致队列被污染。
- 处理：修正根因后重启后台 worker（`startBackgroundSync`）；**不要手工删除 pending
  操作**——网络故障绝不丢操作。

## 4. R2 / 对象存储失败

- 分片上传具备 `Idempotency-Key` 语义：`completeUpload` 幂等且校验内容哈希。
- 失败类别：`UPLOAD_EXPIRED`（过期需重新发起）、`UPLOAD_INCOMPLETE`（分片不齐）、
  `UPLOAD_HASH_MISMATCH`（哈希不符，禁止重放不同内容）。
- 处理：按错误码重发对应分片或重新创建上传会话；保留 `blobId` 与版本关系。

## 5. 索引任务失败

- 抽取/快照/缩略图任务幂等（确定性 job id 去重），失败记录
  `reason / attempts / nextRetryAt`，耗尽后进入 `failed` 终态，可从 UI 读取。
- 处理：修正数据后重新入队同一 job id 或提高 `maxAttempts`。

## 6. 签名 URL 泄漏响应

- 泄漏到公共渠道：立即撤销对应 blob 的访问路径并重发带更短 `expiresAt` 的签名 URL；
  检查对象存储 ACL 与 RLS 策略。

## 7. 账号撤销

- 撤销成员访问后：RLS 立即拒绝其 API / 对象 URL / 缓存 / 搜索读取；
- 需同步撤销其签名 URL 与缓存条目；
- 如需数据保留，先导出再撤销，避免数据不可恢复。
