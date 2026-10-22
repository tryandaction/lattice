# 物理 Storage 恢复开发验收

状态：运营侧物理对象写回实现及本地协议验收通过；未访问或部署生产项目。已安装及网页 3.1.3 客户端源码未改变。

## 已实现和修复

- 来源 v2 恢复点、完整来源清单 hash/快照及目标项目身份绑定；写入前后核对私有桶、全部库及当前/历史 blob 元数据，包含 MIME 类型。
- 缺失对象才 POST，固定禁用覆盖；实际远端 GET 的大小和 SHA256 作为完成依据。丢回包或取消后重跑重新核对实际字节，已有冲突不覆盖，失败不伪造完成。
- 实际文件先核对大小再流式 SHA，上传阶段同样有读取硬上限；损坏物理文件不能借较小的清单声明触发整文件读入。空文件保留正确的空内容 hash。
- 默认 CLI 仅准备参数，不读环境、文件或网络；显式执行才使用操作者进程配置。阻止跨域重定向，不返回上游错误正文或凭据。没有创建桶、修改数据库或删除回滚路径。

## 测试结果

- `.lattice-build/turn-20261021/storage-recovery-final.json`：15 项通过、0 失败、0 跳过。真实 Node loopback HTTP、真实磁盘文件，20 MiB 对象逐字节比对，不是仅验证数据库中的大小字段。
- `.lattice-build/turn-20261021/storage-recovery-adjacent-final.json`：恢复、组装、副本、保留及新物理恢复 4 文件共 41 项通过。
- `.lattice-build/turn-20261021/storage-recovery-api-adjacent-final.json`：既有对象导出及恢复点验证 2 文件共 18 项通过。与上一组为不同测试文件，新恢复 15 项已包含在 41 项内，不能重复累计。
- 独立复审没有新的明确 P1/P2，并单独运行实际文件越界、MIME 错配、空文件、持久化后取消续跑 4 项，全部通过。
- `.lattice-build/turn-20261021/storage-six-files-final.json`：最终状态合并执行上述 6 文件，共 59 项通过、0 失败、0 跳过。全项目 `npm run typecheck`、指定文件 `eslint --no-ignore` 通过，201 份文档检查通过。类型检查曾指出两个测试辅助文件的类型问题，已修正后重跑，不把旧失败写成通过。
- PostgreSQL 测试辅助环境的 `NODE_ENV=test` 类型补全后，重新运行集群启动异常清理用例：受限进程启动曾因可继承套接字错误 87 失败，记录保留；允许隔离本机原生子进程后实际通过，见 `storage-native-fixture-confirmed.json`。该次仅选择 1 项，另 11 项由筛选跳过，不冒充重跑全部数据库测试。临时集群均使用新测试目录并正常停止，既有服务未被停止。

保留失败记录：`storage-recovery-red.json` 为缺实现；`storage-review-red.json` 复现实际文件先整读及 MIME 漏核验两项问题，后续修复通过。`storage-recovery-green-initial.json` 的首个大 Buffer 深比较断言曾导致测试进程内存耗尽；改用完整 Buffer.equals 逐字节比对后整组约 5 秒通过。未将原始失败记录覆盖为成功，也未将此断言问题误写为已证实的产品内存故障。

## 截图问题和客户端基线

额外复跑截图对应的含空格精确目录、未编码 `@` 路径、引用选择和浮层位置：30 项通过，见 `.lattice-build/turn-20261021/ai-screenshot-recheck-final.json`。根目录放置 12,020 个无关文件，指定目录仍直接读取，不枚举无关根文件。

`.lattice-build/turn-20261021/storage-client-baseline-proof.json`：门禁时冻结的 2,156 份客户端源文件 hash 全部一致，安装版本 3.1.3，主程序 SHA256 `411deef9d1de054348560123528c1bfdcacd3ebf16e1eaf3fb45e685b7a2a151`。真实模型请求 0、个人凭据文件读取 0。客户端安装及网页发布证据仍以 [3.1.3 交付](2026-10-21-final-delivery.md) 为准。

## 仍需完成

托管 Supabase 平台及角色的恢复兼容、独立项目 API/Auth/SMTP 的完整恢复演练、专用持续运营身份、真实通知目的地和渠道适配、账单与预算读取、独立加密介质和密钥托管尚未完成。当前有实际本地物理字节恢复实现，不能再称作“只有 SQL 元数据”；也不能据此宣称生产恢复通过。

数据库与 Storage 不具备这里所需的跨服务事务，失败可能保留部分一致对象。工具的只增不覆和重跑核验不能代替维护窗口。未访问私人论文、真实云凭据、生产服务或模型，未发送真实通知、修改系统 PATH、提交或推送 Git。

[操作说明](../operations/cloud-storage-recovery.md) · [历史覆盖台账](../superpowers/plans/2026-10-20-requirement-coverage.md)
