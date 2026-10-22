# AI Review Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. AGENTS.md prohibits git commit/push unless explicitly requested, so commit steps are intentionally omitted.

**Goal:** Replace the stacked bottom Inspector with a mutually exclusive, full-height Review Workspace and make evidence navigation reliable for nested workspace roots.

**Architecture:** `AIWorkspaceShell` exposes one content slot that renders either Conversation or Review. `AgentInspector` becomes a full-height review surface and renders nothing while closed; `AgentStatusStrip` owns the single manual Review entry. Workspace navigation receives root candidates with path prefixes so handle-relative resolution and canonical workspace paths remain distinct.

**Tech Stack:** React 19, Next.js, TypeScript, Zustand, Vitest, Testing Library, Tailwind utilities, existing link router and PDF highlighter.

---

## 文件边界

- Modify: `src/components/ai/ai-workspace-shell.tsx` — render one mutually exclusive body instead of timeline + inspector + composer stacking.
- Modify: `src/components/ai/agent-inspector.tsx` — full-height Review Workspace; no closed-state footer.
- Modify: `src/components/ai/agent-status-strip.tsx` — single Review entry and approval badge callbacks.
- Modify: `src/components/ai/ai-chat-panel.tsx` — select Conversation or Review mode and preserve review triggers.
- Modify: `src/components/ai/evidence-panel.tsx` — compact evidence state and inline navigation error.
- Modify: `src/lib/link-router/navigate-link.ts` — root candidates carry optional path prefixes.
- Modify: `src/stores/workspace-store.ts` only if a small selector is needed to expose registered root candidates.
- Test: `src/components/ai/__tests__/ai-chat-panel.test.tsx`, `src/components/ai/__tests__/evidence-panel.test.tsx`, `src/lib/link-router/__tests__/navigate-link.test.ts`.

### Task 1: Lock the non-stacking shell contract

- [ ] Add a failing `AiChatPanel` test that opens an evidence citation and asserts `ai-chat-message-frame` and `chat-composer` are absent while `agent-review-workspace` is present.
- [ ] Add a failing test that the closed state contains a single `agent-status-open-review` control and no `agent-inspector` or `agent-inspector-tab-*` elements.
- [ ] Run `npm run test -- src/components/ai/__tests__/ai-chat-panel.test.tsx --run`; expect the new assertions to fail because the current shell renders timeline, inspector, and composer together.
- [ ] Change `AIWorkspaceShell` to accept a single `body` node and render `header`, `status`, `body` only.
- [ ] In `AiChatPanel`, build `conversationBody` with timeline + composer and `reviewBody` with `AgentInspector`; select one using `inspectorOpen`.
- [ ] Run the same test and expect the new shell assertions to pass.

### Task 2: Convert AgentInspector into full-height Review Workspace

- [ ] Add failing assertions that closed `AgentInspector` renders nothing and open Review contains `min-h-0`, `flex-1`, and `overflow-y-auto` without `max-h-[min(34rem,58dvh)]`.
- [ ] Run the component tests and confirm RED.
- [ ] Replace the footer-style section with `data-testid="agent-review-workspace"`, a compact Review header, tablist, and a flexing body.
- [ ] Use Back/Close icon buttons with `aria-label`, `title`, and stable test ids; preserve tab counts and amber approval treatment.
- [ ] Run `AiChatPanel` and Inspector-related tests and confirm GREEN.

### Task 3: Add one restrained Review entry

- [ ] Add a failing test that `AgentStatusStrip` exposes exactly one manual Review control and that approval count remains separately visible and opens Trace.
- [ ] Run the test and confirm RED because only the approval button exists today.
- [ ] Add `onOpenReview` to `AgentStatusStrip`; render one icon-only Review button with tooltip/test id, followed by the approval badge only when pending approvals are non-zero.
- [ ] Wire Review to the last active tab, defaulting to Evidence when evidence exists and Trace otherwise.
- [ ] Confirm Conversation mode no longer renders four permanent review buttons.

### Task 4: Fix nested workspace-root navigation

- [ ] Add a failing `navigateLink` test with root handle `essay`, registered prefix `atom/Theoretical Research/taiyi/essay`, and target `atom/Theoretical Research/taiyi/essay/paper.pdf#page=3`.
- [ ] Assert the handle resolves `paper.pdf`, while `openFileInPane` and pending navigation use the canonical target path.
- [ ] Run `npm run test -- src/lib/link-router/__tests__/navigate-link.test.ts --run`; confirm RED because the current resolver tries `essay/atom/...`.
- [ ] Introduce `WorkspaceRootCandidate { handle, pathPrefix? }`; strip only a complete normalized prefix before traversing a candidate handle.
- [ ] Keep existing `rootHandle`/`rootHandles` compatibility and external/system URL behavior unchanged.
- [ ] Pass candidates from `workspaceRootPath` and `workspaceRootHistory` in `EvidencePanel`.
- [ ] Run link-router and Evidence tests and confirm GREEN.

### Task 5: Replace blocking evidence errors with inline recovery

- [ ] Add a failing EvidencePanel test that failed navigation does not call `toast.error` and renders `evidence-navigation-error` containing only basename plus a retry button.
- [ ] Run the test and confirm RED because `handleNavigate` currently calls the global toast.
- [ ] Store navigation failure in component state keyed by locator; clear it on retry, source change, and successful navigation.
- [ ] Render the compact error adjacent to the active source details; keep the full path in `title` only.
- [ ] Run EvidencePanel tests and confirm GREEN.

### Task 6: Compact the default Evidence Review

- [ ] Add failing tests that Reference Tree and Draft/Proposal/Template actions are collapsed behind an explicit details control on initial open.
- [ ] Run the tests and confirm RED.
- [ ] Render selected evidence summary, citation quote, page and annotation review first; move ReferenceBrowser and batch actions into a native disclosure section.
- [ ] Keep `PdfCompanionReview` above the details section only when transient annotations exist.
- [ ] Confirm long paths use basename/ellipsis and do not create horizontal overflow.

### Task 7: Responsive and product verification

- [ ] Extend layout tests to assert the AI Companion remains 32–52% on desktop and the Review surface itself has no fixed pixel width or bottom anchoring.
- [ ] Run focused tests: `npm run test -- src/components/ai/__tests__/ai-chat-panel.test.tsx src/components/ai/__tests__/evidence-panel.test.tsx src/lib/link-router/__tests__/navigate-link.test.ts src/components/layout/__tests__/desktop-workbench-layout.test.ts --run`.
- [ ] Run `npm run qa:agent-smoke -- --unit-only`, `npm run typecheck`, and `npm run test:docs`.
- [ ] Start a local server and verify Conversation/Review switching, citation navigation, inline failure, Composer restoration, pending approval, desktop layout and narrow-window layout.
- [ ] Run `npm run qa:gate`, then `node scripts/prepare-release.mjs --skip-qa` to refresh `releases/v2.3.1` locally.
- [ ] Do not install the generated package, deploy, commit, or push without explicit user confirmation.

