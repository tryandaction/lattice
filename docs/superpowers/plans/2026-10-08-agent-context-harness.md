# Lattice AI Context Harness Implementation Plan

> 使用独立文件归属的并行子代理实现，父窗口审查并整合；不执行 Git。

**Goal:** 完成持久上下文、长输入、授权索引阅读、Markdown 复制、PDF 技能、真实执行事件与本地 Harness 接入的源码与验收交接。

**Architecture:** 复用 Chat／Research Agent／审查队列。分别维护持久会话、源索引与原生 runtime 边界，UI 通过稳定契约整合。所有推理测试均为隔离 fixture。

**Tech Stack:** Next 16.3.4 本地指南、React 19、Zustand 5、Vitest、Tauri 2／Rust／stdio JSONL。

**Spec:** `docs/superpowers/specs/2026-10-08-agent-context-harness-design.md`

## 全局约束

版本 3.1.0；只改委托 AI 归属；不动大量 dirty 成果；不 Git／分支／worktree／远程部署／打包安装／核心依赖更新；不读取凭据、不真实已登录推理、不收费 API；port3539 与独立 dist；main.rs 注册交主窗口。

## Todo

- [x] completed：完整读取委托与目标建立。
- [x] completed：现状复现／官方协议／本地指南与接口核对。
- [x] completed：会话恢复与有效历史。schema v3、active ID、每会话draft、single-flight/FIFO/strict flush、失败与停止历史隔离。
- [x] completed：授权source index与PDF技能。实际read/search及snapshot、分页/预算、Cloud权限、稳定引用、manifest和审查版本绑定；API四机器工具真实接执行端。
- [x] completed：原生Codex/Claude runtime。owned stdio、scope/approval、背压/UTF-8/stderr/清理、scratch Review；真实Codex仅握手，Claude安装未验证明示。
- [x] completed：Composer/Timeline整合。50K/IME/draft、continuation会话隔离、单一runtime入口、实际与saved事件、Markdown复制。
- [x] completed：真实UI/原生fixture。浏览器目录38/38节14文件、剪贴板、PDF子文件Review/树/改名、Harness动态工具和scratch回读；18原生fixture+1真实不推理握手。
- [x] completed：归属lint、typecheck、docs与独立审查。最终74文件742测试通过，最后目录边界79项再验；源码正式交接后只读等待。证据以最终handoff为准。

## 接口协调

会话代理向父窗口提供 draft 更新／恢复和 workspace binding API，保留外部 `setComposerDraft` 发起操作语义；父窗口修改 Composer，不由代理编辑。

源代理向父窗口提供显式文件／目录选择、授权检索读取的 API 与 source revision 验证入口；不修改 Composer、AI store 或共享 searchable-text/pdf-item。

原生代理提供 runtime transport／event 类型、probe/connect/session/turn/interrupt/approval API 和 command 精确注册清单；不修改 main.rs、Composer 或其他 store。

所有代理写单独证据片段，由父窗口审查合入最终交接。发现跨归属需要只提出精确接口请求。
