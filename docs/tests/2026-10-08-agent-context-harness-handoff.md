# Lattice AI Context / Harness 正式交接（2026-10-08）

版本固定 3.1.0；本窗口不运行发布构建、安装或远程部署。设计和计划见 `docs/superpowers/specs/2026-10-08-agent-context-harness-design.md`、`docs/superpowers/plans/2026-10-08-agent-context-harness.md`。

## 主窗口共享入口

- `AppLayout` 的 `await loadConversations()` 与 AI 面板的二次调用必须共享同一 hydration flight；store 将保持既有入口。不要将恢复 active ID 强制改为第一个 conversation。
- 设置复用 `src/components/ai/agent-runtime-settings.tsx` 的单一入口；API provider 继续使用现有 profiles。组件已经落地，Harness 模式隐藏 API profiles/model 控件。
- Native 实现归 `src-tauri/src/agent_harness.rs`。主窗口已接入 module/State、11 个命令及主窗口关闭 cleanup；本窗口只读核对注册结果。全部命令使用单个 `request` object，精确清单见 `docs/tests/2026-10-08-agent-harness-native-evidence.md`。
- cleanup 签名 `pub async fn shutdown_all(state: &AgentHarnessState)`、`pub fn shutdown_all_blocking(state: &AgentHarnessState)`；主窗口在 owned window close／app exit 调用 `agent_harness::shutdown_all_blocking(&app.state::<agent_harness::AgentHarnessState>())`。bounded events 使用 connection/conversation/session/turn 标识；不可关闭不属于该 State 的进程。
- Cloud 的权限与版本是 authoritative；AI 只消费 workspace/provider list/read/search/version/permission bridge，不修改 shared-library。源代理将在自己的证据片段提供精确 interface。

## 已确认症状

- `chat-timeline.tsx` 的 clipboard catch 忽略失败；copy 依赖 hover，触屏／键盘发现困难。
- `chat-composer.tsx` 的输入局部 state 没有普通草稿持久入口；面板卸载会丢失编辑内容。
- context 准备流程固定 `.slice(0, 8)`；需要将授权选择集与读取预算分离，而非无限装入模型。

## 验证边界

所有真实推理请求数目前为 **0**。本机 Codex 只允许 version/help/schema 与不推理握手；Claude／DeepSeek 未验证安装前不得显示已连接。最终完整 qa:gate、Tauri 产品构建与 installed hash 核验由主窗口执行。

本窗口实现与允许范围内的验收已完成，进入源码只读等待主窗口审查。以下最终审计取代早期协调文字；最终 full qa:gate、Tauri 产品构建、安装 hash 与冷启动安装验收仍归主窗口。

## 主窗口当前接入／构建协调

- AI 面板草稿已使用 `useAiComposerInput` 保存每会话完整 draft。隐藏不丢编辑；恢复 ordinary draft 不自动提交。
- Native 后续工具桥新增两个 command（原 9 个签名不变）：`agent_harness::agent_harness_tool_result` 用于 scoped `item/tool/call` 的真实 JSON-RPC response，`agent_harness::agent_harness_read_scratch` 只读取该连接拥有的 scratch artifact（最大 1 MiB、禁止链接与路径逃逸）。请主窗口在该函数落地后注册；模块 State／cleanup 不变。无外部工具改动绕过 Workbench 审查。
- 设置组件将导出 `AgentRuntimeSettings`（`src/components/ai/agent-runtime-settings.tsx`）；请在现有 AI 设置只提供一个入口。API 配置继续使用原 profiles，harness 配置独立 versioned storage。
- `/diagnostics/agent-context-harness` 已由主窗口接入并完成真实浏览器交互；诊断组件使用明确隔离的 provider/transport/filesystem fixture，支持第二历史对话、50K 原文、14 文件目录、源失效、PDF/Harness/scratch Review 和文件回读。
- 独立 Next server 已启动 `127.0.0.1:3539`，dist `.lattice-build/agent-context-dev-20261008`。Next 自动向共享 tsconfig.include 添加该 dist 的 types/dev/types（未手动修改 tsconfig）；主窗口最终检查时可统一保留／移除类型路径，勿覆盖并行改动。
- Web pagehide 可同步保存完整 schema v3；Desktop 关闭请在 frontend await `useAiChatStore.getState().flushConversations()`，再进行关闭。OS hard-kill 最后未完成的 IPC 写入无法保证；bounded checkpoint 会限制损失范围。

