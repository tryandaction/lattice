# AI Workbench Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Lattice AI workbench gaps so answers, evidence navigation, persistence, approvals, scheduling, and responsive review workflows behave as one reliable product.

**Architecture:** Keep provider adapters, domain contracts, stores, and UI surfaces separated. Normalize data once at each boundary, retain legacy fields for compatibility, and route all write-capable or scheduled work through the existing policy/approval/trace infrastructure. The current window owns functionality, tests, and browser verification; build, release packaging, installation, and deployment remain outside this plan.

**Tech Stack:** React 19, Next.js 16, TypeScript, Zustand, Vitest, Testing Library, Playwright/in-app Browser, existing Lattice PDF.js and Tool Broker services.

**Spec:** `docs/AI_AGENT_WORKBENCH_PLAN.md`, `docs/AI_AGENT_SYSTEM_TODO.md`, `docs/superpowers/specs/2026-08-17-controlled-performance-and-evidence-navigation-design.md`, and the user-provided workbench closure requirements.

## Global Constraints

- Use the current repository stack and dependencies; do not install new dependencies.
- Keep all existing unrelated working-tree changes; do not reset, commit, push, deploy, or install the desktop product.
- Every new behavior starts with a failing test and is verified with a focused test before the next task.
- Chat remains direct-answer-first; Trace, Memory, Evidence, and Workbench remain on-demand review surfaces.
- All writes, memory persistence, runner execution, and scheduled actions remain policy/approval/trace governed.
- PDF evidence highlights are transient overlays and never write into the PDF or annotation sidecar without explicit confirmation.
- Build and release commands are intentionally excluded from this window.

---

### Task 1: Normalize Provider Responses and Streaming

**Files:**
- Create: `src/lib/ai/stream-accumulator.ts`
- Modify: `src/lib/ai/provider-response.ts`
- Modify: `src/lib/ai/providers/openai-compatible.ts`
- Modify: `src/lib/ai/providers/anthropic.ts`
- Modify: `src/lib/ai/providers/google.ts`
- Modify: `src/lib/ai/providers/ollama.ts`
- Modify: `src/lib/ai/orchestrator.ts`
- Modify: `src/components/ai/chat-composer.tsx`
- Test: `src/lib/ai/__tests__/provider-response.test.ts`
- Test: `src/lib/ai/__tests__/stream-accumulator.test.ts`
- Test: `src/lib/__tests__/ai-orchestrator.test.ts`

**Interfaces:**
- `extractProviderText(value: unknown): string` returns only final text content and never promotes reasoning fields.
- `extractStreamTextDelta(value: unknown): string` normalizes string and text-part deltas.
- `createAiStreamAccumulator()` exposes `append`, `finish`, `abort`, `hasText`, and `text` for one assistant request.
- `runGeneric` must complete with either non-empty text or a readable error/fallback and at most one empty-response retry.

- [ ] **Step 1: Write the failing tests** for text-part responses, reasoning-only responses, fragmented SSE events, stream errors, abort cleanup, and one final assistant boundary.
- [ ] **Step 2: Run the focused tests** and verify they fail because the accumulator and provider normalization are incomplete.
- [ ] **Step 3: Implement the minimal normalization and accumulator** and route every OpenAI-compatible/Anthropic/Google/Ollama stream through it without exposing reasoning content.
- [ ] **Step 4: Add the final non-empty boundary** to Chat and Research Agent result writes so citations cannot appear without readable answer text.
- [ ] **Step 5: Run provider/orchestrator/composer tests** and verify empty, retry, stream-error, and cancellation behavior.

### Task 2: Complete Citation and Navigation Contracts

**Files:**
- Modify: `src/lib/ai/citation-contract.ts`
- Modify: `src/lib/link-router/types.ts`
- Modify: `src/lib/link-router/path-utils.ts`
- Modify: `src/lib/link-router/navigate-link.ts`
- Modify: `src/stores/link-navigation-store.ts`
- Modify: `src/components/ai/chat-timeline.tsx`
- Modify: `src/components/ai/evidence-panel.tsx`
- Test: `src/lib/__tests__/citation-contract.test.ts`
- Test: `src/lib/link-router/__tests__/navigate-link-contract.test.ts`
- Test: `src/lib/link-router/__tests__/navigate-link.test.ts`
- Test: `src/components/ai/__tests__/evidence-panel.test.tsx`

