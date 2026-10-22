# 云库物理对象恢复

此工具供云服务运营者使用，普通 Lattice 用户无需配置。它将已校验恢复点中的物理文件写回独立项目的私有 Storage；不修改数据库、创建或公开桶，也不覆盖或删除文件。

## 执行条件

先完成目标数据库恢复，并在维护窗口内暂停目标写入。目标项目必须不同于来源项目，且完整库 ID、当前及历史 blob 的键、大小、SHA256、MIME 类型必须与来源清单一致。目标桶 `lattice-shared-library` 必须为私有，文件大小上限至少 20 MiB。来源必须是绑定完整来源清单原始 hash 和快照 ID 的 v2 恢复点；旧 v1 恢复点不接受为写回来源。

```powershell
node "scripts/cloud-library-storage-restore.mjs" "recovery/point" "exports/inventory.json" "different-target-project-ref"
node "scripts/cloud-library-storage-restore.mjs" "recovery/point" "exports/inventory.json" "different-target-project-ref" --restore-objects
```

第一条仅检查参数，不读取环境凭据、文件或网络。第二条才读取操作者显式进程环境：`LATTICE_RESTORE_SUPABASE_URL`、`LATTICE_RESTORE_SUPABASE_PUBLIC_KEY`、`LATTICE_RESTORE_STORAGE_TOKEN`。凭据应由受控进程注入，不放命令行、聊天或计划文件。该身份须能读取完整元数据和私有对象并创建缺失对象；受限成员账号不能代替全项目恢复身份。

远端仅接受与目标项目 ref 精确匹配的官方 HTTPS 项目域，不接受自定义转发地址、重定向或 URL 内凭据。仅 `synthetic-` 项目允许本机 loopback，供合成测试使用。请求有超时和取消信号，元数据响应有大小上限，上游错误正文不回显到结果中。

## 写入和重跑

每个本地对象先核对实际文件大小，再流式核对 SHA256。声明大小和实际大小不一致、超过 20 MiB、符号链接或损坏恢复工件均在写入前拒绝。上传前再次有界读取并核对字节，避免文件在预检后改变。

已有远端对象必须实际下载并核对大小和 SHA256，匹配后跳过上传；不同字节立即停止。缺失对象使用固定 `x-upsert=false` 的 POST 创建。上传回包不代表恢复成功，必须重新下载实际持久化的字节并核验；因此即便成功回包丢失，也只有回读一致才继续。

数据库和 Storage 没有跨服务原子事务。取消、权限错误或最后元数据复核失败时，可能留下已上传的正确对象；工具不删除这些对象。重新运行会重新读取目标状态，核验并跳过已有正确对象，不依赖旧进度缓存。执行开始和结束均核对目标桶与元数据；任何缺失或变化均不能报告成功。

成功结果 `restored-objects` 仅表示本次物理字节及目标元数据通过。`uploaded` 表示本次观察到缺失、尝试创建后回读一致的数量，不证明并发时由本进程独占创建。`productionRestoreVerified` 始终为 false；Auth、API、邮件及托管平台兼容仍需独立验收。

## 验收证据

真实本机 HTTP 与磁盘对象库的 15 项合成测试通过，包括实际 20 MiB、历史对象、PDF 子文件、空文件、分页、二次运行、丢回包、取消后重跑、权限拒绝、错误 MIME、损坏文件和重定向防凭据外泄。不是 Supabase 托管服务或生产演练。见 [专项结果](../tests/2026-10-22-storage-recovery.md)。

关联：[数据库恢复](cloud-postgres-recovery.md)、[离线恢复点与副本](cloud-recovery-offline.md)。官方协议依据：[标准上传](https://supabase.com/docs/guides/storage/uploads/standard-uploads)、[Storage 错误码](https://supabase.com/docs/guides/storage/debugging/error-codes)。
