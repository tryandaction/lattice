# AI Provider Profiles 与协议扩展实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 让 Lattice 支持多 profile、多协议和专业连接诊断，同时兼容现有 AI 设置。

**Architecture:** Profile metadata 由独立 store 持久化，secret 由 profile-scoped key storage 保存；协议适配器将各厂商请求/响应归一化为既有 `AiProvider` contract；provider resolver 优先解析 profile，旧 provider 设置自动回退到内置 profile。

**Tech Stack:** TypeScript、Zustand、Fetch/SSE、React、Vitest、Testing Library、Next.js。

**Spec:** `docs/superpowers/specs/2026-08-31-ai-provider-profiles-protocols.md`

## Global Constraints

- 不升级依赖。
- 不暴露 API Key。
- 不改变现有 `AiProvider` 调用方契约。
- 不自动执行远程 MCP 工具。
- 不部署、不上传、不执行 Git commit/push。

---

### Task 1: 类型、预设与诊断模型

**Files:**
- Modify: `src/lib/ai/types.ts`
- Create: `src/lib/ai/provider-profiles.ts`
- Test: `src/lib/ai/__tests__/provider-profiles.test.ts`

- [ ] 写失败测试：预设覆盖渠道、协议和认证方式；诊断错误不含密钥。
- [ ] 运行测试确认失败。
- [ ] 增加 `AiProtocol`、扩展 `AiProviderId`、`AiProviderProfile` 和诊断字段。
- [ ] 实现预设、协议归一化和 `classifyAiConnectionError`。
- [ ] 运行测试确认通过。

### Task 2: Profile-scoped secret storage 与 store

**Files:**
- Modify: `src/lib/ai/key-storage.ts`
- Create: `src/stores/ai-provider-profile-store.ts`
- Test: `src/lib/ai/__tests__/profile-key-storage.test.ts`
- Test: `src/stores/__tests__/ai-provider-profile-store.test.ts`

- [ ] 写失败测试：profile key 与旧 provider key 隔离、迁移可恢复、清理不残留。
- [ ] 运行测试确认失败。
- [ ] 实现 profile key/url/header storage、metadata store、CRUD、默认 profile 和旧设置迁移。
- [ ] 运行测试确认通过。

### Task 3: Protocol adapters and profiled OpenAI-compatible provider

**Files:**
- Create: `src/lib/ai/protocol-adapters.ts`
- Modify: `src/lib/ai/providers/openai-compatible.ts`
- Modify: `src/lib/ai/providers/index.ts`
- Test: `src/lib/ai/__tests__/protocol-adapters.test.ts`
- Test: `src/lib/ai/__tests__/profiled-provider.test.ts`

- [ ] 写失败测试：Chat Completions、Responses、SSE delta、Models list 和 HTTP/CORS/timeout 诊断。
- [ ] 运行测试确认失败。
- [ ] 实现 adapter contract、profile provider factory、预设渠道解析和 profile resolver。
- [ ] 运行测试确认通过。

### Task 4: Runtime routing compatibility

**Files:**
- Modify: `src/lib/ai/model-router.ts`
- Modify: `src/lib/ai/orchestrator.ts`
- Modify: `src/lib/ai/research-agent-planner-provider.ts`
- Modify: `src/lib/ai/types.ts`
- Test: `src/lib/__tests__/ai-orchestrator.test.ts`
- Test: `src/lib/__tests__/ai-model-router.test.ts`

- [ ] 写失败测试：带 profileId/protocol 的请求优先 profile，旧设置继续走旧 provider。
- [ ] 运行测试确认失败。
- [ ] 接入 profile resolver，保留旧 provider fallback，并传递 timeout/retry/signal。
- [ ] 运行测试确认通过。

### Task 5: Professional settings UI and MCP configuration foundation

**Files:**
- Create: `src/components/settings/ai-provider-profiles-panel.tsx`
- Create: `src/lib/ai/mcp-config.ts`
- Modify: `src/components/settings/settings-dialog.tsx`
- Modify: `src/lib/i18n/zh-CN.ts`
- Modify: `src/lib/i18n/en-US.ts`
- Test: `src/components/settings/__tests__/ai-provider-profiles-panel.test.tsx`
- Test: `src/lib/ai/__tests__/mcp-config.test.ts`

- [ ] 写失败测试：新增/复制/删除/默认 profile、刷新模型、连接诊断分层展示和 MCP server 配置校验。
- [ ] 运行测试确认失败。
- [ ] 实现分区设置 UI，保留现有设置兼容入口；敏感字段使用密码输入和 profile scope。
- [ ] 运行测试确认通过。

### Task 6: Browser, full QA and desktop release

- [ ] 运行受影响测试、typecheck、lint、docs。
- [ ] Browser 验证 profile 创建、模型刷新、连接错误诊断、窄屏设置布局。
- [ ] 运行 `npm run qa:gate`。
- [ ] 运行 `npm run tauri:build`，必要时外部网络权限用于 WebView2 bootstrapper。
- [ ] 更新 `releases/v2.3.2` 并核对 manifest/checksums。