**Interfaces:**
- `CitationContract` retains nested `location` and exposes `page`, `line`, `cell`, `heading`, and `annotation` aliases.
- `NavigationResult` contains `ok`, `success`, `requestId`, `status`, `target`, and optional `filePath`.
- `setPendingNavigation` returns the existing request ID when pane, file, and target are equivalent.

- [ ] **Step 1: Add failing tests** for fragment/query stripping, root aliases, nested roots, same-basename safety, stable citation tokens, and every structured navigation status.
- [ ] **Step 2: Run the focused citation/navigation tests** and confirm the missing behavior.
- [ ] **Step 3: Normalize canonical paths and source/passage identities** while preserving legacy navigation fields.
- [ ] **Step 4: Make pending navigation pane/file scoped and idempotent**; preserve structured failure outcomes for Retry/Open source/Copy reference.
- [ ] **Step 5: Verify citation chips, popovers, plain-text `4,2,2`, invalid AI links, and source-row deduplication.**

### Task 3: Close PDF Evidence Navigation and Transient Highlighting

**Files:**
- Modify: `src/lib/pdf-evidence-navigation.ts`
- Modify: `src/lib/ai/transient-pdf-annotations.ts`
- Modify: `src/stores/ai-pdf-companion-store.ts`
- Modify: `src/components/renderers/pdf-highlighter-adapter.tsx`
- Modify: `src/components/renderers/pdf-highlighter-adapter.css`
- Modify: `src/components/ai/pdf-companion-review.tsx`
- Modify: `src/components/ai/evidence-panel.tsx`
- Modify: `scripts/browser-regression.mjs`
- Test: `src/lib/__tests__/pdf-evidence-navigation.test.ts`
- Test: `src/lib/ai/__tests__/transient-pdf-annotations.test.ts`
- Test: `src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`
- Test: `src/components/ai/__tests__/pdf-companion-review.test.tsx`

**Interfaces:**
- `resolvePdfEvidenceSnippetTarget` returns page, bounded snippet, offsets, and normalized rects or `null`.
- The companion store owns transient annotations only and clears them on close, file change, replacement, and conversation deletion.
- Renderer consumption is bounded by document/page/pane identity and returns `page_not_ready`, `quote_not_found`, or `renderer_timeout` instead of retrying forever.

- [ ] **Step 1: Add failing tests** for pending navigation before renderer readiness, rect priority, quote fallback, multiline rects, timeout classification, replacement, and close cleanup.
- [ ] **Step 2: Run PDF focused tests** and confirm the failures are behavioral rather than fixture errors.
- [ ] **Step 3: Implement condition-based readiness waits** for document, page, text layer, and page metrics with bounded timeout and no permanent annotation writes.
- [ ] **Step 4: Render transient red dashed overlays** with deterministic `data-testid` and transient attributes, preserving selection and scroll behavior.
- [ ] **Step 5: Run the existing real-PDF browser diagnostics** when a fixture is available; record any fixture/environment limitation explicitly.

### Task 4: Harden Conversation Persistence and Recovery

**Files:**
- Modify: `src/stores/ai-chat-store.ts`
- Modify: `src/components/ai/ai-chat-panel.tsx`
- Modify: `src/components/ai/chat-timeline.tsx`
- Modify: `src/components/ai/agent-inspector.tsx`
- Test: `src/stores/__tests__/ai-chat-store.test.ts`
- Test: `src/components/ai/__tests__/ai-chat-panel.test.tsx`