## 最终症状、根因、行为与证据

| 主链 | 确认根因与最终行为 | 权威证据 |
| --- | --- | --- |
| 会话/草稿 | v2 未保存 active ID/普通 draft，重复 hydrate 覆盖本地编辑。v3 保存每会话正文、身份、checkpoint，single-flight/FIFO/strict flush；恢复中断输出可见，失效源和未完成 turn 不进入模型历史。continuation 只从当前会话 draft 读取，自动提交绑定会话 ID。 | `ai-chat-store.test.ts`、`chat-source-validation.test.ts`、AI 面板 continuation 隔离；浏览器第二对话关闭重开及页面重载。详见 session evidence。 |
| 长输入 | 输入局部 state 丢失与固定 preview 误用已消除。50K 混合中文/英文/LaTeX/fence 完整保存/提交；已知模型预算超限提供显式分批与可恢复 checkpoint，取消和迟到输出不推进进度。 | `long-input.test.ts`、AI 面板 IME/50K 测试；真实浏览器 `originalCharacters=50000, originalIncluded=true`。 |
| 授权目录/来源 | 旧固定8路径、发现摘要混同正文。当前 file/folder 选择与 lazy list/search/read 分离，真实版本/chunk/offset/覆盖进入上下文；101文件检索不先全量capture，不读取未选活动文件。模型发现路径后可在有限预算追加机器读取步骤。 | `source-index.test.ts`、`api-source-tools.integration.test.ts`、AI面板101文件边界；浏览器14文件/38节/5批和真实引用打开。 |
| Markdown复制 | hover才可达且clipboard错误被吞。常驻键盘/触屏按钮复制源Markdown，保留表格/公式/fence/稳定来源链接，流式partial说明及失败提示；不导出内部trace或临时citation ID。 | `answer-markdown.test.ts`、`copy-answer-button.test.tsx`；浏览器会话剪贴板读回327字符，所有结构/链接检查true、temporaryId=false。 |
| PDF子文件 | 自动conversation抑制显式交付、名称丢失、父版本在保存时被重新绑定。现显式命名Markdown生成review draft；Notebook/CSV/TSV读取父PDF后格式验证；actual snapshot绑定manifest/itemId与原parent/child版本直到close前。机器propose必须有本请求先前实际read/search版本，不能用1字符探测重绑。 | runner/note planner、workspace-file-task、pdf-child-skill、source-pdf-tool-runtime回归；preflight竞态先红后绿；浏览器API/Harness写入、回读、树归属及父PDF改名重开。 |
| Cloud引用/子文件 | Cloud引用原来走本地router，普通云草稿可能落入个人workspace。点击先provider.read+内容hash/role/id/version重验，再openCloudWorkspaceResource；新点击取代慢旧点击。Cloud PDF聊天结果由实际cloud snapshot转换为版本保护proposal，失败保留正文并拒绝本地草稿。 | AI面板cloud citation、cloud-pdf-child-skill、workbench-cloud-review测试。真实Cloud离线重开当前由云窗口处理，未在此声称通过。 |
| 执行事件 | 迟到/cross-scope事件可能污染回调，恢复saved事件不可见。Reducer是UI/tool callback接受门禁；实际tool ID/时间/审批/diff可见，恢复事件只读显示不自动连接。owned scratch全文读取进入raw Workbench，更新目标保留原文差异。 | harness contract/store/artifact-review/timeline 13项；原生18项；浏览器source read→PDF proposal→Review、scratch回读及应用。 |

## API 与本机共同技能接口

