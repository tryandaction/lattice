# Agent Harness 原生接入与证据（2026-10-08）

版本保持 3.1.0。真实推理请求 **0**；未上传用户文件、读取或复制凭据、读取用户 Codex 配置、调用 MCP status/tool、改登录或新建隔离登录 home。本文覆盖 native/transport；主窗口负责最终 UI、全构建与安装验收。

## 已确认的问题与修复

| 根因 | 最终行为与失败回归 |
| --- | --- |
| grantRoot 的官方语义是余下会话的写授权 | 任意非 null grantRoot 不可接受。回归先失败 !approval.canAccept，修复后通过 |
| 同一 fileChange item 在等待审批时可被替换；terminal turn 仍可能残留 pending | 审批绑定原始完整 item/diff、当前 connection/session/turn/request ID，重新验证 resolved scratch path；terminal 拒绝。先失败 An approval must bind the original diff，修复后通过 |
| 缺 thread/turn 的 notification 可结束当前任务或污染回答 | turn/item/error 必须匹配完整 scope；unknown/隐藏思考不展示，完成或中断旧 turn 不复活。先失败 Unscoped completion cannot finish this turn，修复后通过 |
| schema 仍保留 untrusted，但真实 0.162.0-alpha.2 help 与官方实现已退休该策略 | 改用 on-request + approvalsReviewer=user。严格 fixture 先拒绝旧策略 RPC -32602，修改后通过。未调用真实 thread/turn |
| 完整 EOF 但进程存活时 reader 只退出 | Codex 生产 AsyncRead reader 在 EOF 立即 error 并停止 owned tree/child。最终以 tokio::io::empty() 直连生产 reader，同时保留真实 Node child 验证清理；Windows Node 关闭标准 stdout 未可靠产生 OS EOF，未声称跨进程此场景通过 |
| Windows spawn 后 AssignJob 前 child 已可执行 | CREATE_NO_WINDOW + CREATE_SUSPENDED，加入 KILL_ON_JOB_CLOSE Job 后只恢复核验属当前 PID 的初始线程；失败关闭 Job。先失败 An unowned child must not execute before entering its job，修复后通过。停止先杀 tree 再取 stdin 锁，防写背压阻塞清理 |
| Claude 中断后复用已死连接；turn/start 未返回时取消等待原回复 | Claude 中断后重连原 mapping；提前取消立即断开 owned connection，迟到回复不能改状态。TS 先失败 expected 1 to be 2 / cancel timed out，修复后通过 |

仅支持具体 scratch 文件审批，不接受 command、session-wide、权限提升或任意外部工具审批。用户正式 workspace 写入由 Lattice proposal/revision/review broker 另行办理；scratch 不自动应用。

## 外部工具的真实边界

保留用户已安装 Codex 和现有登录。随机命名 permissions profile 设置 :root=deny、:minimal=read、明确 workspace=read、该连接 scratch=write、临时根 deny、命令网络关闭；启动禁用 hooks/plugins/apps/multi_agent/code_mode/view_image 和 web_search 等已知独立入口。此机制**不是所有工具面的隔离保证**。

用户配置的 MCP server 是独立执行面，内建命令 filesystem sandbox 不能约束它。官方 to_mcp_config 保留用户服务器，merge_toml_values 深合并表，所以 -c mcp_servers={} 不能清空继承配置。未使用这种假禁用，也未读取用户配置、枚举或启动 MCP，未借文件审批授权外部工具。

Codex supported=true 表示协议/profile 能力可用，同时返回 capabilities.inheritedExternalTools=true 与非空 probe.reason；connect 返回相同 reason，并发 notice。说明原配置**可能**提供 MCP 等外部工具，其权限由原工具管理，不受 Lattice scratch 审查约束。该字段表示未核验的边界，不断言已有某个服务器。用户选择本机 Harness 发送沿用原工具配置；UI 在 supported=true 时也必须显示边界。

仅注册四个 Lattice 动态工具：lattice_sources_list、lattice_sources_search、lattice_sources_read、lattice_pdf_proposeChild。使用官方 item/tool/call 与 DynamicToolCallResponse（success + contentItems/inputText），结果匹配 connection/session/turn/requestId/callId。授权源、revision、PDF 正式写入由绑定 broker 保护。readScratch 验证已打开 handle 的真实路径、读前后 metadata、expectedRevision，限本连接 scratch 内 UTF-8 md/ipynb/csv/tsv/json/txt、1 MiB。

Claude 使用官方 stream-json/stdin、restricted、--tools ""、--disallowedTools mcp__*、--strict-mcp-config 与空 --mcp-config；不展示假审批。help 必须证明全部 flags。本机 PATH 未发现 Claude，仅完成协议设计和恢复回归，未声称真实 Claude 通过。DeepSeek 发行物未确认，保持 unsupported。

## main.rs 接入契约

模块 mod agent_harness；State 为 AgentHarnessState::default()。前端统一 { request: ... }、camelCase。保持 11 个既有命令签名：

    agent_harness_probe
    agent_harness_connect
    agent_harness_start
    agent_harness_resume
    agent_harness_turn
    agent_harness_interrupt
    agent_harness_approval
    agent_harness_drain_events
    agent_harness_disconnect
    agent_harness_tool_result
    agent_harness_read_scratch

