# Agent 真实产物与科研工作流修复

目标：保留针对性引用与跨文件精准红框修复，消除 Agent 原始上下文回显和假完成，让需要的现有科研流程产生可验证的结果。

| 任务 | 状态 |
| --- | --- |
| 审计模型请求、失败/恢复、跨文件材料、笔记与高亮产物链 | completed |
| 修复真实model ID、合成校验、真实笔记、PDF审批保存与撤销 | completed |
| 完整界面执行与错误路径、关键词/跨行引用验收 | completed |
| 统一质量门禁与隔离桌面、本地修复包 | completed |

根因与修复：展示用provider/model误作请求model；provider错误或空答复静默降级为Task/Question+整份prompt并标completed；没有选文时伪造全文前800字selection；Agent丢弃@引用正文；恢复把900/1200字符审计预览冒充来源/答复。现实际model ID独立，生产requireAnswer且失败/空串/echo/取消/提案验证失败都在写入前终止；跨文件正文进入预算；恢复重新合成，不拿审计预览当结果。

科研笔记：格式配置送真实合成器；正文直接成为草稿，去除空模板与所有页面preview堆砌。引用token转换可持久化工作区根链接，保存到任何笔记目录后仍能精准打开源文。代码/Notebook/组织方案明确是计划，无工具执行结果不宣称已执行。

PDF高亮：最多5条严格原文quote+理由提案，当前消息内可审阅定位，按文件确认。实际PDF模型解析、真实sidecar保存确认后才显示成功；失败保留建议；撤销仅移除本次且未被用户改过的批注。保存串行化，阅读位置不再伪造text内容缓存。普通引文点击不清空批注提案。

现有单元证据：模型ID回归先红后绿；engine41/41、草稿/写入59组合、surface runner20/20；PDF adapter148+撤销1、proposal/Review/存储16均通过。全局typecheck通过。完整本地mock Anthropic HTTP→生产Composer→Review→旁注保存/重开/撤销验收进行中，禁止以单元通过替代实际结果。

上一轮针对性引用全量测试2947已通过；因用户追加Agent范围，在开始构建时停止旧门禁和打包等待器，未刷新产品。待本轮整体通过后统一重建。没有提交、推送、安装覆盖或远程部署。

完整界面验收发现并修复：默认记忆建议产生额外审批并抢占聊天，导致真实高亮提案藏入Trace。现默认关闭，用户可主动开启。最终严格本地Anthropic三case均通过：真实HTTP raw model id；Composer→提案→原文定位→批准→真实sidecar确认→切文件/重开→overlay存在→撤销重读；provider500与无效quote均零写入、无假完成、无Task/Question dump。报告 `output/v3-validation/evidence/agent-annotation-flow-final/report.json`。使用隔离loopback模型接口验证协议与执行，不宣称调用真实供应商；原文未外发。

2026-09-27 续作核验：无遗留构建进程。最后一项关键词链接根因（LivePreview异步加载后未绑定container事件）已修，`targeted-keyword-fixed/precise-fragments.json` 证明真实Huie关键词仅框glass vacuum cell，800px下Markdown句子分两条精确文字框；无pageerror。自动PDF高亮流程推断14项测试通过。当前源码重新执行完整 `qa:gate`，日志 `output/v3-validation/evidence/qa-gate-effective-20260927.log`；旧v3产品包尚未包含这些最终修复，不作为本轮交付。

2026-09-27 独立最终审阅修复两项P1：以明确工作区文件身份取代任意路径后缀，跨窗格注入/撤销共享单消费者claim，持久化中卸载不重放，旧请求不清新请求；AI保存失败保留并恢复用户已有待保存编辑。前者3文件25项针对性通过，后者hook4项通过，都有失败回归。停止过期门禁后源码冻结，最终日志改为 `qa-gate-effective-final-20260927.log`。只有最终整套门禁与新程序验证通过才替换发布包。

最终收尾：门禁退出0，387文件/2999测试、114文档、类型检查、两次前端构建、Rust及两种安装包通过；0 lint错误154警告。生产网页与新桌面均通过精准引文/关键词/跨行和Agent成功、HTTP500、无效提案三case，旁注实际保存/重开/撤销均验证。桌面关键词完整被框住（130px vs整行446px），测试不再错误要求装饰余量必须对称5px，保持文字覆盖和过宽限制；Tauri本地IPC在桌面测试中被正确认定为本地通信。1099源码文件哈希保持冻结。MSI/NSIS解包运行与版本/哈希核验通过；正式发布脚本已更新 `releases/v3.0.0`，旧包备份为 `releases/v3.0.0-before-effective-fix-20260927`。完整边界和证据见发布目录 `EFFECTIVE_WORKFLOWS_QA.md`。