`LATTICE_SOURCE_PDF_TOOLS` / `LATTICE_SOURCE_PDF_SKILL` 提供四个机器工具：`lattice.sources.list/search/read`、`lattice.pdf.proposeChild`。API JSON planner 发现同一 schema，通过 `ResearchAgentRunInput.latticeSourcePdfRuntime`→tool loop→broker执行；本机映射为下划线动态工具名。函数只绑定发送时的 root/workspace/selection，前后校验scope/取消；缺runtime明确失败。实际读取正文在普通、完整文档和恢复分支统一预算合并，snapshots持久到消息；列表preview不生成证据。

`prepare_pdf_child` 只允许准备具体提案，不改变正式写权限。PDF proposal创建raw Workbench draft，模型工具没有apply/approve方法。read/search保存本请求已读版本，propose再次验证同版本；Workbench审核原文/差异后才调用write guard与正式写入。最多24个计划步骤，有限重新规划/读取预算；超限保留范围与可恢复提示。

Cloud host由主窗口维护：`{active,provider,resource}`、`getCloudWorkspaceSnapshot`、`subscribeCloudWorkspaceHost`、`openCloudWorkspaceResource({libraryId,itemId,anchor})`。AI不修改shared-library，不把Cloud display/resource identity传给filesystem。Cloud child创建使用expectedParentVersion，更新使用expectedVersionId，账号/scope/role/parent/child版本变化拒绝写入。

## 最终验证命令与结果

在仓库根目录 PowerShell；无依赖安装、真实推理或产品构建。

```powershell
npx vitest run "src/lib/ai/__tests__" "src/lib/ai/harness/__tests__" "src/components/ai/__tests__" "src/stores/__tests__/ai-chat-store.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-research-agent-tool-loop.test.ts" "src/lib/__tests__/ai-research-agent-planner.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-note-taking-draft-planner.test.ts" "src/lib/__tests__/ai-workbench-actions.test.ts" "src/lib/__tests__/ai-lattice-skill-registry.test.ts" --maxWorkers=2 --reporter=dot
# 23:41:43开始：74 files / 742 tests passed，exit0。

npx vitest run "src/components/ai/__tests__/ai-chat-panel.test.tsx" "src/lib/ai/__tests__/api-source-tools.integration.test.ts" "src/lib/ai/__tests__/source-pdf-tool-runtime.test.ts" --maxWorkers=1 --reporter=dot
# 最后目录授权修复后：3 files / 79 tests passed，exit0（与上组重叠，不累加）。

npm run typecheck
# 最后23:46检查exit0。新增测试真实字段entries；不存在的memories错误已修，不保留旧绿结果冒充最新。

npx eslint "src/components/ai" "src/lib/ai" "src/hooks/use-ai-composer-input.ts" "src/stores/ai-chat-store.ts" "src/stores/ai-harness-store.ts" "src/components/diagnostics/agent-context-harness-diagnostics.tsx" --quiet
# exit0，无error。仓库已有React effect/memoization warnings不等同零warning。

& "src/lib/ai/harness/__tests__/run-native-tests.ps1"
# 18 passed / 0 failed / 1 ignored（真实安装握手显式单跑）。
& ".lattice-build/agent-harness-native-tests/harness-tests.exe" "agent_harness::tests::installed_codex_initialize_and_permission_profile_without_inference" --exact --ignored --nocapture
# 1 passed；codex-cli 0.162.0-alpha.2；initialize/permission profile accepted；inference calls=0。
```

之前740项大回归有一个Unknown错误文案断言失败；修正后上述742项重新全部通过。Vitest输出含已有act警告，浏览器最终fixture console error/warn为空。最后小范围变更只新增101文件边界并关闭隐式上下文，79项和typecheck/lint再次通过。

## 浏览器权威证据

真实Codex内置浏览器访问 `http://127.0.0.1:3539/diagnostics/agent-context-harness`，不是jsdom截图。读取DOM、点击真实控件、调用浏览器会话剪贴板并读回；截图已在本对话输出。详细逐项观察见 `docs/tests/2026-10-08-agent-context-harness-browser-evidence.md`。

