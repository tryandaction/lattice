# Lattice AI and Links Professionalization Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with TDD and verification checkpoints. Do not commit, push, or deploy.

**Goal:** Make AI connections, AI answer/agent evidence, and Markdown links truthful, persistent, protocol-correct, and browser-verifiable for the local `releases/v2.3.2` gate.

**Architecture:** Keep `AiProviderProfile` as the single persisted connection entity. Separate provider identity, transport protocol, endpoint/auth channel, and model catalog; use protocol adapters for all network requests. Reuse the existing evidence contract and link router so Chat, Agent, Markdown, PDF, Notebook, image, and web targets share one navigation path.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zustand, Vitest, Testing Library, Playwright/browser plugin, Tauri release scripts.

**Spec:** User-approved design in the conversation on 2026-09-02.

## Global Constraints

- No surface-only UI fixes; repair data flow and runtime boundaries.
- Write a failing test before every production behavior change and observe the expected failure.
- No fabricated model capability or citations; invalid/truncated/error states remain explicit.
- No `git commit`, `git push`, or deployment.
- Run `npm run qa:gate` before refreshing the local release.

---

### Task 1: Single AI Connection Persistence and Migration

**Files:**
- Modify: `src/stores/ai-provider-profile-store.ts`
- Modify: `src/lib/ai/provider-profiles.ts`
- Modify: `src/components/settings/ai-provider-profiles-panel.tsx`
- Modify: `src/components/settings/settings-dialog.tsx`
- Test: `src/stores/__tests__/ai-provider-profile-store.test.ts`
- Test: `src/components/settings/__tests__/ai-provider-profiles-panel.test.tsx`

**Interfaces:**
- Preserve `AiProviderProfile` and store actions used by existing consumers.
- Add a persisted model tombstone or equivalent deletion marker and a store action for remote catalog reconciliation.
- Keep provider and protocol independently editable; changing protocol must not infer a vendor model.

- [ ] Write failing tests for deleting a model, hydrating without reintroducing it, remote refresh reconciliation, explicit default-model changes, and protocol/vendor independence.
- [ ] Run the focused store and panel tests and confirm each new test fails for the missing behavior.
- [ ] Implement minimal normalization, migration, reconciliation, and panel wiring changes.
- [ ] Run the focused tests again and confirm they pass without changing unrelated settings behavior.
- [ ] Inspect settings dialog for duplicate provider controls and remove only the obsolete path.

### Task 2: Protocol-Truthful Model Discovery and Connection Tests

**Files:**
- Modify: `src/lib/ai/protocol-adapters.ts`
- Modify: `src/lib/ai/profiled-provider.ts`
- Modify: `src/lib/ai/provider-response.ts`
- Test: `src/lib/ai/__tests__/protocol-adapters.test.ts`
- Test: `src/lib/ai/__tests__/profiled-provider.test.ts`

**Interfaces:**
- `buildProtocolRequest`, `modelListUrl`, `parseProtocolResponse`, and `parseProtocolStream` remain the adapter boundary.
- `AiProvider.testConnection()` and `getAvailableModels()` must issue protocol-specific real requests and return structured failures.

- [ ] Add failing tests for Anthropic custom endpoints, Gemini model listing, Ollama listing, OpenAI Chat/Responses listing, malformed JSON/empty model responses, and auth headers.
- [ ] Run those tests to verify expected failures.
- [ ] Implement protocol-specific list/test requests, response validation, and truthful model metadata.
- [ ] Run the tests and refactor only after green.

### Task 3: Chat Context, Streaming, Stop/Retry, and Citation Truthfulness

**Files:**
- Modify: `src/lib/ai/context-builder.ts`
- Modify: `src/lib/ai/orchestrator.ts`
- Modify: `src/lib/ai/structured-response.ts`
- Modify: `src/components/ai/ai-chat-panel.tsx`
- Modify: `src/components/ai/chat-timeline.tsx`
- Test: `src/lib/__tests__/ai-context-graph.test.ts`
- Test: `src/lib/__tests__/ai-orchestrator.test.ts`
- Test: `src/components/ai/__tests__/ai-chat-panel.test.tsx`

