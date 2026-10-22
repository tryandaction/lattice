# 数据库恢复层开发与原生验收

## 已实现

- 共享PostgreSQL导出快照：schema/data与迁移账本使用同一数据库事务快照，库/blob清单同事务读取。对四个schema明确范围，角色另记维护窗口声明。
- Windows psql CRLF/UTF8会话读取、固定子进程参数和基础系统环境；严格连接字符串字段，阻止缺账号/库时libpq回退。默认CLI不读取环境凭据或联网。
- 独立空数据库恢复：项目ref和数据库system/database身份双重拒同源，事务内再次核验。SQL及清单hash/快照绑定，复制到私有暂存后执行；事务末核对所有库ID和对象元数据，缺失/不一致即回滚。没有清空已有目标或覆盖生产库的路径。
- 临时集群仅限测试新data目录和loopback随机端口；初始化尚未返回fixture就失败时，也只停止自己的集群并实际验证端口释放。

## 实际证据

`.lattice-build/turn-20261021/postgres-native-final-candidate.json`：2个测试文件、15项通过、0失败、0跳过。原生PostgreSQL18，非数据库mock或PGlite替身。严格TS和指定ESLint通过。

- 快照开启后另连接改库名/插入新库，SQL和独立清单保留原快照。
- 同ref、同数据库身份、已有目标拒绝；中途SQL错误整体回滚，缺失blob即使SQL执行成功也在提交前回滚。
- 替换独立清单在恢复前拒绝；受RLS限制的账号不能导出虚假空项目。
- 执行仓库八份真实迁移，捕获后到不同空库恢复；验证中文昵称/批注、历史版本/子链接、私有桶20MiB配置、成员可读/外部人拒读以及撤权。源成员权限仍保持原状态。
- 独立复审确认当前无P1/P2，独立纯连接3项通过。复审发现的非字符串连接默认回退、fixture异常时集群泄漏及主线清单绑定/末尾核验缺口均已按先失败后通过修复。

失败证据保留：`postgres-snapshot-red.json`（缺实现）、`postgres-snapshot-green-initial.json`（Windows会话帧超时）、`postgres-native-full-green-initial.json`（测试输入UTF8）、`postgres-inventory-rollback-red.json`（两类清单缺口）、`postgres-explicit-connection-red.json`（连接类型）、`postgres-fixture-cleanup-red.json`（资源清理）。不以文件名中的green字样代替读取实际结果。

## 仍未完成

角色自动恢复、托管Supabase平台兼容、独立项目Worker/API/Auth/SMTP完整恢复演练及真实生产运行尚未完成。物理Storage后续已有单独实现和本地实际字节验收，见 [Storage专项](2026-10-22-storage-recovery.md)，并非本次PG测试已覆盖。当前SQL工具拒绝已有平台schema的目标，不通过删除平台对象绕过。遇到网络或进程异常须核对目标是否已提交，不能认为所有失败都代表零写入。

本轮没有连接生产、读取用户论文/真实云凭据、调用模型、发送通知、改变系统PATH或安装依赖。仅运营脚本和测试/说明改动，已交付3.1.3客户端/网页不变，不沿用其门禁冒充本轮生产验收。

[操作说明](../operations/cloud-postgres-recovery.md) · [历史覆盖台账](../superpowers/plans/2026-10-20-requirement-coverage.md)
