# 离线部署预检与脱敏状态摘要

本轮范围：无网络预检、状态摘要与必要历史成功记录。没有通知接收侧/备份开发，没有产品src、版本、主文档、包锁、部署或真实账号操作。

## 契约与实现

- 新 src/preflight.mjs：纯函数 preflightOperations(input, at)，只接受显式 version=1 JSON结构。公开vars只校验不回显；secret/binding只接存在性布尔，未知字段拒绝。结果逐项报告目标、身份、通知、费用、调度、清理配置的 missing/invalid/configured。缺项/不可用为blocked，配置全为configured-unverified；固定deploymentVerified=false、networkRequests=0。
- 新 scripts/cloud-library-operations-preflight.mjs：无参数即空配置预检；--stdin-json才读取显式stdin，限64KiB。没有读取process.env、配置/secret文件，没有网络/部署能力。错误固定PREFLIGHT_INPUT_INVALID，不打印原输入/parse错误。退出0仅表示配置齐全，其他退出2。
- snapshot为严格的版本化脱敏结构；不接原始session/outbox/JWT。校验固定枚举、UTC ISO毫秒时间、未来/无效时间、最后成功不晚于最近检查、queuecount0与oldestAt=null一致。队列最多100；计算最老队列年龄，最近检查15分钟以上为stale；未提供状态/从未检查保持明确unknown，不伪造成功。
- summarizeOperationsState只在服务内部读取state，输出固定字段；不输出targetId/userId/token、通知正文、事件ID或收据ID。鉴权丢失覆盖尚未过期session表象；错账号不可用。无效队列时间返回invalid_state，全摘要不反射输入。
- monitor.mjs只新增实际health+vendor均ok时的lastSuccessfulCheckAt更新，以及原有内部tick返回summary；失败/warning保留历史成功。原index.mjs/public404未改，没有新公网endpoint。通知ack时间来自原lastReceipt，和健康成功分开。
- README.md提供输入字段、示例、退出码与能力边界；原两P2逻辑保留。

## RED/GREEN

证据都在本目录 test-evidence/，不覆盖旧两P2结果：

- 2026-10-21-preflight-red.json：新功能初始缺模块的RED，仅表示尚无预检实现，不宣称已有实现泄漏。
- 2026-10-21-summary-red.json：真实行为RED，既有tick未提供summary/最后成功，新增用例失败。
- 2026-10-21-preflight-identity-red.json：真实行为RED，存在bootstrap掩盖snapshot身份unavailable；修后blocked identity invalid。
- 2026-10-21-preflight-null-red.json：独立审查指出显式vars/secrets/bindings=null被当缺项而非坏类型，3项真实RED，已修为invalid_input。
- 2026-10-21-preflight-green.json：preflight+operations+followup，最终3文件62项通过，exit0。预检覆盖未知嵌套字段、无网络、URL/ID/key/凭据无反射、坏输入/null、队列时间/年龄、状态陈旧、无配置CLI与显式stdin；原两P2与通知回归保留。

严格聚焦tsc与指定文件eslint --no-ignore均exit0；node CLI默认输出blocked且不读注入环境secret。没有全量门禁或Next/Tauri构建。

## 准确边界

存在性布尔值与snapshot由操作者显式声明，不能验证真实secret有效性、部署服务绑定、Cron已运行、实际供应商账单或通知送达。完整配置也只“configured-unverified”。摘要是最近可得状态，不主动访问服务；15分钟fresh是观测策略，不是可用性保证。旧状态没有历史最后成功时输出null；本次未尝试推断或填补。

错误输入不包含诊断原值，调试需从固定检查类别查配置；这减少泄漏但不会给出失败URL或账号。原始DO state只允许服务内部调用投影函数，CLI只接严格脱敏snapshot。

独立复核者 /root/ocr_accuracy_tuning 已只读核对无env/文件/网络读取、无敏感值回显、最后成功更新与未来时间/队列校验，未见P1/P2；提出的null输入契约已按先RED后GREEN修正，最终重验结论随后补充。

monitor.mjs SHA256 5830EAA6FBE0AD935DCCEAAABA65B70540E2794076BB86865FA671188F931417；CLI 42055FF6D40A72277F66CA154511190E2798320568D91F40135126F7F5931290；preflight.mjs最后null校验修正的hash以最终工作树和独立复核为准。

最终独立关闭：复核者按最终源码独立重跑3文件62项全通过，另直接纯函数probe确认三种null均invalid_input；无剩余P1/P2。无env/文件/网络默认读取、strict字段白名单与secret布尔、无身份/URL/token回显、未来队列时间拒绝、最后成功双ok更新和configured-unverified/deploymentVerified=false均已核实。preflight.mjs最终SHA256 C356582785337619788292D9002317FEE82A33B5A7AA1F1863DD4E840917E268。源码冻结，之后仅追加此独立结论，没有产品或发布更改。