- 第二历史对话关闭/重开保持；50K原文重载仍50000字符，actual fixture request包含逐字正文。
- 14个嵌套同名/代码/Notebook文件38/38页节5批，稳定来源点击打开 `notes/topic-3/same.md`；修改topic-0后来源失效提示可见，旧源回答不进历史。
- API PDF实际读1/1页→命名note.md建议→Workbench Review→批准写回→回读manifest/content→PDF virtual child；父PDF改名后itemId/itemFolderPath保持、parentPdfPath更新。
- Harness fixture实际 `lattice_sources_read`→`lattice_pdf_proposeChild`→文件变更→completed；PDF/scratch均有完整Review并写后回读，文件内容/公式/table/fence保留。
- 真实模型输出与质量没有因fixture答复而验收；fixture只证明协议、路由、实际读取、审查和持久化链路。

## 用户使用本机Harness

打开明确本地工作区，在AI面板单一“运行环境”选择本机Codex或Claude Code；可留空按PATH检测，或在连接设置选择已安装exe，显示实际版本/协议/能力说明。登录在原CLI办理，不读取auth或复制token；模型留空使用原工具默认值。发送后建立/恢复该conversation与workspace映射，可停止任务。具体scratch审批只作用本连接的文件和diff；正式workspace写入须再经过Workbench。

Codex当前只完成真实安装的不推理握手；线程/turn/模型/审批/重连等由真实可执行协议fixture覆盖。Claude官方stream-json受限无工具接入已实现并有fixture/恢复回归，但本机PATH未确认安装；DeepSeek具体发行物未确认，保持unsupported，不能把API provider当本机Harness。Codex可能继承原配置的独立MCP执行面，UI披露此边界；不承诺Lattice审查能约束原外部MCP。

## 源码与审查清单

- 会话：`ai-chat-store.ts`、`chat-session-persistence.ts`、`use-ai-composer-input.ts`、`long-input.ts`、`chat-source-validation.ts`。
- UI：AI panel/composer/timeline、source/cloud-source-selection、copy-answer-button、runtime settings、harness-execution-timeline、Workbench及diagnostic组件。
- 来源/引用：`source-index.ts`、document-source/capture、cloud-source、citation-contract/markdown/history、answer-markdown、context准备。
- PDF：source-pdf-tool-runtime、pdf-child-skill/cloud-pdf-child-skill、workspace-file-task/workbench-actions、note-taking-draft-planner。
- API执行：agent-tool-broker/policy、research planner/LLM planner/tool loop/runner及统一工具上下文。
- 原生：`src-tauri/src/agent_harness.rs`、`harness/types/protocol/transport/tool-broker/artifact-review`及fixture runner。main.rs由主窗口接入。

对应tests与此前三份分项evidence均保留。没有Git/分支/worktree、版本/依赖/lock更新、打包安装、远程部署、收费推理或凭据读取；共享dirty成果保留。当前本窗口源码进入只读等待，主窗口审查意见仍继续既有Goal。

## 明确未验证与主窗口职责

本窗口不冒充产品发布验收：full qa:gate、最终Tauri构建、installed hash、实际桌面冷启动/窗口销毁、OS文件sandbox执行强度、macOS/Linux、真实模型能力和Claude安装均由后续具体授权或主窗口验收处理。正常Desktop关闭必须await strict flush；OS强杀最后未完成IPC有底层限制。

云窗口曾报告离线正文重开丢失的真实失败；该历史保留。主窗口最后同步：现已通过 IndexedDB 原文、关闭重开与推送的最新浏览器证据。本AI窗口没有自行把旧失败改成通过，也未重复云归属测试；最终以云窗口该新证据和主窗口审查为准。

## 冻结前最终补验

Harness 时间线限制滚动高度，scratch Review默认折叠，避免挤掉Workbench；按conversation重新挂载清除临时目标状态，审批失败显示可恢复提示。最后5测试文件84项通过，typecheck/lint exit0。最后browser在1280×720下Workbench body有124px有效可滚动空间，scratch/PDF已写回状态仍可查看。仅视图折叠修正后进行了实际截图复验，业务协议未再改变。

主窗口明确接手closeflush、renderer/云导航、fullgate、Tauri与安装审查。本窗口按请求停止自有3539开发服务后冻结AI归属源码，只读等待；不停止其他进程、不删除dist或任何dirty文件。