清理入口为 pub async fn shutdown_all(state: &AgentHarnessState) 和 pub fn shutdown_all_blocking(state: &AgentHarnessState)。主窗口销毁/应用退出清理 owned processes；辅助窗口关闭不得触发全局清理，隐藏面板不应断开。主窗口负责注册与生命周期接入。

## 精确命令与输出

工作目录 C:/universe/software development/me/Lattice，PowerShell：

    codex --version
    # codex-cli 0.162.0-alpha.2
    codex app-server --help
    codex --help
    codex app-server generate-json-schema --experimental --out ".lattice-build/agent-harness-native-tests/schema-20261008"
    # exit 0；有限读取 ThreadStartParams properties：permissions=True, dynamicTools=True, approvalPolicy=True

    & "src/lib/ai/harness/__tests__/run-native-tests.ps1"
    # test result: ok. 18 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out

    & ".lattice-build/agent-harness-native-tests/harness-tests.exe" "agent_harness::tests::installed_codex_initialize_and_permission_profile_without_inference" --exact --ignored --nocapture
    # installed version=codex-cli 0.162.0-alpha.2; protocol=codex-app-server-jsonl; permission profile accepted; inference calls=0
    # test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 18 filtered out

    npx vitest run "src/lib/ai/harness/__tests__" --maxWorkers=1
    # Test Files 2 passed (2) / Tests 10 passed (10)
    npx eslint "src/lib/ai/harness" "src/stores/ai-harness-store.ts"
    # exit 0

focused runner 复用现有 Cargo metadata/rlibs 调用 rustc，不改 Cargo/main、不安装依赖。真实测试内部仅运行 --version、app-server generate-json-schema --experimental --out <native TempDir>，启动 owned app-server --listen stdio:// 后发送 initialize、initialized、permissionProfile/list，再 shutdown。没有真实 thread/start、resume、turn/start、账户/模型请求或 MCP 枚举。

18 原生项覆盖：碎片 UTF-8/partial EOF、超过 50K 混合正文逐字往返、8 KiB stderr、128-event 背压下 500 delta 不丢序；审批 ID/decline/过期/越界/命令提升/grantRoot/diff替换/terminal；unknown/跨 session/无 scope/中断迟到；空退出/crash/超限；崩溃后新连接恢复相同 session 与工具清单；conversation/native manifest 隔离；opened scratch path/revision；挂起前不执行与 owned descendant 全树清理。stderr 不进入 UI/报告。

## 协议与未验证项

- 当前真实 CLI 为 codex-cli 0.162.0-alpha.2，experimental thread/turn permissions 与 response activePermissionProfile；旧 sandboxPolicy 不作为本版本权限路径。schema 保留 enum 不证明 runtime 仍支持。
- 真实安装仅验证 initialize/profile/list；真实模型输出、OS 文件沙箱越权阻止、外部 MCP、真实 thread/resume、Claude 安装、macOS/Linux、完整 browser/Tauri UI 均未在此声明通过。Windows profile 的实际执行强度由原产品沙箱/环境决定。
- Job 是生命周期边界，不是文件或 MCP 沙箱；没有对所有外部工具统一审查的保证。主窗口须审核并在 UI 披露。
- 主窗口负责 full typecheck/qa:gate/Tauri 构建、安装 hash、主窗口 destroyed/aux close 验收。本归属源码交接后只读等待。

## 官方依据

## 最终前端整合补充

父窗口已只读核对main.rs的11命令与主窗口关闭cleanup注册。`HarnessEvent.scratchPaths`新增为native解析且属于本连接scratch的路径列表；前端只能在已结束的匹配connection/conversation/session/turn中回读，并再次核验当前workspace，转为完整raw Workbench草稿与目标原文差异，正式应用仍由Review操作办理。恢复saved事件只读显示，不自动启动进程。

2026-10-08 23:34最后focused native结果18 passed/0 failed/1 ignored；23:41真实安装握手1 passed，版本仍codex-cli0.162.0-alpha.2，推理0。TS harness/artifact-review/timeline分组13项通过；真实浏览器已完成source read→PDF proposal→Review和scratch全文→Review→写后回读。官方协议fixture与真实安装握手/真实模型边界仍按本文区分。最终产品构建/installed hash由主窗口执行。

### 官方依据链接

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)：stdio、握手、thread/turn、工具与审批。
- [MCP 配置](https://learn.chatgpt.com/docs/extend/mcp)：共享配置、独立服务器和按名称禁用。
- [to_mcp_config](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs)、[merge](https://github.com/openai/codex/blob/main/codex-rs/config/src/merge.rs)：用户 MCP 与深合并。Context7 /openai/codex 的“plugins 关闭全部 MCP”摘要与实现不一致，未据此判断安全。
- [Claude headless](https://code.claude.com/docs/en/headless)、[CLI](https://code.claude.com/docs/en/cli-reference)。
- [Windows creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)、[ResumeThread](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-resumethread)、[thread ownership](https://learn.microsoft.com/en-us/windows/win32/toolhelp/traversing-the-thread-list)。

