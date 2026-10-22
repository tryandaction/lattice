# 原生 PostgreSQL 恢复编排

目标：继续补齐云恢复的数据库获取/还原层，使用原生PostgreSQL共享导出快照、同快照项目清单及受保护的独立目标；保持已有离线组装/加密/副本工具。

设计：先提供只预检的命令，显式capture才取得操作者传入的连接配置并保持一个repeatable-read事务；schema/data/迁移账本共享同一个exported snapshot，库/blob清单在该事务读取且拒绝RLS过滤。角色是全局对象单独导出，不将其伪称为事务快照内一致。只向新本地目录写出工件、hash和捕获记录。原生本机集群用全合成数据并发修改验证快照隔离，随后在不同空库实际恢复结构/数据并验证RLS/用户/历史对象。

约束：不读取真实云凭据/论文、连接生产或发送通知；不改系统PATH、不安装依赖、不提交Git。已安装3.1.3客户端不变。托管Supabase平台schema/SMTP/JWT密钥和物理Storage恢复必须按官方支持的方式另行验证，通用PostgreSQL演练不冒充生产验收。

- [x] 原生临时集群测试支持：显式现有PG18工具、仅127.0.0.1、全新data目录和随机端口，结束只停本测试集群。初始化失败后实际验证端口释放，避免fixture尚未返回时泄漏。
- [x] TDD：默认预检不读环境/联网/写文件；共享快照时并发写入不污染清单/SQL，缺schema/RLS过滤/工具失败无成功标记，已有输出不覆盖。
- [x] 实现持久psql快照会话、UTF8/Windows CRLF处理、限定子进程环境/超时、固定dump参数、脱敏错误和工件hash。database/user/projectRef严格检查字符串，拒绝libpq默认账号/库回退。
- [x] 实现不同数据库身份与空目标保护；恢复前复制并校验SQL与来源清单，事务内再次核对身份/空状态，并在事务结束前逐项核对库/blob元数据；SQL错误和清单不一致实际回滚。
- [x] 原生PostgreSQL18实际执行仓库八份迁移后捕获/恢复，中文昵称/批注、历史版本、子链接、私有桶20MiB配置及RLS撤权验证通过。20MiB仅为本测试元数据，不冒充20MiB物理字节恢复。
- [x] 15项候选（原生12+纯连接3）无跳过通过；严格TS/lint通过，独立复审和纯连接测试通过。证据 `.lattice-build/turn-20261021/postgres-native-final-candidate.json`。客户端3.1.3不变。

仍未完成：角色及平台配置自动恢复、生产托管Supabase兼容、物理Storage写回与独立项目API/Auth/邮件端到端验收；本实现不能覆盖或清空已有平台项目。进程超时或提交回包丢失时须检查独立目标实际状态，不承诺所有网络错误都代表零写入，禁止盲目原地重试。

官方依据：[PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)、[Snapshot Synchronization](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION)、[Supabase CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)。
