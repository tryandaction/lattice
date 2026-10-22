# Lattice 简洁 AI 与云端工作流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将云端共享库和 AI 本机接入收敛为普通用户一看就会的连接、上传、来源和模型流程，并保持高级诊断与可靠回退能力。

**Architecture:** 在现有 Supabase/R2 云库和 Tauri Harness 桥接之上增加两个纯归一化层：连接邀请解析器和本机工具发现器。UI 只消费归一化状态；高级连接字段、PATH、协议和权限信息留在折叠区或诊断页。上传继续使用现有持久化队列，Harness 继续由原生进程管理。

**Tech Stack:** React 19, Zustand, Next.js 16, Vitest, Tauri 2, Rust, existing Supabase/R2 and Harness protocol.

**Spec:** `docs/superpowers/specs/2026-10-09-simple-ai-cloud-ux-design.md`

## Global Constraints

- 主流程不得要求用户填写 Worker URL、Supabase URL、公开 key、PATH 或模型 ID。
- 显式本机可执行文件优先；自动发现只读，不修改系统环境变量。
- 未验证的 DeepSeek Harness 不得显示为可用本机 Harness。
- 云库上传必须保留逐文件失败、重试和离线队列语义。
- `npm run qa:gate` 是发布前必需门禁；不执行 git commit/push。

---

### Task 1: 连接邀请与配置文本解析（completed）

**Files:**
- Modify: `src/lib/shared-library/connection.ts`
- Test: `src/lib/shared-library/__tests__/connection.test.ts`

**Interfaces:**
- Produce `parseCloudConnectionInput(value: string): Partial<CloudLibraryConnection> | null`.
- Accept a Lattice invite URL with encoded `api`, `supabase`, `key`, `name` query parameters and a JSON text object containing the same public fields.
- Reject service-role/secret keys by reusing `validateCloudConnection`.

- [ ] **Step 1: Write failing tests** for invite URL parsing, JSON text parsing, malformed input returning null, and secret key rejection.
- [ ] **Step 2: Run `npx vitest run src/lib/shared-library/__tests__/connection.test.ts --maxWorkers=1` and verify the new parser tests fail because the parser is absent.
- [ ] **Step 3: Implement the parser** with URL-safe decoding, JSON fallback, and no network calls.
- [ ] **Step 4: Run the focused test and typecheck; verify all parser cases pass.**

### Task 2: Simplified cloud connection UI（completed）

**Files:**
- Modify: `src/components/shared-library/cloud-connection-panel.tsx`
- Test: `src/components/shared-library/__tests__/cloud-connection-panel.test.tsx`

**Interfaces:**
- Add one `textarea`/input labelled `云库邀请链接或配置`.
- Add `解析并连接` action that calls `parseCloudConnectionInput` and existing `onSave`/`onLogin` flow.
- Keep current field editor behind a `高级连接设置` disclosure.

- [ ] **Step 1: Write failing component tests** for the compact first view, successful invite parsing populating and saving a connection, malformed input showing a short error, and advanced fields remaining accessible.
- [ ] **Step 2: Run the focused component tests and confirm they fail against the current multi-field-first UI.**
- [ ] **Step 3: Implement the compact panel** while retaining current validation and login semantics.
- [ ] **Step 4: Run component tests and existing shared-library tests.**

### Task 3: Unified upload queue entry（completed）

**Files:**
- Modify: `src/components/shared-library/cloud-library-workspace.tsx`
- Test: `src/components/shared-library/__tests__/cloud-library-workspace.test.tsx`

**Interfaces:**
- Add visible `上传文件` and `上传文件夹` controls at the top of the active library.
- Reuse `prepareImport`/`importFiles`; render queue status as one compact region with per-file retry affordance.
- Keep library/member/admin actions in a secondary overflow/disclosure area.

- [ ] **Step 1: Add failing tests** for the visible upload actions, drag/drop transfer into the existing import queue, and failure text with retry action.
- [ ] **Step 2: Run the focused tests and verify missing controls/status fail.**
- [ ] **Step 3: Implement the compact upload toolbar and queue view without changing storage protocol.**
- [ ] **Step 4: Run focused cloud UI tests and the existing cloud protocol suite.**

### Task 4: Native tool discovery and model capability normalization（completed）

**Files:**
- Create: `src/lib/ai/harness/discovery.ts`
- Test: `src/lib/ai/harness/__tests__/discovery.test.ts`
- Modify: `src/lib/ai/harness/types.ts`
- Modify: `src/lib/ai/harness/transport.ts`
- Modify: `src-tauri/src/agent_harness.rs`

**Interfaces:**
- Add `HarnessDiscoveryCandidate`, `HarnessModelOption`, and `discoverHarnesses()` client-facing types.
- Extend probe result with `models: HarnessModelOption[]`, `authStatus: "ready" | "login-required" | "unknown"` and `displayName`.
- Add native command `agent_harness_discover` returning candidates for Codex and Claude; DeepSeek remains unsupported unless a verified protocol is present.
- Candidate precedence: saved executable, Windows known user install locations, then PATH.

