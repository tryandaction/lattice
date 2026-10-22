# Lattice AI 上下文与本地 Harness 设计

依据：`docs/development-prompts/2026-10-08-agent-context-harness.md`。用户已授权自主设计实现和隔离测试，版本固定 3.1.0；禁止 Git、部署、安装、真实已登录 Harness 推理、凭据读取和非授权文件扫描。

## 结构与职责

延续现有 Chat／Research Agent 与审查队列，不替换成熟工作流。持久会话采用 versioned envelope，保存 active conversation、每会话 draft、workspace identity 与有效消息／源版本；single-flight hydration 不覆盖加载期间用户操作，FIFO strict flush 可报告失败。失败、停止、未验证回答保持可见并排除模型历史。

源读取采用授权 workspace 内路径和已知 library bridge；目录递归发现与相关 chunk 检索分离。preview 仅作发现，传给模型的范围有 source revision、页／section／行位置、读取预算与取消。权限／revision 变化明确失效；新会话不继承上一会话源。PDF 技能复用真实 pdf-item manifest 与 planned writes／write guard，创建子文件先提案审查再原子应用。

ChatComposer 管理发送前快照和完整用户正文，draft 写回持久会话；输入估计只提示预算，不截掉正文。Timeline 复制原始回答 Markdown，将已验证证据转为稳定源链接，暴露复制失败与流式状态。真实执行事件使用 conversation／request/session 标识，取消或终态之后拒收迟到 running 事件。

Harness 采用统一 runtime contract，Rust owned child 管理 stdio／进程树，前端只通过 Tauri commands 通信。Codex 使用本机 schema 验证的 App Server initialize、thread、turn、interrupt 和 approval；Claude 仅使用官方协议能兑现的能力。默认 workspace 限制与具体 action 审批，无法桥接审查的写入只能进入授权 scratch 形成提案。未知 DeepSeek 发行物保持 unsupported。

## 文件归属

- 会话代理：`src/stores/ai-chat-store.ts` 与对应 store tests；新增 AI session persistence 工具。
- 源代理：`src/lib/ai/document-*`、`conversation-documents.ts`、`workspace-indexer.ts`、AI source index、`lattice-skills/**`、`workspace-file-task.ts` 及对应 tests。
- 原生代理：`src-tauri/src/agent_harness.rs`、`src/lib/ai/harness/**`、AI harness store 与对应 tests。
- 本窗口：`src/components/ai/**`、AI 专属 hooks、Markdown export／输入预算工具、diagnostic 与真实 UI 验收。
- 不改共享 settings、layout、pdf-item、searchable-text、cloud、main.rs、依赖版本与锁文件。main 注册和 shared bridge 请求写进交接。

## 验证边界

先用失败回归确认 active ID／draft 恢复、长正文、索引失效、复制错误等症状，再最小修复。fixture 代替所有收费推理，原生 fixture 覆盖半包／stderr／EOF／审批匹配／停止与恢复。真实 Codex 只做 version/help/schema 与不推理握手。独立 UI server 为 port 3539、dist `.lattice-build/agent-context-dev-20261008`。每项保留证据与未测边界，最终 qa:gate 和安装核验属于主窗口。
