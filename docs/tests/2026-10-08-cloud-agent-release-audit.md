# 云库与 Agent 3.1.0 发布验收清单

状态：等待两专项窗口正式交接；没有发布完成声明。用户要求先由两个窗口完成各自开发，再由主窗口审查整合、验收并更新桌面 3.1.0。本文件记录必须取得的证据，不替代功能实现。

## 验收要求及证据范围

| 要求 | 必须核对的当前证据 | 当前状态 |
| --- | --- | --- |
| 云连接、登录、刷新、重开与账号隔离 | 两独立 profile 的真实 UI/HTTP；持久会话恢复、退出、延迟刷新与账号切换拒绝旧身份 | 待正式交接 |
| 多格式目录、移动与同名身份 | 嵌套目录中文路径；移动改名后 stable item/child IDs；不同库同名文件不混淆；未知 bytes 下载 hash | 待正式交接 |
| Lattice 内置阅读编辑体验 | 实际 PDF 高亮器、Markdown/公式、代码、Notebook、Office、图片 viewer；tab/split 草稿保持；不以 tab 标题代替正文 | 待正式交接 |
| PDF 共享批注与小组评论 | A 选中/保存真实 PDF 高亮后 B 读取；作者与 version；只读/撤销拒写；评论/CAS；云模式无个人 sidecar | 待正式交接及主窗口专项审查 |
| 云离线同步与冲突 | 先持久化后确认；断网编辑、关闭重开队列、恢复推送；双实例不覆盖 outbox；409 保留双方；R2 取消与完成后重试幂等 | 待正式交接 |
| 云权限与链接 | 真实 SQL migrations/RLS + HTTP 越权；撤销后 read/search/download 拒绝；静态导出与 Tauri 深链接 | 待正式交接及原生验收 |
| AI 重开上下文与长输入 | 第二对话/完整草稿重载；有效历史与源版本真正进入请求；新会话不串文；50K 混合输入完整到 provider | 待正式交接 |
| 跨文件/目录阅读与索引 | 10+ 嵌套文件真实抽取和已读范围；增量修改/删除/撤权失效；云目录为空不回退个人文件；回答与可点击来源一致 | 待正式交接 |
| Markdown 复制 | 实际 clipboard 读回标题、列表、表格、公式、代码与稳定链接；无临时 citation ID；失败与触屏/键盘路径 | 待正式交接 |
| PDF 子文件技能 | 实际 PDF 读取 → 提案 → 审查 → 原子应用 → 回读 → 文件树/打开；移动重启归属不丢；版本冲突拒写；API 与 harness 动态工具桥 | 待正式交接 |
| 可见执行与本地 harness | 真实事件、跨会话隔离、取消/迟到/恢复；11 Native commands；owned process tree；Codex 本机 schema/不推理握手；Claude/未知发行物准确状态 | 待正式交接及原生验收 |
| 云证据精准导航 | 重新校验 provider/scope/version/role，再打开真实云 viewer；PDF page/snippet、Markdown snippet、代码 line、Notebook cell；首次异步挂载不会漏导航 | 待正式交接及主窗口专项审查 |
| 五皮肤、插件及既有功能兼容 | 聚焦/浏览器/原生检查与 canonical gate；保留前轮完整成果 | pending |
| 产品 3.1.0 更新 | 两窗口冻结后的 `npm run qa:gate` exit 0；canonical release；安装旧版本备份、新 exe hash、启动/重开验证 | pending |

## 测试边界

真实浏览器点击和真实本地 HTTP 可以证明产品链路；fixture Auth/R2/model/transport 不能证明真实生产云或模型推理质量。本机 Codex help/schema/握手不能证明真实推理成功。各报告必须区分这些层次，不能只看 green 总数。

当前没有生产云租户信息、远程部署或额外收费推理授权；先完成可配置接入和可部署后端，诚实列出部署环境项。DeepSeek harness 的具体发行物尚未确认，不把模型 API 或任意 shell 模板称为本机 harness 接入。

## 主窗口已知集成项

- shared PDF hook `scrollToAnnotation` 当前派发 `{annotation}`，既有订阅契约要求 `{annotationId,target}`，发布前核对。
- `cloud-workspace-host` navigator 的注册/重置和异步打开需要核对 provider 身份切换，不能将旧连接的完成应用到新连接。
- Cloud `cloudNavigationTarget` 已改用 pending navigation store；主 PDF adapter 的旧 `lattice:cloud-pdf-anchor` 一次性事件仍应在最终审查时统一，避免重复或漏定位。
- 前轮 `typecheck`、158 PDF tests、28 shell tests 仅为阶段证据；并行源码仍在改动，最终 gate 必须在冻结后执行。

两个窗口的源文件由各自继续开发，本窗口不重复实现。正式交接文件是 `2026-10-08-cloud-team-library-handoff.md` 与 `2026-10-08-agent-context-harness-handoff.md`。

## 交接前最新证据复核

2026-10-08 23:38（本地）云窗口仍 active，未正式交接。已核对原始运行结果与 `.lattice-build/cloud-team-evidence-20261008/browser-report.json`：

- shared-library/Worker 归属测试 32 files、206 tests exit 0；后续目录拖入 focused 回归另行通过。
- 最新专用浏览器门禁 exit 0；报告包括实际 PDF 正文、鼠标高亮、第二 profile 读取高亮；IndexedDB 离线正文持久化、关闭页面、重开后推送；邀请撤销、viewer 降级、成员暂停及缓存隔离；中文嵌套目录与原 bytes 下载；三皮肤和窄窗；`errors: []`。
- 早前 `OFFLINE_QUEUE_PROOF` 可见文本断言失败，由 Live Preview 的 Markdown 下划线语法引起；修改无语法标记后仍保留 IndexedDB 原文和服务端断言，没有以删场景换取通过。
- 最新全局 typecheck exit 0；文档检查 exit 0。生产云、Tauri、桌面安装验证仍未完成。
- AI 窗口仍在修工具读取结果的全分支上下文合并与先读版本绑定；没有正式交接，不以前轮 green 代替其最终结果。