**Interfaces:**
- Preserve `AiPromptContext`, `AiRunResult`, and evidence/citation contracts.
- Expose explicit loading, stopped, retrying, truncated, invalid-citation, and provider-error states to the UI.

- [ ] Add failing tests for context truncation reporting, stream cancellation, retry, malformed provider output, and citation filtering.
- [ ] Run focused tests to observe the failures.
- [ ] Implement the smallest runtime and UI changes needed for truthful state transitions.
- [ ] Verify focused tests and ensure existing Chat behavior remains green.

### Task 4: Agent Plans, Approvals, Progress, Recovery, and Evidence Links

**Files:**
- Modify: `src/lib/ai/agent-session.ts`
- Modify: `src/lib/ai/agent-tool-broker.ts`
- Modify: `src/lib/ai/agent-run-report-view-model.ts`
- Modify: `src/components/agent/agent-protocol-center.tsx`
- Modify: `src/components/ai/agent-inspector.tsx`
- Test: `src/lib/__tests__/ai-agent-session.test.ts`
- Test: `src/lib/__tests__/ai-agent-tool-broker.test.ts`
- Test: `src/components/agent/__tests__/agent-protocol-center.test.tsx`

**Interfaces:**
- Preserve existing session, proposal, approval, tool-broker, and evidence types.
- Every step must retain status, recoverable error, evidence refs, and planned-write preview.

- [ ] Add failing tests for approval gating, resumable tool errors, file/PDF evidence links, and change previews.
- [ ] Run focused tests and verify expected failures.
- [ ] Implement minimal state/event persistence and rendering changes.
- [ ] Run focused tests and inspect evidence navigation contracts.

### Task 5: Markdown Link Single-Click Navigation and Double-Click Editing

**Files:**
- Modify: `src/components/editor/codemirror/live-preview/widgets.ts`
- Modify: `src/components/editor/codemirror/live-preview/live-preview-editor.tsx`
- Modify: `src/components/renderers/markdown-renderer.tsx`
- Modify: `src/components/renderers/app-markdown-link.tsx`
- Modify: `src/lib/link-router/parse-link-target.ts`
- Modify: `src/lib/link-router/navigate-link.ts`
- Test: `src/components/editor/codemirror/live-preview/__tests__/inline-markdown-rendering.test.ts`
- Test: `src/components/renderers/__tests__/markdown-renderer.test.tsx`
- Test: `src/lib/link-router/__tests__/navigate-link-contract.test.ts`

**Interfaces:**
- Keep `parseLinkTarget`, `navigateLinkDetailed`, and `navigateLinkWithFeedback` as the shared routing boundary.
- Single click navigates once; double click enters the correct source range and suppresses duplicate navigation.

- [ ] Add failing tests for same-file headings, cross-file headings, workspace absolute/relative files, PDF page/annotation, image, Notebook, web URLs, invalid links, and click/double-click ordering.
- [ ] Run the tests and confirm failures are behavioral rather than setup errors.
- [ ] Implement event arbitration and any missing target parsing/navigation behavior.
- [ ] Run focused tests, then browser-test the real editor and renderer flows.

### Task 6: Full Quality Gate and Local Release Refresh

**Files:**
- Modify only files required by failing checks.
- Refresh: `releases/v2.3.2/` via the repository release script.

- [ ] Run `npm run test:run`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test:docs`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run qa:gate` and resolve deterministic failures.
- [ ] Start the local app and run browser checks for settings, Chat/Agent, and Markdown link interactions at desktop and mobile viewports.
- [ ] Run `node scripts/prepare-release.mjs --skip-qa` only after `qa:gate` passes.
- [ ] Verify `git status` confirms no commit/push/deploy was performed.