**Interfaces:**
- `normalizePersistedConversations(value: unknown): ChatConversation[]` migrates legacy arrays/envelopes, filters corrupt and empty entries, and normalizes message metadata.
- Store actions include `newConversation`, `setActiveConversation`, `renameConversation`, `deleteConversation`, and `clearAllHistory`.
- Persisted writes are debounced and serialized so a late load cannot overwrite a live conversation.

- [ ] **Step 1: Add failing tests** for refresh recovery, schema migration, corrupt data, empty conversations, concurrent saves, rename/delete/clear, and Agent session linkage.
- [ ] **Step 2: Run store and component tests** to confirm the failures.
- [ ] **Step 3: Implement migration/recovery and cleanup semantics** while preserving the existing storage adapter.
- [ ] **Step 4: Keep the history UI compact** with keyboard-accessible switching, rename, delete, and clear actions.
- [ ] **Step 5: Verify conversation switching does not leak Evidence, Review, or transient PDF state.**

### Task 5: Make Memory and System Prompt Profiles Product-Complete

**Files:**
- Modify: `src/lib/ai/agent-memory.ts`
- Modify: `src/stores/agent-memory-store.ts`
- Modify: `src/components/ai/agent-memory-panel.tsx`
- Modify: `src/lib/ai/system-prompt-profile.ts`
- Modify: `src/types/settings.ts`
- Modify: `src/stores/settings-store.ts`
- Modify: `src/components/settings/settings-dialog.tsx`
- Modify: `src/components/ai/ai-chat-context.ts`
- Modify: `src/components/ai/chat-composer.tsx`
- Modify: `src/components/ai/selection-ai-hub.tsx`
- Test: `src/lib/__tests__/ai-agent-memory.test.ts`
- Test: `src/stores/__tests__/agent-memory-store.test.ts`
- Test: `src/lib/ai/__tests__/system-prompt-profile.test.ts`
- Test: `src/components/ai/__tests__/agent-memory-panel.test.tsx`
- Test: `src/components/settings/__tests__/settings-dialog.test.tsx`

**Interfaces:**
- Memory entries keep scope, provenance, status, confidence, source fingerprint, and bounded retrieval metadata.
- `resolveSystemPrompt(settings, mode)` resolves global, Chat, or Agent profile with deterministic fallback.
- Every assistant message stores the prompt profile and model/provider metadata used for that run.

- [ ] **Step 1: Add failing tests** for all memory scopes, bounded retrieval/token limits, forget/delete, pending suggestion approval, unavailable memory fallback, prompt save/cancel/restore, and actual profile selection.
- [ ] **Step 2: Run memory/system prompt focused tests** and confirm failures.
- [ ] **Step 3: Implement bounded memory lifecycle and profile persistence** without silent memory writes or API-key exposure.
- [ ] **Step 4: Replace hardcoded settings copy with existing i18n keys** and keep provider/model controls separate from prompt profiles.
- [ ] **Step 5: Verify new Chat and Agent messages use the updated profile while historical messages retain their original metadata.**

### Task 6: Implement Persistent Scheduled Tasks and Approval Boundaries

**Files:**
- Modify: `src/lib/ai/scheduled-tasks.ts`
- Create: `src/stores/scheduled-task-store.ts`
- Create: `src/components/ai/scheduled-task-panel.tsx`
- Modify: `src/components/ai/agent-inspector.tsx`
- Modify: `src/lib/ai/agent-policy.ts`
- Modify: `src/lib/ai/agent-tool-broker.ts`
- Test: `src/lib/ai/__tests__/scheduled-tasks.test.ts`
- Test: `src/stores/__tests__/scheduled-task-store.test.ts`
- Test: `src/components/ai/__tests__/scheduled-task-panel.test.tsx`

**Interfaces:**
- `ScheduledTaskStore` owns task records, run history, persistence, hydration recovery, and state transitions.
- Task execution requires a declared executor and policy decision; no scheduler may run shell/network/write actions implicitly.
- States are `active`, `paused`, `running`, `failed`, `completed`, and `deleted`; runs retain attempt, status, timestamps, summary, and error.

