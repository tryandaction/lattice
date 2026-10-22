# 物理Storage恢复实施

目标：补齐经过校验的v2恢复点向独立项目私有桶写回物理对象、哈希回读及中断重跑；保持用户客户端3.1.3和普通成员权限不变。

设计：默认CLI仅准备参数，不读环境/文件/网络。显式执行才验证源恢复点、目标项目URL/身份、已还原库/blob元数据全集和私有桶配置；POST上传固定 `x-upsert=false`，从不DELETE/PATCH/PUT覆盖。缺失对象才上传，已有对象只有size/SHA匹配才接受；每次上传不论回包成功与否，均需实际GET回读验证。结束再次核对目标元数据，任何失败不返回成功。重新运行逐项重验远端现有字节，不信任本地进度缓存。

约束：仅官方HTTPS项目域；loopback仅允许synthetic项目测试。凭据只由操作者显式进程环境传入，输出不含URL、token、正文或文件名。执行器支持历史blob/空库，不扩大普通用户写Storage权限，不自动创建/公开桶，不部署或操作生产。数据库与物理Storage没有跨服务原子事务，需维护窗口；失败保留已写且一致的对象，不做删除回滚。

- [x] TDD真实本机HTTP+磁盘fixture：20MiB/历史/子文件字节恢复、分页元数据完整覆盖、丢回包后哈希确认、二次运行无重复上传、已有冲突不覆盖、错误桶/元数据/源清单拒绝。
- [x] 实现 `scripts/cloud-library-storage-restore.mjs`：严格目标匹配、界定请求/响应大小与超时、手动重定向、不泄露上游错误，实际字节hash校验。
- [x] 故障边界：损坏上传响应、401、重定向、缺失对象/RLS清单、上传后元数据变化和中断重跑；任何失败不得返回complete。追加实际文件越界/MIME错配先红后绿，空文件及持久化后取消重跑。
- [x] 相关测试/严格类型/lint/文档和独立复审；维护生产平台/角色/Auth/邮件仍未验收的边界，不以合成协议证明托管服务已运行。

15项物理恢复、最终6文件共59项、独立复审、全项目类型检查、指定ESLint及201份文档检查通过；截图对应AI目录/引用30项重新通过。详见 [专项结果](../../tests/2026-10-22-storage-recovery.md)。

官方依据：[标准上传与禁止覆盖](https://supabase.com/docs/guides/storage/uploads/standard-uploads)、[Storage错误码](https://supabase.com/docs/guides/storage/debugging/error-codes)。
