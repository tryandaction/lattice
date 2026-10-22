# Lattice Agent 长任务与全文科研工作流

目标：让“阅读全文并批注”成为可持续、可取消、可恢复的 Agent 任务。Agent 必须主动分批读取文件，记录真实覆盖范围，继续读取剩余内容，再生成少量可核验引文和可审批产物。上下文预算描述一次模型调用，不能冒充全文覆盖。

参考的 Codex Agent 原则：长任务依靠计划、工具、观察、修复和外部化状态循环；会话、压缩和恢复必须保留可继续状态；审批应在副作用边界中断并从同一状态恢复。官方说明见 [Agents](https://developers.openai.com/api/docs/guides/agents)、[Run long horizon tasks with Codex](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)、[Guardrails and approvals](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)。

| 阶段 | 状态 |
| --- | --- |
| 现状审计：页数/字符/证据/回答/产物/状态上限 | completed |
| 可授权的分批文档源与 coverage manifest | completed |
| Agent 继续读取、断点恢复、批次合成和进度条 | completed |
| 全文 PDF/MD/跨文件真实验收与发布包 | completed |

已确认限制：PDF 初始读取最多16页/7万字符；单页文本最多8000字符；证据解析默认3000 tokens；回答默认1400–1800 tokens；全文任务没有原文分页工具，第一次截断后只能提示用户补材料；Agent 状态栏的“17 context”是节点数量，不是已读页数；重试会重新提交整条用户请求，不复用已完成批次。

实施边界：先新增受授权 File/Handle 的 `AgentDocumentSource`，按 PDF 页 / Markdown 章节提供真实文本和版本指纹；`readUnit` 支持 AbortSignal，close/destroy 幂等，coverage 明确 total/read/pending/unreadable。然后在 Agent 运行中按批次读取和合成，批次完成写入 trace，取消后用同一 session 继续。保留现有 evidence contract，只有实际读取并核验的原文可生成 citation/annotation。没有读取权限、OCR 空白、版本变化和模型失败都必须显示可操作状态。

验收：27页 PDF 全文任务应显示 27/27 覆盖并至少逐批 trace；中途取消后继续只读取剩余页；指定 p.13–16 不被前16页 slice 吞掉；两个 PDF 加 Markdown 各自有 coverage；批注最多少量高价值建议，失败可 repair 一次后给出缺口；不再输出 Task/Question/context dump 或把 coverage banner当答案。

本阶段不覆盖真实付费模型、不提交、不推送、不覆盖当前安装版。旧 v3.0.0 包不是本阶段验收结果。

已落实：按授权 File 快照读取全部 PDF 页/MD 章节；内容哈希阻止过期续读；逐批校验原文并写入严格持久化检查点；取消、重开页面、同会话继续；从头读取绑定原材料；批次/最终输出各一次有界修复；最终消息含引用菜单的预算与所有批摘要覆盖；中英文进度和错误状态；注释数量配置。扫描空白和失败页面不计为已读。

已验证：9 个聚焦文件 159 项测试通过；实际浏览器+本地 Anthropic HTTP 验收 27 页全覆盖、p.27 原句红框、停止后重开续读不重复已完成页、切换文件后重读原材料、批次/最终结果修复、两个 PDF 加 Markdown 分别完整覆盖。此次验证使用回环模型夹具，未代表付费模型的科研理解质量。独立审查修复了存储错误吞没、最终提示预算超限/尾部材料遗漏、重读目标漂移与检查点结构损坏。

待完成：源代码冻结后的全量 qa:gate、生产前端/桌面/安装包验收及本地 releases/v3.0.0 更新。所有新证据统一保存到 output/v3-validation/document-* 或 evidence/document-*。

2026-09-27 追加恢复边界：初轮 391 文件/3041 项全量通过后，生产恢复验收的异步等待写法（Promise 被当作真值）已修复；并由此补强了真实快速关窗场景：首批读取前严格持久化带 sessionId 的聊天锚点，恢复最终汇总中的 ready 检查点时可仅重新生成结果。新增 6 项存储回归通过，相关 88 项聚焦测试通过；实际界面“读取中重开 / 汇总中重开 / 停止后重开”三种恢复均通过。最终门禁改为 qa-gate-document-final-20260927.log；8 个全文场景将在生产网页和桌面各执行一次。初轮候选包不得发布。

最终完成记录（2026-09-27 21:24）：`qa-gate-document-final-20260927.log` 退出0，391个测试文件/3047项测试通过；生产前端/最终桌面各8个全文场景、3个批注成功失败场景和精准跨文件引文验收通过。MSI/NSIS均解包并通过真实代码/Markdown保存、运行、扩展界面冒烟；NSIS包内EXE与最终桌面验收EXE哈希相同，MSI仅有Tauri安装器类型标记的两字节差异。`document-package-validation.log` PACKAGE_EXIT=0。标准发布脚本已更新 `releases/v3.0.0`，旧包备份在 `releases/v3.0.0-before-document-agent-20260927`，所有发布产物SHA256已复核。最终报告 `releases/v3.0.0/DOCUMENT_AGENT_QA.md`。无待发布步骤；未覆盖用户安装版、未提交、未推送、未远程部署。
