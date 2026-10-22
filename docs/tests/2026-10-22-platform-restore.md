# 已初始化平台的数据导入验收

状态：受保护导入已实现，最终三文件20项原生测试全通过，独立窄复审无新明确P1/P2。只在新建 loopback 合成 PostgreSQL 集群运行，不访问生产、真实账号或私人文件，不调用模型。客户端 3.1.3 未改变；这不是生产恢复通过记录。

## 实现范围

- `cloud-library-platform-restore.mjs` 默认 CLI 不读文件、凭据或数据库；显式执行时逐项校验大小/SHA/快照，拒绝链接并将可信运营归档复制到私有临时目录。仅提取声明的 public/auth TABLE DATA，不执行 schema、全局角色或 Storage 对象元数据。
- 实际数据库身份和项目引用双重防止回写来源。在事务中锁表，比较表/序列所有者、有效表授权与列授权、RLS/force RLS/策略、约束、触发器、独立索引及有效状态、public/auth 非扩展函数/过程定义及安全属性/授权、应用迁移账本和私有桶配置。空目标只允许仓库迁移固定预置的950MB配置行，其他数据拒绝。
- 归档 SETVAL 不执行，改用事务性 sequence RESTART。复制完成后验证表计数、完整库/blob清单和真实外键关系；失败数据、预置配置、序列重启都回滚。
- 采用仓库8份真实SQL迁移，包含作者昵称、权限、批注、PDF子文件与历史版本的合成数据。原生 PostgreSQL 验证 viewer可读、outsider不可读、撤权后不可读；不把合成 Auth 行恢复写成实际登录成功。

## 已保留的失败证据

`.lattice-build/turn-20261021/platform-restore-red.json` 为缺执行器时的失败。`platform-foreign-key-red.json`、`platform-policy-drift-red.json` 分别复现断外键和目标RLS策略放宽仍被接受；补实际关联验证和结构绑定后，候选 `platform-restore-final-candidate.json` 三文件15项通过。

独立复审随后发现策略调用的helper函数可被改成恒true、独立唯一索引可删除，两者均不改变策略文本/列/迁移账本。`platform-functions-indexes-red.json` 两个原生反例实际失败，七项因筛选未运行；不是最终通过记录。补函数定义/安全属性/执行授权和索引定义/谓词/有效状态绑定后，`platform-restore-final.json` 三文件17项通过，随后仍发现下方授权遗漏。

后续复审又确认目标表/列授权或所有者可单独漂移，`platform-privileges-red.json` 三项先红（九项因筛选未运行）。当前共享目录将所有者转换成稳定角色名，表/序列空ACL展开默认有效授权，显式空ACL和列授权单独保留，并参与事务内比较；独立窄复审确认代码修复成立，无新明确P1/P2。

## 最终结果

`.lattice-build/turn-20261021/platform-restore-final-privileges.json` 三文件20项通过、0失败、0跳过，包含实际8份迁移上的成功恢复、实际viewer/outsider/撤权隔离、双重来源身份拒绝、已有目标数据拒绝、列/迁移/预置配置不匹配、RLS策略/辅助函数/独立索引/所有者/表列授权漂移拒绝、最终验证失败后的全事务回滚及断外键拒绝。测试统计只计本次完整运行，不与前面的筛选红测相加。

全项目 `npm run typecheck`、指定源码与测试的 `eslint --no-ignore` 均退出0；205份文档检查通过。本轮没有客户端改动、重打包、部署或新增全量质量门；3.1.3的全量门禁/安装/网页证据保持独立。截图所示AI目录与输入交互另核对现有30项和原生交互记录，安装主程序hash仍等于3.1.3交付，不新增模型请求。

## 仍未完成的边界

完整托管项目兼容、生产SMTP/Worker配置、全局角色、平台根密钥及独立加密副本仍需专门验收或运营资源。后续本机实际Auth/PostgREST的新登录、确认、刷新/退出和当前API处理器的真实RLS访问已通过独立专项，见[实际Auth恢复](2026-10-22-real-auth-recovery.md)；不证明旧会话延续或托管Edge运行。物理Storage对象由独立API工具写回；当前导入不会伪造 storage.objects。归档来自可信运营流程，SHA绑定不是恶意SQL沙箱。序列观测不在事务快照内，维护窗口不能自动声称已确认。

[操作说明](../operations/cloud-platform-recovery.md) · [导出记录](2026-10-22-platform-recovery.md) · [物理Storage记录](2026-10-22-storage-recovery.md)
