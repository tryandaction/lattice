# 云运营确定开发缺口

状态：两项确定 P2 已完成代码修复、独立复核和本机 workerd 演练；生产运维仍 pending。详见 [专项交付](../../../workers/cloud-library-operations/FOLLOWUP-2026-10-21.md)。

## 必须修复

1. completed：版本化重新授权已实现；核验账号/目标身份，成功刷新并落盘后切换，保留outbox、事件序号与重试时间。拒绝错账号/同旧token/状态丢失，不删除 Durable Object 状态恢复。
2. completed：费用使用当前 UTC 账期、每项新鲜度和精确预期供应商集合；未配置或缺项不能显示正常。容量与费用分开，不猜测实际预算比率。

验收：旧实现首批17项中14项失败，修复后42项通过；相邻测试合计49项通过，独立复核42项通过。更新既有合成 fixture 后实际本机 workerd 验证 scheduled 执行、DO 重启持久化、同ID重试：3次本地投递、2条唯一通知，真实网络和通知均0。证据 `.lattice-build/turn-20261021/cloud-operations-followup-smoke/`；旧失败记录保留。未部署到生产。

## 继续开发

- completed（本地代码/演练）：内部SQLite Durable Object通知接收侧、回执和渠道失败alarm重试已实现；先保存pending/下次alarm再投递，交付结果持久化后才确认。相同ID重复返回同回执，内容冲突409；公开Worker路由仍404。68项专项和独立并发/存储失败probe通过。真实workerd完整scheduled监控→内部绑定→合成渠道→回执及故障恢复通过，4次尝试/3条唯一合成通知（含独立接收器测试事件）。不等于实际获准渠道已接通。
- completed：无网络部署预检和脱敏运营状态摘要（最近成功、身份、队列年龄和回执）已完成；默认不读环境变量、文件或网络，配置全也仅 configured-unverified。未知字段及错误类型拒绝，输出不回显身份、URL 或凭据。独立复核 62 项通过；见 [预检交付](../../../workers/cloud-library-operations/PREFLIGHT-2026-10-21.md)。
- completed（离线组装层）：默认不写的恢复点预检/组装、v2来源清单原始hash/快照绑定、工件/全部库/历史对象/空库覆盖、失败无完成标记、实际副本双hash与解密恢复、非破坏保留规划。31项专项和独立复审通过。2026-10-22已新增原生PostgreSQL四schema共享快照获取/独立空库事务恢复15项，以及物理Storage写回/实际哈希回读/取消续跑15项，均有独立复审；托管Supabase平台兼容、独立项目API/Auth/SMTP完整恢复尚未实现/验收，不能写成生产恢复完成。详见 [数据库层说明](../../operations/cloud-postgres-recovery.md)、[物理对象说明](../../operations/cloud-storage-recovery.md) 与 [离线恢复说明](../../operations/cloud-recovery-offline.md)。

## 外部验收条件

已有Supabase与QQ SMTP不重新列为缺配置。仍需要持续运行位置和专用运营身份、明确通知接收渠道、供应商账单读取及预算权限、独立加密保存介质/密钥托管、独立恢复项目/维护窗口。身份与通知未就绪时不自动访问生产或发消息。

本地DO/workerd和加密归档通过不代表生产定时监控、真实故障通知、费用告警或全项目恢复完成；最终按真实证据收敛。

## 本轮后续证据

- `.lattice-build/turn-20261021/recovery-offline-complete.json`：4文件31项恢复/组装/副本/保留专项，独立复审同数通过。清单绑定P2先红后绿，旧v1明确unbound。
- `.lattice-build/turn-20261021/notification-delivery-green-final.json`：4文件68项通知/监控/预检专项；独立复审同数通过，另验证12个并发重复请求只投递一次、首次持久化失败不调用渠道。
- `.lattice-build/turn-20261021/notification-workerd-fullchain/result.json`：实际SQLite重启、保存alarm重试、scheduled监控与内部接收链、正常→故障→恢复，真实网络/通知0。
- 本轮只修改运营侧脚本与Worker/材料，未部署到生产，未修改或重装3.1.3客户端，不沿用客户端门禁冒充本轮运营代码的生产验收。