- [ ] **Step 1: Write failing pure tests** for precedence, de-duplication, unknown executable handling, model option normalization, and unsupported DeepSeek result.
- [ ] **Step 2: Run the focused discovery tests and verify failure.**
- [ ] **Step 3: Implement the pure discovery normalization layer.**
- [ ] **Step 4: Add/extend Rust native discovery output and Tauri registration.**
- [ ] **Step 5: Run TypeScript discovery tests, Rust focused harness tests, and `cargo check`.**

### Task 5: Compact AI source/model selector（completed）

**Files:**
- Modify: `src/components/ai/agent-runtime-settings.tsx`
- Modify: `src/components/ai/chat-composer.tsx`
- Test: `src/components/ai/__tests__/agent-runtime-settings.test.tsx`
- Test: `src/components/ai/__tests__/chat-composer.test.tsx`

**Interfaces:**
- Replace the main `运行环境` block with compact `AI 来源` and `模型` selectors.
- Keep `AgentRuntimeSettings` as an advanced disclosure containing executable picker, probe diagnostics, protocol and permission details.
- Use existing API profile models and native probe models in one `modelOptions` list.
- Add a fallback status when local discovery fails; do not erase saved config.

- [ ] **Step 1: Write failing UI tests** for compact selectors, no visible runtime block in the main toolbar, model options from API/local sources, automatic fallback, and advanced diagnostics disclosure.
- [ ] **Step 2: Run focused tests and verify the old large runtime UI fails the new assertions.**
- [ ] **Step 3: Implement selectors and state wiring** while preserving existing conversation and Harness stores.
- [ ] **Step 4: Run focused AI tests and existing Harness store/protocol tests.**

### Task 6: Persistence and recovery behavior（completed）

**Files:**
- Modify: `src/stores/ai-harness-store.ts`
- Modify: `src/lib/ai/harness/transport.ts`
- Test: `src/lib/ai/harness/__tests__/store.test.ts`

**Interfaces:**
- Hydrate saved source and model on startup.
- Re-probe silently on desktop startup; preserve saved executable/model when probe fails.
- If local Harness connect fails, expose `fallbackAvailable: true` without mutating the API profile.
  Ruling: render an explicit API switch from probe availability; never silently replay a user request to a different provider. Preferences are retained independently per engine.

- [ ] **Step 1: Add failing store tests** for restart hydration, probe failure preserving config, local-to-API fallback status, and model selection persistence.
- [ ] **Step 2: Run focused tests and verify current store behavior fails at least the fallback/persistence cases.**
- [ ] **Step 3: Implement recovery state and non-destructive probing.**
- [ ] **Step 4: Run store, protocol, and UI tests together.**

### Task 7: Product QA and release（completed）

**Files:**
- Modify: `docs/tests/2026-10-09-simple-ai-cloud-ux.md`

- [x] **Step 1: Run focused cloud and AI tests.**
- [x] **Step 2: Run `npm run typecheck` and `npm run test:docs`.**
- [x] **Step 3: Run `npm run qa:gate`.**
- [x] **Step 4: Run installed desktop smoke for compact connection/source/model flows.**
- [x] **Step 5: Run `node scripts/prepare-release.mjs --skip-qa --artifacts-dir src-tauri/target/release --output-dir releases/v3.1.0-simple-ux-20261009` and install the generated NSIS package locally.**
- [x] **Step 6: Verify installed version/hash and document any external-service boundary.**

## Execution Ledger

- Tasks 1–3 completed: paste parser, advanced connection disclosure, complete invitation export/import and account acceptance, direct file/folder upload, scoped local retry and durable sync states. Cloud lib/UI suite: 32 files/200 tests; follow-up recovery suite: 5 files/27 tests.
- Task 4 completed: native discovery covers user bin, bundled desktop binaries, editor extension binaries and npm native packages before PATH. At most 3 candidates and a 50-second total budget. Real Codex and Claude metadata read without inference: 8 and 4 models, both auth ready. Native focused tests: 26 passed/2 ignored, explicitly invoked metadata test passed.
- Tasks 5–6 completed: one source/model toolbar, modal advanced settings, API settings direct tab, per-engine preferences, deduplicated discovery, preservation on failure, executable-bound connection reuse, and old-connection replacement without cancelling the new turn. AI/settings focused suite: 99 tests; extra source switch regression: 11 store tests.
- Browser verification completed: 1280x820 and 390x844, compact selector controls remain in viewport, dialog does not resize composer, draft retained, no runtime errors. Dedicated two-profile cloud browser gate passed against real HTTP/Postgres RLS with local Auth/R2 fixtures.
- Task 7 completed: full qa:gate passed, 470 files/3875 tests; desktop package refreshed and installed; installed binary/hash verified. Real product fresh-process acceptance passed with 8 Codex models/4 Claude models, source-specific model preferences and full draft retained, toolbar height about 41px, no inference calls or user configuration changes.

The implementation intentionally uses `ai-chat-panel.test.tsx` for integrated composer coverage; no separate `chat-composer.test.tsx` is needed. No branch, git commit, push or remote deployment was performed.
