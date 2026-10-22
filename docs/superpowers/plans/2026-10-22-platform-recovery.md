# 托管平台恢复开发计划

目标：支持已有 Supabase 平台结构的独立恢复项目，保留应用数据、账号、批注、子文件及权限；不删除平台 schema，不把 Storage SQL 元数据当作物理文件。现有空数据库恢复和3.1.3客户端保持有效。

## 已完成：一致导出与复审

- [x] 基于现有 exported snapshot 和租约，单独导出 public/auth 数据的原生 custom archive；排除平台迁移表及全部 Storage 数据，不执行 schema 或全局角色 SQL。
- [x] 同事务记录表列、精确计数、应用迁移账本、私有桶配置及完整库/blob清单；全部工件绑定快照/大小/SHA，失败不得发布完成标记。sequence另记非事务、未核验，不能自动声称维护窗口已确认。
- [x] 默认 CLI 不读文件/凭据/网络；实际捕获仅显式运营进程连接。备份含 Auth 敏感数据，输出文件私有权限，不打印账号/正文/密钥。
- [x] 原生合成 PostgreSQL 验证并发快照、实际 custom archive、平台数据排除、RLS过滤拒绝、租约失效和输出冲突。

导出阶段2文件8项通过、0失败、0跳过；独立复审P2序列标记先红后绿，三个输出均改为非事务且未经确认，独立窄复审通过。证据：`.lattice-build/turn-20261021/platform-snapshot-final.json`。后续恢复实现与安全复审见[导入记录](../../tests/2026-10-22-platform-restore.md)。

## 随后：恢复与全链路验收

- [x] 独立项目预装正式迁移，事务内核对结构、权限策略/辅助函数、索引、所有者/表列授权、应用版本、空业务数据及实际身份，恢复数据；预置950MB配置精确处理，计数、外键和库/blob清单校验失败则回滚数据/序列。最终三文件20项通过，独立窄复审无新明确P1/P2。
- [x] 不恢复 Storage 对象元数据；本机物理文件API工具已验证写回和hash回读，桶配置由恢复守卫精确匹配。完整跨服务一体演练尚未完成。
- [ ] 单独处理平台加密根密钥、Auth/JWT、SMTP、API/Worker配置，不能以数据导出成功声称登录或生产恢复成功。
- [x] 本机实际Auth/PostgREST恢复后的新账号会话验收：三个合成账号邮件确认、产品Auth适配器登录/错密/刷新/退出、当前API处理器访问真实RLS，viewer昵称批注子文件历史可读而outsider/撤权拒绝；独立只读复审无阻塞P1/P2，最终复跑见[专项](../../tests/2026-10-22-real-auth-recovery.md)。不是托管平台或物理Storage验收。
- [ ] 原生事务/RLS、物理文件和API/Auth完整合成演练；托管项目、运营身份、获准渠道及独立介质另需真实授权资源。

依据：[官方逻辑恢复](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)、[Storage只读元数据边界](https://supabase.com/docs/guides/storage/schema/design)。托管平台兼容和真实生产恢复在实测前均未完成；本计划不是另造普通用户配置界面。