- [ ] **Step 1: Add failing tests** for persisted create/pause/resume/delete/run-now/retry, once/interval schedules, restart hydration, corrupt snapshots, approval-required writes/network, and run history.
- [ ] **Step 2: Run scheduled-task tests** and confirm no product store/UI exists yet.
- [ ] **Step 3: Implement persistent store hydration with schema versioning** using the existing storage adapter and a serialized write queue.
- [ ] **Step 4: Add the Scheduled Tasks inspector surface** with create, pause, resume, run now, retry, delete, status, and run-history controls.
- [ ] **Step 5: Wire scheduling through Agent Policy/Tool Broker/Trace** and show explicit approval before file writes, code execution, network, or memory writes.
- [ ] **Step 6: Verify offline/app-not-running behavior is visible and no background result is fabricated.**

### Task 7: Finish Chat/Agent/Review Interaction and Accessibility

**Files:**
- Modify: `src/components/ai/ai-chat-panel.tsx`
- Modify: `src/components/ai/ai-workspace-shell.tsx`
- Modify: `src/components/ai/agent-inspector.tsx`
- Modify: `src/components/ai/chat-composer.tsx`
- Modify: `src/components/ai/chat-timeline.tsx`
- Modify: `src/components/layout/app-layout.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/ai/__tests__/ai-chat-panel.test.tsx`
- Test: `src/components/ai/__tests__/agent-trace-panel.test.tsx`
- Test: `src/components/layout/__tests__/app-layout-ai-dock.test.tsx`
- Test: `scripts/__tests__/browser-regression.test.mjs`

**Interfaces:**
- Review surfaces are mutually exclusive with stable return-to-chat behavior.
- Composer remains mounted and reachable below Review on desktop and narrow screens.
- Mobile AI overlay covers the full viewport, restores focus to the invoking control, and never introduces horizontal scrolling.

- [ ] **Step 1: Add failing tests** for Composer visibility during Trace/Evidence/Workbench review, focus restoration, keyboard labels, narrow overlay dimensions, no overlap, and stable dock resize.
- [ ] **Step 2: Run UI tests** and record the current failures.
- [ ] **Step 3: Implement the smallest layout/accessibility corrections** using existing semantic components and lucide icons.
- [ ] **Step 4: Verify direct Chat remains compact while Agent review exposes plan/tool/approval/memory details only on demand.**
- [ ] **Step 5: Run desktop and 390x844 browser flows** for open AI, send two prompts, open citation/popover/source, open/close Evidence, open Trace approval, and return to Composer.

### Task 8: Non-Build Quality and Closure Verification

**Files:**
- Modify: `scripts/browser-regression.mjs` only for truthful/stable assertions discovered during Task 1-7.
- Test: all focused tests from Tasks 1-7.

- [ ] Run all focused AI/Citation/PDF/History/Memory/System Prompt/Scheduled Task/Review suites serially.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test:docs`.
- [ ] Run `npm run qa:agent-smoke -- --unit-only`.
- [ ] Run browser regression flows for AI Chat and Selection AI, plus the main-app mobile overlay flow.
- [ ] Record exact results for empty answers, consecutive prompts, all navigation statuses, source-row deduplication, invalid AI links, PDF transient frame lifecycle, history recovery, memory approval, system prompt profile, task pause/resume/failure, desktop layout, mobile layout, and horizontal overflow.
- [ ] Explicitly report that build, release refresh, installation, deployment, commit, and push were not performed in this window.

## Review Checklist

- [ ] No production change was made without a preceding failing test.
- [ ] No provider reasoning field is rendered as a final answer.
- [ ] No citation token links to a contract that is not present in the current message.
- [ ] No pending navigation can be consumed by the wrong pane or file.
- [ ] No transient PDF highlight is persisted as a user annotation without confirmation.
- [ ] No corrupted history or memory snapshot blocks ordinary Chat.
- [ ] No scheduled task can silently write files, call the network, execute code, or mutate memory.
- [ ] Composer remains available while Review is open.
- [ ] No build/release/deployment operation is claimed without a fresh command result.
