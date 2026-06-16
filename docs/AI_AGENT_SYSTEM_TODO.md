# AI Agent System Todo

Last updated: 2026-06-09

This is the implementation master checklist for Lattice AI Agent work. It turns `AI_AGENT_WORKBENCH_PLAN.md` into executable product tasks and prevents one-off, piecemeal development.

## Phase Numbering Contract

P0-P5 are the sequential Research Agent product track and match the roadmap in `AI_AGENT_WORKBENCH_PLAN.md`:

- P0: real product entry.
- P1: trace and plan UI convergence.
- P2: controlled multi-step tool loop.
- P2.5: runner approval closure and interaction simplification.
- P3: memory and long-context strategy.
- P4: workflow presets and productized research workflows.
- P5: proactive suggestions and production hardening.

P6 is a horizontal Lattice Product Skills Adaptation Backlog from the user-provided Lattice adaptation prompt. It is intentionally kept in this TODO because it contains concrete implementation packages, but it is not the current sequential phase unless explicitly scheduled. P6 items should be pulled into the active phase when they support it. Example: P6.4 workflow preset registry supports P4 workflow productization; PDF-scoped P6.1/P6.2 remain for the separate PDF window.

## Scope

In scope for this thread:

- AI Chat / dock panel agent integration.
- Research Agent orchestration over markdown, notes, notebooks, workspace index, runner output, memory, evidence, drafts, and proposals.
- Planner, context pack, Tool Broker, Trace, Memory, Workbench, and provider integration.
- Product benchmarking against professional agent systems where it affects Lattice implementation.
- Current active work: P5 production hardening is in closeout, and selected P6 current-thread Lattice Product Skills slices are now scheduled where they directly improve the Research Agent main path. P6 remains horizontal; PDF-scoped P6.1/P6.2 stay assigned to the separate PDF window.

Out of scope for this thread:

- PDF-specific feature development. PDF work is handled in a separate window.
- Direct implementation of PDF item workspace, PDF annotation writeback, and PDF visual/browser projection. These are tracked below as Lattice Product Skills backlog items for the PDF window.
- Git commit, branch, push, or release packaging unless explicitly requested.
- Direct shell/network/automation agent capabilities beyond current denied policy.

## Current Real State

Completed infrastructure:

- AI Chat right dock with Evidence Panel, Prompt Templates, mentions, drafts, proposals, and writeback workflow.
- Selection AI and Workbench draft/proposal main path.
- `AgentSession`, `agent-session-store`, session persistence, trace events, approval state, compaction.
- `AgentCapabilityPolicy` with conservative profiles.
- `AgentToolBroker` as the only agent tool execution path.
- Tool coverage for `workspace.search`, `workspace.readIndexedContext`, `evidence.resolve`, `workbench.createDraft`, `workbench.createProposal`, and `runner.runCode`.
- Runner approval closure through Trace panel approval replay.
- `AgentMemory` model, store, scoped memory UI, pin/disable/delete/restore behavior.
- `AgentContextPack` with source budgets, explicit evidence, active file, selection, workspace chunks, memory entries, and heavy inputs.
- Workspace summary cache.
- Formal `runResearchAgent` orchestration entry point.
- Research Agent planner schema, core step validation, supported tool-name validation, fallback-to-default behavior.
- LLM planner adapter: prompt builder, fenced/plain JSON parser, schema normalization, fallback warnings.
- Provider adapter: `createResearchAgentPlannerGenerate(settings)` to bridge `AiRuntimeSettings + routeModel` into planner `generatePlan`.
- AI Chat Research Agent product action that collects current context and writes a traceable answer back to chat.
- `runResearchAgentForChat` helper for planner routing, deterministic fallback, chat answer formatting, and model metadata.
- Selection AI `agent` mode now starts the formal Research Agent path through the shared surface runner and writes back to AI Chat with selection origin metadata.
- Mock research wrapper retained only for compatibility.

Not yet product-complete:

- Command surfaces do not yet start the real `runResearchAgent` path.
- Agent answers are written back into AI Chat and now have a lightweight structured result view for Research Agent runs via `agentResult` metadata, including a compact Open trace action that activates the matching Agent Session for audit. Partial remaining work: this is still an in-chat result view rather than a dedicated full Agent result page. Trace Panel also shows a compact derived Run Summary for workflow, plan, tools, evidence, approvals, omitted context, and memory suggestions.
- Trace UI does not yet render plan steps, planner source, warnings, or raw planner output in a dedicated plan view.
- Planner steps are currently execution metadata, not a real multi-step tool loop that can choose and run arbitrary allowed tools step by step.
- Approval after draft/proposal/code execution does not yet resume a larger agent loop beyond replaying the pending tool request.
- Memory auto-write policy first slice is implemented: Research Agent surface runs can generate memory candidates, dedupe them by title/scope and source fingerprint, but actual `memory.write` persists only after Tool Broker approval.
- Long-context compression now includes deterministic omitted-context summaries, provider-backed optional model-generated omitted summaries with deterministic fallback, extractive auto summaries, semantic previews, bounded recovery hints, retained-event cues, source-kind cues, and structured continuation prompts that can fill AI Chat or be copied in `AgentContextPack` plus Research Agent trace/compaction metadata. Model summaries now also receive deterministic quality audit metadata; remaining work is broader answer-synthesis use of recovered context and long-run memory policy refinement.
- Tool schema/result UI is typed in code and now has a lightweight Tool Broker descriptor registry plus a stable result schema envelope. Trace Details, pending approval cards, and recent Approval results render descriptor metadata as structured Tool contract / Result contract details, while tool-result events expose result status, summary, metrics, artifacts, and diagnostics in a compact Result schema card. A fuller production-grade schema/result inspector remains future work.
- Workflow presets for markdown research, notebook analysis, knowledge organization, and teaching are wired into the shared Research Agent surface runner. AI Chat now defaults to automatic workflow inference through a compact Chat / Agent mode switch, Selection AI agent mode infers a workflow from the selection source, and Command Palette entries can still open AI Chat with a selected non-PDF workflow preset for advanced use.

## P0: Real Research Agent Product Entry

Goal: make one user action start a real Research Agent run and return a traceable, evidence-backed result in the product.

Tasks:

- Add a product-facing Research Agent action in AI Chat. Done: `src/components/ai/ai-chat-panel.tsx`.
- Add a product-facing Research Agent action for Selection AI where source kind is markdown/code/notebook/text. Done for Selection AI `agent` mode.
- Build a small input collector that gathers task, query, active file path, active content, selection, explicit evidence refs, workspace key, workspace index, memory query, and runtime settings. Done for AI Chat current file/selection/evidence/workspace/runtime settings.
- Use `createResearchAgentPlannerGenerate(settings)` when AI is enabled and a provider is configured. Done in the shared surface runner.
- Call `runResearchAgent` with `generatePlan`, not raw provider calls. Done in the shared surface runner.
- Write the `runResearchAgent` answer back as an assistant chat message with evidence refs and prompt context. Done for AI Chat and Selection AI agent mode.
- Open/focus Evidence Panel and Trace Panel for the new run. Partial: Trace Panel is mounted and the new session is activated by `AgentSessionStore`; Evidence metadata is written to chat.
- Surface planner fallback warnings in the chat result or trace summary. Done in chat formatted answer and trace warnings.
- If no provider is configured, run the deterministic default plan and surface that the planner model was skipped. Done in `runResearchAgentForChat`.
- Preserve approval gating for draft/proposal/code tools.

Acceptance:

- From AI Chat, a user can run Research Agent on current file/selection and see an assistant answer.
- The answer includes evidence refs when context exists.
- A new Agent Session appears in Trace Panel.
- Plan source is visible at least in trace metadata or a summary UI.
- Planner failure does not fail the run; it falls back to deterministic planning.
- Draft/proposal requests remain approval-gated.

Suggested code areas:

- `src/components/ai/ai-chat-panel.tsx`
- `src/lib/ai/research-agent.ts`
- `src/lib/ai/research-agent-planner-provider.ts`
- `src/stores/ai-chat-store.ts`
- `src/components/ai/agent-trace-panel.tsx`

Verification:

- Unit/component tests for Chat entry and fallback.
- `npx vitest run "src/lib/__tests__/ai-research-agent*.test.ts" "src/components/ai/__tests__/ai-chat-panel.test.tsx" --maxWorkers=2`
- `npm run typecheck`

Status:

- AI Chat entry completed on 2026-06-07.
- Selection AI agent mode entry completed on 2026-06-07.
- Added `src/lib/ai/research-agent-chat-runner.ts`.
- Added `src/lib/__tests__/ai-research-agent-chat-runner.test.ts`.
- Updated `src/components/ai/__tests__/ai-chat-panel.test.tsx` to cover Chat button trigger and evidence-backed metadata.
- Updated `src/lib/ai/selection-actions.ts` so `mode === "agent"` calls `runResearchAgentForSurface`.
- Updated `src/lib/__tests__/selection-actions.test.ts` to cover Selection AI Research Agent routing and chat metadata writeback.
- Added AI Chat browser smoke coverage for AI Chat -> Research Agent -> Trace/Evidence on 2026-06-07.
- Added `src/components/diagnostics/ai-chat-research-agent-diagnostics.tsx` and `src/app/diagnostics/ai-chat-research-agent/page.tsx`.
- Added Selection AI browser smoke coverage for Selection AI -> Research Agent -> Chat/Trace/Evidence on 2026-06-07.
- Updated `src/components/diagnostics/selection-ai-regression-diagnostics.tsx` with a diagnostics planner provider and agent session trace readout.
- Updated `scripts/browser-regression.mjs` so the `ai-chat-research-agent` and `selection-ai` flows verify agent session completion, evidence count, planner source, planner prompt preview, and planner raw output preview.
- Latest verification:
  - `npx vitest run "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent-planner-provider.test.ts" "src/lib/__tests__/ai-research-agent-llm-planner.test.ts" "src/lib/__tests__/ai-research-agent-planner.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-mock-research-run.test.ts" "src/components/ai/__tests__/ai-chat-panel.test.tsx" --maxWorkers=2`
  - `npx vitest run "src/lib/__tests__/selection-actions.test.ts" "src/components/ai/__tests__/selection-ai-hub.test.tsx" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" --maxWorkers=2`
  - `npx vitest run "src/lib/__tests__/ai-agent-session.test.ts" "src/stores/__tests__/agent-session-store.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" "src/lib/__tests__/selection-actions.test.ts" "src/components/ai/__tests__/selection-ai-hub.test.tsx" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" --maxWorkers=2`
  - `npx vitest run "src/lib/__tests__/ai-agent-session.test.ts" "src/stores/__tests__/agent-session-store.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" "src/components/ai/__tests__/ai-chat-panel.test.tsx" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" --maxWorkers=2`
  - `LATTICE_BROWSER_REGRESSION_FLOW=ai-chat-research-agent LATTICE_BROWSER_REGRESSION_PORT=3245 LATTICE_BROWSER_REGRESSION_DIST_DIR=web-dist-browser-regression-ai-chat node scripts/browser-regression.mjs`
  - `LATTICE_BROWSER_REGRESSION_FLOW=selection-ai LATTICE_BROWSER_REGRESSION_PORT=3241 LATTICE_BROWSER_REGRESSION_DIST_DIR=web-dist-browser-regression-ai node scripts/browser-regression.mjs`
  - `npm run typecheck`
  - `npm run test:docs`

## P1: Plan And Trace UI Convergence

Goal: make the agent auditable like a professional agent product.

Tasks:

- Render plan steps in `AgentTracePanel`. Done from existing trace metadata.
- Show step status: pending, running, completed, blocked, failed. Done for Research Agent plan step events.
- Show planner source: default, custom, fallback. Done in the Plan section.
- Show planner warnings prominently when fallback happened. Done in the Plan section.
- Show compacted session summary and retained trace events clearly. Done for compaction summaries and retained timeline.
- Add a details expander for tool arguments preview and result preview. Partial: trace event details now show tool arguments preview, metadata, evidence count, and errors; pending approval result previews still need richer display.
- Add a details expander for planner raw output, with truncation. Done: planner prompt/raw output previews are stored in trace metadata and shown in the Plan section.
- Add empty/error/recovery states for failed planner generation and failed tool execution.
- Add session resume affordance for sessions waiting on approval.

Acceptance:

- User can answer: what did the agent plan, inspect, run, request, and produce?
- Approval requests are visually tied to the plan step that caused them.
- Compaction does not make the session feel like context vanished.

Suggested code areas:

- `src/components/ai/agent-trace-panel.tsx`
- `src/lib/ai/agent-session.ts`
- `src/stores/agent-session-store.ts`
- `src/lib/i18n/en-US.ts`
- `src/lib/i18n/zh-CN.ts`

Verification:

- Component tests for plan rendering, warnings, approval cards, compacted sessions.
- Browser smoke after UI changes.

Status:

- Trace plan/warning/details/compaction view completed on 2026-06-07.
- `src/components/ai/agent-trace-panel.tsx` now derives a Plan view from `AgentTraceEvent.metadata` without expanding core session schema.
- The Plan view shows planner source, warning count, warning text, plan step rows, step status, and bound tool names.
- The Plan view includes an expandable Planner details section for truncated planner prompt and raw output previews.
- `src/lib/ai/research-agent.ts` writes `plannerPromptPreview` and `plannerRawOutputPreview` into the `plan-created` trace metadata.
- Trace event rows now include a details expander for metadata, tool arguments preview, evidence count, and errors.
- Compaction summaries are now visible as first-class audit records.
- `src/lib/ai/agent-session.ts` now retains planner audit anchor events during session compaction, so compressed sessions still expose planner source, warnings, and prompt/raw previews.
- `src/lib/__tests__/ai-agent-session.test.ts` covers planner audit anchor retention through compaction.
- Latest verification:
  - `npx vitest run "src/lib/__tests__/ai-research-agent.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `npx vitest run "src/components/ai/__tests__/agent-trace-panel.test.tsx" "src/lib/__tests__/ai-agent-session.test.ts" "src/stores/__tests__/agent-session-store.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" --maxWorkers=2`
  - `npx vitest run "src/lib/__tests__/ai-agent-session.test.ts" "src/stores/__tests__/agent-session-store.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" "src/lib/__tests__/selection-actions.test.ts" "src/components/ai/__tests__/selection-ai-hub.test.tsx" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" --maxWorkers=2`
  - `LATTICE_BROWSER_REGRESSION_FLOW=selection-ai LATTICE_BROWSER_REGRESSION_PORT=3241 LATTICE_BROWSER_REGRESSION_DIST_DIR=web-dist-browser-regression-ai node scripts/browser-regression.mjs`
  - `npm run test:docs`
- `npm run typecheck`

## P2: Real Multi-Step Tool Loop

Goal: turn planner steps from metadata into a controlled execution loop.

Tasks:

- Extend `ResearchAgentPlanStep` with optional execution intent:
  - `toolName`. Done.
  - `toolArgs`. Done for sanitized read/search/evidence args.
  - `dependsOn`
  - `onFailure`
  - `requiresApprovalReason`
- Add schema validation for tool args per supported tool. Partial: read/search/evidence args are validated; gated write/code args are rejected from planner output.
- Build `runResearchAgentToolLoop` that iterates allowed steps through `AgentToolBroker`. Partial: `runResearchAgentReadToolLoop` executes planned `workspace.search` and `workspace.readIndexedContext` steps.
- Apply max step limit and cancellation checks.
- Store intermediate tool results in session trace metadata with previews. Done for planned read/search steps.
- Allow read/search/evidence steps to feed later synthesis. Partial: planned read/search results are summarized into the evidence-backed answer and returned as `toolResults`; `evidence.resolve` accepts sanitized planner `toolArgs`.
- Keep write/draft/proposal/code steps approval-gated. Done by rejecting planner `toolArgs` for gated tools and keeping draft/proposal creation on the existing Tool Broker approval path.
- Stop cleanly on pending approval and mark downstream steps pending/blocked.
- Resume after approval without re-running completed read steps.

Acceptance:

- A planner can choose `workspace.search`, read context, resolve evidence, then synthesize.
- A pending approval pauses the loop instead of failing the whole run.
- The same session can be resumed after approval.
- Step limit prevents runaway loops.

Suggested code areas:

- `src/lib/ai/research-agent.ts`
- `src/lib/ai/research-agent-planner.ts`
- `src/lib/ai/agent-tool-broker.ts`
- `src/lib/ai/agent-session.ts`
- `src/stores/agent-session-store.ts`

Verification:

- Unit tests for read-only loop, approval pause, approval resume, failure handling, cancellation.
- Typecheck.

Status:

- P2 controlled read-tool loop first slice completed on 2026-06-07.
- `src/lib/ai/research-agent-planner.ts` now supports sanitized `toolArgs` for `workspace.search`, `workspace.readIndexedContext`, and `evidence.resolve`.
- `src/lib/ai/research-agent-llm-planner.ts` documents allowed `toolArgs` in the JSON-only planner prompt and forbids planner args for gated write/code tools.
- Added `src/lib/ai/research-agent-tool-loop.ts` to execute planned read/search steps through `AgentToolBroker`, update plan step trace status, and return `toolResults` plus result previews.
- `src/lib/ai/research-agent.ts` now runs planned read/search steps before evidence resolution, merges sanitized `evidence.resolve` args, and includes planned tool summaries in the final answer.
- P2 loop hardening completed on 2026-06-08 for max step limits and cancellation checks.
  - `src/lib/ai/research-agent-tool-loop.ts` now enforces a bounded read-tool step limit before executing planner-selected `workspace.search` / `workspace.readIndexedContext` loops.
  - `src/lib/ai/research-agent.ts` now checks cancellation before planner work, after planner generation, after session creation, around read-tool execution, before/after evidence resolution, and around artifact creation.
  - `src/lib/ai/research-agent-llm-planner.ts` now propagates provider `AbortError` instead of converting user/provider cancellation into fallback plans.
  - Failed step-limit runs and cancelled active sessions now write controlled trace/session status instead of silently continuing.
- P2 approval pause/resume semantics completed on 2026-06-08 for Research Agent artifact tools.
  - `waiting_approval` is preserved as a first-class paused run state for gated draft/proposal tools.
  - `finalizeResearchAgentApprovedArtifacts` now provides a resume-safe Research Agent finalization path after pending artifact approvals complete.
  - Resume finalization reconciles pending approval status, artifact plan-step status, session completion, and optional compaction without rerunning planner/evidence.
  - Unit tests cover paused artifact runs, pre-approval no-op finalization, approved draft execution, resume finalization, completion trace, and compaction.
- P2 richer tool result preview contract completed on 2026-06-08.
  - `AgentToolExecutionResult` now carries `resultPreview` and primitive `resultMetadata` for completed tools.
  - `buildAgentToolResultPreview` normalizes `workspace.search`, `workspace.readIndexedContext`, `evidence.resolve`, `workbench.createDraft`, `workbench.createProposal`, and `runner.runCode` outputs.
  - Tool Broker `tool_result` trace events now include stable primitive preview metadata without changing the persisted session shape.
  - Research Agent planned tool summaries now reuse ToolBroker previews instead of ad hoc result stringification.
  - `src/lib/ai/research-agent-tool-loop.ts` now emits stable tool observations with step id, tool name, status, preview, evidence count, and primitive metadata preview. `ResearchAgentRunResult`, synthesis trace metadata, chat `agentResult`, and structured AI result sections carry these observations as the bridge toward a fuller observe-plan-act loop.
  - Research Agent now performs a bounded observation-aware observe-plan-act loop after completed read-tool observations when an injected planner is available. Default behavior remains one replan, while `maxObservationReplans > 1` enables additional bounded iterations. Replan prompts include only current tool observations, only pending existing steps can be updated, planner-invented steps are ignored for safety, and final updated `evidence.resolve` args affect the next Tool Broker call.
  - Observation replan trace metadata now includes iteration, budget, stop reason, and observation quality counters. Multi-iteration loops stop on duplicate observations or all-low-value observations, so repeated empty searches do not keep burning planner turns.
  - Observation replan trace metadata now also includes a bounded recovery recommendation derived from stop reason and observation quality, so users can see whether to approve/resume, narrow a query, avoid duplicate reads, continue with current evidence, or start a focused follow-up run.
  - `src/components/ai/agent-trace-panel.tsx` now renders observation-replan audit cards in the timeline, showing reviewed observation count, quality summary, updated pending step ids, ignored planner-invented step ids, and observation previews without forcing users into raw metadata JSON.
  - `src/lib/ai/research-agent.ts` now reuses an existing non-terminal `sessionId` instead of replacing its trace, and `src/lib/ai/research-agent-tool-loop.ts` restores completed read-tool observations from that trace, skips duplicate read-tool execution for completed planner steps, and writes an explicit skip trace so resumed runs can continue from prior observations without rerunning completed workspace searches.
  - Research Agent evidence resolution now writes bounded `resolvedPromptPreview` / context counts / evidence counts into the completed `evidence-resolve` plan-step trace. Resume runs can restore a clearly marked prompt context from that trace, preserve evidence refs, skip duplicate `evidence.resolve` Tool Broker calls, and continue synthesis from the restored evidence context.
  - Research Agent synthesis now writes bounded `answerPreview` into both the completed `synthesize-answer` plan-step trace and synthesis trace. Resume runs can restore a clearly marked synthesis preview, skip duplicate answer synthesis, and continue approval/compaction work from the restored answer preview.
  - Approval reconciliation now reads restored synthesis previews from the same session trace, records approval id/tool/result preview plus restored synthesis preview on completed approval plan-step traces, and marks completion messages when approvals finish against restored synthesis context.
  - Agent Trace rows now render compact restored-context audit cards for restored evidence prompt previews, restored answer previews, and approval resume synthesis previews, so resume state is visible without opening raw metadata.
  - Agent Trace rows now surface `resultPreview` directly in the timeline while keeping full metadata expandable.
- P2 generalized approval result reconciliation completed on 2026-06-08.
  - `reconcileResearchAgentPendingApprovals` now provides a generic Research Agent pending-approval reconciliation helper beyond artifact-only draft/proposal tools.
  - `finalizeResearchAgentApprovedArtifacts` remains as a compatibility wrapper over the generalized helper for draft/proposal artifact runs.
  - Completed/failed/rejected non-artifact approvals such as `runner.runCode` can now reconcile plan-step status, session completion, and optional compaction without rerunning planner or evidence.
  - Unit tests cover pre-approval no-op reconciliation, approved `runner.runCode` reconciliation, `run-code` plan-step completion, result preview metadata, session completion, and compaction.
- Trace Panel approval-to-reconciliation wiring completed on 2026-06-08.
  - After Trace Panel approval execution succeeds, Research Agent sessions now automatically call `reconcileResearchAgentPendingApprovals`.
  - Research Agent sessions are identified from planning trace metadata, so standalone Tool Broker sessions are not completed accidentally.
  - Existing approval buttons and Tool Broker replay behavior remain intact.
  - UI tests cover Research Agent auto-finalization after approval and existing standalone approval behavior.
- P2 approval/reconciliation status surfacing completed on 2026-06-08.
  - `ResearchAgentRunResult` now includes a stable `approvalSummary` contract derived from session pending approval records.
  - AI Chat formatted Research Agent answers now surface waiting/executing/completed/failed approval state only when approvals exist.
  - The summary keeps Tool Broker execution as the source of truth by deriving status from `AgentSession.pendingApprovals`.
  - Unit tests cover default no-approval runs, approval-gated draft runs, and chat approval-status formatting.
- P2 stage audit and hardening completed on 2026-06-08.
  - Fixed approval summary precedence so completed/failed/executing approval records cannot be masked by a stale `waiting_approval` session status.
  - Added explicit `agentKind: research_agent` metadata to Research Agent `plan-created` trace anchors.
  - Trace Panel Research Agent detection now prefers the explicit marker while preserving compatibility with existing plan metadata.
  - Reviewed Tool Broker result previews and read-tool loop metadata; no schema or primitive-metadata issues were found.
  - Tests cover stale session approval-summary precedence and explicit Research Agent trace marker usage.
- P2.5 product interaction simplification completed on 2026-06-08 before entering P3.
  - Removed the AI Chat workflow selector from the primary input path; Chat now exposes a restrained Chat / Agent mode switch and lets the Research Agent infer the workflow by default.
  - Preserved explicit workflow presets for Command Palette and advanced seeded runs, so power-user workflows remain available without burdening the default academic chat flow.
  - Prompt Templates now behave as input accelerators: selecting a template directly fills the chat input instead of opening a secondary Prompt Run confirmation sheet.
  - The Prompt Picker side panel was narrowed and simplified: no recent-run block, no visible Use button, compact rows, and a small edit/duplicate icon for template maintenance.
  - Fixed AI Chat mojibake in streaming markers and visible separators encountered during verification.
  - Verification:
    - `./node_modules/.bin/vitest.cmd run "src/components/prompt/__tests__/prompt-picker.test.tsx" "src/components/ai/__tests__/ai-chat-panel.test.tsx" --maxWorkers=2`
    - `npx tsc --noEmit --pretty false`
- Latest verification:
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent-planner.test.ts" "src/lib/__tests__/ai-research-agent-llm-planner.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-agent-session.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `npm run typecheck`
  - `npm run test:docs`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent-planner.test.ts" "src/lib/__tests__/ai-research-agent-llm-planner.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-agent-session.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `npm run typecheck`
  - `npm run test:docs`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent-llm-planner.test.ts" --maxWorkers=1`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent-planner.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-agent-session.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent-planner.test.ts" "src/lib/__tests__/ai-research-agent-llm-planner.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-agent-session.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent-planner.test.ts" "src/lib/__tests__/ai-research-agent-llm-planner.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-agent-session.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/components/ai/__tests__/agent-trace-panel.test.tsx" "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent-planner.test.ts" "src/lib/__tests__/ai-research-agent-llm-planner.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-agent-session.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `npm run test:docs`
  - `npm run typecheck`

## P3: Memory And Long Context Strategy

Goal: make long-running research useful across sessions without silently mutating memory.

Entry requirement:

- Keep the main AI Chat surface professional and low-friction before adding memory complexity. Completed on 2026-06-08: AI Chat now exposes Chat / Agent as the primary mode choice, leaves workflow selection to automatic inference by default, and keeps explicit workflow presets in Command Palette / advanced entry points.
- Prompt Templates must act like input accelerators, not a second execution dialog. Completed on 2026-06-08: selecting a template directly fills the chat input, where the user can edit details before sending.

Tasks:

- Define memory write capability in `AgentCapabilityPolicy`. Done.
- Add Tool Broker tool for memory suggestion/write, approval-gated. Done for `memory.write`.
- Add automatic memory candidate extractor from final answer and trace. Done first slice for Research Agent surface runs.
- Show memory suggestions in Memory Panel, default pending approval. Done with provenance preview for reason, source, and shortened source fingerprint.
- Add workspace/project/conversation memory filters in Research Agent input collector. Done in shared surface runner without adding primary UI controls.
- Add context-pack budget profile presets for chat, research, notebook, code, and knowledge organization. Done.
- Add automatic context pack summary when omitted content exceeds threshold. Done for deterministic omitted source/count/token/label summaries and length-bounded semantic content previews.
- Store context pack summary in session compaction. Done via Research Agent trace metadata and compaction summary.
- Add UI for disabling memory use per run. Done first slice for per-run memory suggestions.

Acceptance:

- No memory entry is silently written.
- Users can inspect source/provenance before approving memory.
- Long tasks preserve useful summaries without dumping full files.

Suggested code areas:

- `src/lib/ai/agent-memory.ts`
- `src/stores/agent-memory-store.ts`
- `src/components/ai/agent-memory-panel.tsx`
- `src/lib/ai/agent-policy.ts`
- `src/lib/ai/agent-tool-broker.ts`
- `src/lib/ai/agent-context-pack.ts`

Verification:

- Unit tests for memory policy, suggestion generation, approval flow, context budget behavior.
- Component tests for memory suggestion UI.

Status:

- P3 memory approval and omitted-context summary first slice completed on 2026-06-08.
- `src/lib/ai/agent-memory.ts` now has memory suggestion helpers, dedupe keys, source fingerprints, duplicate suppression by title/scope or matching source fingerprint, and explainable suggestion evaluation reason codes for accepted, duplicate, low-confidence, and thin-content candidates.
- `src/lib/ai/agent-tool-broker.ts` now supports `memory.write`, maps it to `memory_write`, requires approval under research/writeback/automation profiles, writes to `AgentMemoryStore` only after approval, and records `memory_updated` trace events.
- Approved `memory.write` results now merge the saved memory id back into the owning `AgentSession.memorySnapshotIds`, and `memory_updated` trace metadata records a bounded `memorySnapshotIdsPreview`. This makes newly approved memories visible to the current run, later compaction, and continuation recovery instead of leaving them only in the Memory Store.
- `src/lib/ai/agent-tool-broker.ts` now exposes `AGENT_TOOL_DESCRIPTORS` with stable tool name, capability, label, description, argument summary, and result summary. Tool request and approval trace events include this descriptor metadata.
- `src/lib/ai/research-agent.ts` can generate a conservative evidence-backed memory candidate after synthesis. `runResearchAgentForSurface` opts into this by default, while the lower-level `runResearchAgent` remains opt-in for tests/internal calls. Generated candidates now carry a deterministic source fingerprint derived from workspace/session, workflow, query, evidence locator, and prompt-context preview.
- Research Agent memory candidates are now answer-first rather than raw-context-first: the candidate content uses the final synthesis answer as the finding, then records evidence context, context pack id/token/truncation status, omitted-context summary, and recovery hints so long-term memory stays useful and auditable.
- `src/lib/ai/research-agent.ts` now records memory suggestion evaluation trace metadata before approval: accepted candidates show confidence/scope/title, while skipped candidates preserve reason code, reason text, and duplicate memory id when available.
- Memory suggestion trace metadata now includes answer preview, context pack id, omitted-context count, and omitted-context preview so users can audit why a memory candidate was proposed before approving it.
- `src/components/ai/agent-trace-panel.tsx` now renders compact Memory suggestion audit cards for accepted and skipped memory candidates, including reason, reason code, confidence, scope, title, duplicate memory id, and source fingerprint without requiring raw metadata expansion.
- `src/components/ai/agent-trace-panel.tsx` now also shows answer preview and context-pack / omitted-context provenance inside Memory suggestion audit cards without adding another dialog or primary control.
- `src/lib/ai/agent-tool-broker.ts` now carries `memorySourceFingerprint` through memory-write result metadata and `memory_updated` trace events.
- `src/stores/agent-session-store.ts` now exposes a narrow `addMemorySnapshotIds` action backed by a pure `addAgentSessionMemorySnapshotIds` helper, keeping approval-time memory provenance in the AgentSession without changing the primary UI.
- `reconcileResearchAgentPendingApprovals` now understands approved `memory.write` requests and can complete the Research Agent after approval.
- `src/components/ai/agent-memory-panel.tsx` now shows pending `memory.write` suggestions from Agent Sessions above saved memories, with compact approve/reject controls that reuse Tool Broker approval replay. Suggestion cards include reason, source label/locator, and shortened source fingerprint before approval.
- `src/lib/ai/agent-context-pack.ts` now returns `omittedSummary` with omitted counts, token estimates, source grouping, and compact label previews. Truncated prompts include only this short omitted-context summary, not omitted full text.
- `src/lib/ai/agent-context-pack.ts` now also includes deterministic `semanticPreview` and per-source `contentPreviews` for omitted content, giving long-context recovery useful content clues without extra model calls or full-text reinjection.
- `src/lib/ai/agent-context-pack.ts` now also includes deterministic extractive `autoSummary` entries and a bounded `autoSummaryPreview` for omitted content. Each source-level summary records omitted count/tokens, representative labels/previews, and lightweight keywords so planner, trace, continuation, and memory review surfaces have a readable summary layer before model-generated summarization exists.
- `src/lib/ai/research-agent.ts` now supports an optional run-level `generateOmittedSummary` hook for model-generated omitted-context summaries. The hook receives only bounded omitted previews/auto summaries/recovery plans, never full omitted text; failures fall back to deterministic summaries and are recorded in trace metadata.
- `src/lib/ai/research-agent-planner-provider.ts` now wires the same routed AI provider into omitted-context model summary generation for product Research Agent runs. `src/lib/ai/research-agent-chat-runner.ts` passes the generator through automatically, so Chat/Selection surfaces get provider-backed summaries without adding another visible control.
- `src/lib/ai/agent-context-pack.ts` now adds bounded `recoveryHints` and `recoveryHintsPreview` for omitted content, ranking omitted items by priority/token weight and retaining source, label, locator, token estimate, and compact content previews for audit/recovery.
- `src/lib/ai/agent-context-pack.ts` now adds `recoveryPriorityPreview` and priority-scored omitted recovery hints. Scores combine item priority, source weight, token weight, and locator presence so continuation runs can see which omitted content is worth recovering first.
- `src/lib/ai/agent-context-pack.ts` now also emits a structured omitted `recoveryPlan` plus bounded `recoveryPlanPreview`. Each item records recovery action, source, label, locator, token estimate, priority score/reason, omission reason, and content preview so compressed context has an executable recovery strategy instead of only loose hints.
- `src/lib/ai/agent-context-budget-profiles.ts` now defines restrained internal budget profiles for `chat`, `research`, `notebook`, `code`, and `knowledge-organization`.
- `src/lib/ai/research-agent.ts` now resolves Context Pack budgets through the profile layer instead of embedding hard-coded budget literals in the agent run.
- `src/lib/ai/research-agent-workflows.ts` now maps workflow context profiles to budget profile ids, and `src/lib/ai/research-agent-chat-runner.ts` passes those ids into the shared runner without adding extra primary UI controls.
- `src/lib/ai/research-agent-chat-runner.ts` now resolves per-run memory read filters for Chat/Selection surfaces: explicit advanced `memoryQuery` wins, while default runs use workflow memory scopes plus current workspace key and conversation/session id.
- `src/lib/ai/research-agent-workflows.ts` now reuses Tool Broker descriptors to add concise tool schema summaries to workflow planner hints.
- `src/lib/ai/agent-memory.ts` now provides deterministic Research Agent memory ranking with scores and bounded reasons. Ranking considers pinned memories, workspace/project/conversation fit, title/content/source overlap with the current task/query/selection/workflow/evidence, and recency as the final tie-breaker.
- `src/lib/ai/research-agent.ts` now ranks memory candidates before applying the per-run limit, so relevant memory is not accidentally dropped because a less relevant entry was newer. Context-pack and memory-snapshot trace metadata include candidate count, ranking query preview, and ranked memory preview.
- `src/components/ai/agent-trace-panel.tsx` now renders Tool Broker descriptor metadata as structured Tool contract / Result contract details inside expanded trace rows, and keeps descriptor fields out of the raw metadata block to reduce audit noise.
- Tool Broker result previews now include a stable result schema envelope (`resultSchemaVersion`, `resultStatus`, `resultSummary`, metrics/artifact/diagnostic previews) across workspace search, indexed reads, evidence resolve, workbench artifact creation, runner output, and memory writes. Trace renders this as a compact Result schema card without replacing the existing concise preview.
- Research Agent read-tool observations now preserve result schema status, summary, metrics, artifacts, and diagnostics. Observation-aware replans inject this bounded schema into planner prompts and trace previews, so later plan iterations can react to structured tool outcomes instead of generic preview strings.
- Pending approval records now persist Tool Broker descriptor snapshots, and `src/components/ai/agent-trace-panel.tsx` renders those snapshots in approval cards before execution along with compact argument/result previews.
- `src/components/ai/agent-trace-panel.tsx` now keeps recent processed approvals visible in a compact Approval results section, so completed/failed/rejected tool result previews stay inspectable after the pending approval action disappears.
- `src/components/ai/agent-trace-panel.tsx` now derives a compact Run Summary from session/trace data, giving users a scan-friendly view of workflow, plan completion, tool involvement, evidence count, approval progress, omitted context, and memory suggestions without adding new primary controls.
- Research Agent chat responses now write `agentResult` metadata and render as structured Answer / Run / Plan sections through `src/lib/ai/result-view-model.ts`, while preserving the existing raw chat text for copy/export compatibility. The Run section now carries recovery summaries derived from observation stop recommendations plus omitted-context compression summaries with model-summary status/quality and recovery-plan previews, the Observations section surfaces a compact observation count/status/tool summary plus representative tool result status/summary/metrics/artifacts/diagnostics and defers overflow details to Trace, and the structured card exposes a compact Open trace action that activates the matching Agent Session from chat.
- Research Agent chat responses now also expose pending memory suggestions through `agentResult.memorySummary`. Chat shows a compact pending-count/title preview and a review shortcut, while actual `memory.write` approval still happens through the existing Agent Session Memory/Trace approval flow.
- `src/components/ai/agent-memory-panel.tsx` now respects the active Agent Session when rendering pending `memory.write` suggestions. Suggestions from the current run are sorted first and labeled as the current run, while suggestions from other runs remain visible in the same compact review list.
- P3 interaction close-out: Chat result actions now call a transient Agent Session focus target for Trace or Memory review. The target panel expands and consumes the focus request, so Open trace / Review memory no longer leave the user on a hidden or collapsed panel.
- `src/components/ai/ai-chat-panel.tsx` now renders those structured Agent results with a lighter main-chat layout: Answer is normal response text, Run / Plan / Observations are compact divided summaries, and Trace remains the place for complete audit details.
- The AI Chat input bar now exposes the professional primary controls users expect first: Chat / Agent mode, current model summary, and low/medium/high Agent effort. Workflow and memory switches are still available through a compact Advanced area, so the default interaction stays automatic and uncluttered.
- The model summary is now actionable: a compact quick switch updates provider/model through the same Settings store, while the full Settings AI panel remains the deeper configuration surface for API keys, base URLs, and model discovery.
- Prompt templates now follow a quicker command-style picker interaction: template rows apply directly to the current input, while edit/duplicate remains a separate icon path. The picker dock is narrower and denser to avoid turning template use into another configuration screen.
- Prompt template editing now defaults to the core fields only: title, description, prompt body, and pinning. Advanced template configuration remains available but is folded away by default.
- `src/lib/ai/research-agent.ts` now records effective memory read filter metadata in context-pack and memory-snapshot trace events, including scopes, workspace/project/conversation filters, query limit, memory count, and bounded memory id previews.
- `src/components/ai/agent-trace-panel.tsx` now renders compact Memory read audit cards for context-pack and memory-snapshot events, showing loaded memory count, memory id previews, scopes, workspace/project/conversation filters, and query limit without requiring raw metadata expansion.
- Memory read audit cards now also show ranked memory previews and the bounded ranking query, making it clear why a memory entered the context pack without adding another primary UI control.
- Research Agent context-pack trace metadata now records omitted count/tokens/preview plus omitted recovery-hint preview, and compaction summaries explicitly mention omitted-context summaries.
- Research Agent context-pack trace metadata now also records omitted recovery priority previews. Session compaction preserves these priority previews, and continuation recovery injects them into planner context and recovery heavy input.
- Research Agent context-pack trace metadata now records omitted recovery plan previews. Session compaction preserves these plans, continuation recovery injects them into planner context and heavy input, and recovery read planning prefers plan locators before falling back to legacy priority previews.
- Research Agent context-pack trace metadata now records omitted auto summaries. Session compaction preserves these summaries, continuation recovery injects them into planner context and recovery heavy input, and memory suggestions include them in approval provenance.
- Research Agent context-pack trace metadata now records omitted model-summary status, warning, and bounded summary text when available. Session compaction preserves the model summary, continuation recovery injects it into planner context and recovery heavy input, and memory suggestions include it in approval provenance.
- Research Agent context-pack trace metadata now also records omitted model-summary quality status, score, and bounded reasons. The evaluator is deterministic and read-only, checking summary length, keyword coverage, omission awareness, and recovery/source cues without making another model call.
- Continuation recovery now turns high-priority omitted-context locators into bounded `workspace.readIndexedContext` plan steps. These auto-generated recovery reads are inserted after context-pack construction, executed through the existing Tool Broker read loop, and audited with `continuationRecoveryReadPathCount` / `continuationRecoveryReadPathsPreview` trace metadata.
- Continuation recovery reads now feed the observation-aware planner loop as first-class recovery observations. `workspace.readIndexedContext` recovery steps carry purpose/locator metadata, replan prompts include `purpose=recovery_read` summaries, and Trace surfaces recovery observation counts/locators for audit.
- Recovery observations now carry through to final synthesis and memory suggestion provenance. The synthesis trace records recovery observation counts, locators, and previews; memory candidates include recovered omitted-context reads in their approval content and trace metadata so users can inspect recovered context before any memory write.
- Recovery observations now also produce a bounded recovered-context digest. Final synthesis includes the digest as a separate section, synthesis trace records useful/low-value recovery counts plus digest previews, and memory suggestions include the digest in approval provenance without storing raw recovered context automatically.
- Continuation recovery now has a read-only quality evaluation layer. It classifies recovery as not_needed, complete, partial, weak, or missing based on planned locators, observed recovery reads, coverage, and low-value results; Trace metadata and the timeline surface recovery quality without blocking the run or triggering hidden follow-up actions.
- Memory suggestions now include approval-review metadata for applicability, evidence summary, recovered-context summary, and caution. The Memory panel renders this compactly inside pending suggestions, and Trace renders the same review cues in memory suggestion audit cards without adding another dialog or primary control.
- Memory suggestions now pass through a deterministic policy review before approval. The review checks provenance strength, evidence cues, reusable-value cues, broad answer dumps, transient state, and unclear kinds; it can reject session-only state, lower confidence, or expose review reasons without writing memory automatically.
- Memory candidate evaluation now classifies candidates as finding, preference, project rule, transient state, or unknown. Research Agent suggestions are explicitly tagged as findings; transient session state and unknown candidates are rejected with traceable reason codes before approval.
- Approved memories now persist candidate kind on `AgentMemoryEntry`. Memory ranking uses kind as a task-relevance signal, and the Memory panel surfaces saved memory kind without adding another control.
- Memory read Trace audit now covers kind-aware ranking reasons such as `kind:finding`, making it inspectable why a saved memory entered the context pack for a research task.
- `src/lib/ai/agent-memory.ts` now includes a pure memory lifecycle evaluation layer. It classifies saved memories as healthy, stale, weak, review, disabled, or deleted, recommends keep/review/refresh/disable/restore actions, and never mutates saved status automatically.
- Memory ranking now adds lifecycle reasons such as `lifecycle:stale` and applies conservative score adjustments so old or weak-provenance memories are less likely to crowd out fresh, grounded memories. Pinned memories remain protected from strong lifecycle penalties.
- `src/components/ai/agent-memory-panel.tsx` now surfaces compact lifecycle badges and detail rows for saved memories, exposing health and recommended action without adding auto-cleanup controls.
- Research Agent memory-read trace metadata now records a compact lifecycle distribution and review preview for the memories actually loaded into a run. Trace surfaces this health audit inside the existing Memory read card, so stale or weak memories remain visible without automatic mutation or extra controls.
- Research Agent synthesis now uses the P3 long-context and memory-quality signals directly in final deterministic answers. Answers can include bounded Long-context summary lines for omitted model/auto summaries and recovery plans, plus compact Memory health lines from lifecycle audit, so these signals improve the user-facing result instead of living only in Trace metadata.
- Full typecheck gate was restored by tightening `live-preview-diagnostics.test.ts` decoration-data type guards so parsed annotation/wiki/embed diagnostics remain type-safe without `any` casts.
- Full typecheck now excludes generated `web-dist*` build output types from `tsconfig.json`, preventing stale/broken generated route declarations from polluting source-level quality gates.
- AI Chat Agent mode now exposes a low-friction per-run `Suggest memory` checkbox. It defaults on for product runs and passes `suggestMemory: false` when the user disables memory suggestions for that run.
- `src/components/ai/agent-trace-panel.tsx` now renders omitted-context count/token/preview metadata plus semantic preview and recovery-hint preview as a read-only summary card in the timeline, so users do not need to expand raw metadata JSON to understand truncation.
- `src/components/ai/agent-trace-panel.tsx` now also renders omitted auto summaries in omitted-context, continuation recovery, and memory suggestion audit cards without adding another primary control.
- `src/components/ai/agent-trace-panel.tsx` now also renders omitted model summaries in omitted-context, continuation recovery, and memory suggestion audit cards without adding another primary control.
- `src/components/ai/agent-trace-panel.tsx` now also renders omitted model-summary quality in the same compact omitted-context audit card, exposing weak/partial/healthy summary signals without adding a new settings surface.
- `src/components/ai/agent-trace-panel.tsx` now renders recovered-context digest audit lines in synthesis/replan and memory suggestion cards, making it clear whether recovered omitted reads were useful or low-value.
- `src/components/ai/agent-memory-panel.tsx` and `src/components/ai/agent-trace-panel.tsx` now surface memory policy summaries/reasons in pending suggestions and trace audit cards, so approval decisions can distinguish reusable findings from temporary run state.
- `src/components/ai/agent-trace-panel.tsx` now shows omitted and continuation recovery priority previews in the same compact audit cards, keeping long-context recovery explainable without adding another control.
- Continuation recovery audit cards now also show planned recovery read paths, making it clear when the Agent actively rereads high-priority omitted context rather than only mentioning it in the prompt.
- `src/components/ai/agent-trace-panel.tsx` now also shows omitted and continuation recovery plan previews in the same compact audit cards, exposing the recovery action/reason/score without adding another operation step.
- `src/lib/ai/agent-session.ts` now records retained event count, source event kinds, and retained event id previews in compaction trace metadata; `src/components/ai/agent-trace-panel.tsx` surfaces retained event count and source kinds in the Compactions card.
- `src/components/ai/agent-trace-panel.tsx` now provides compact Continue in Chat and Copy continuation prompt actions on compaction cards, including session task/id, compaction summary, compacted/retained counts, source kinds, and preserved evidence for continuing a compressed research run.
- `src/stores/ai-chat-store.ts` now carries a transient `composerDraft`; `ChatInput` consumes it, switches to Agent mode, and focuses the composer so continuation prompts can move from Trace to Chat without brittle DOM events.
- `composerDraft.continuation` now carries source session id, compaction id, and source summary into `runResearchAgentForChat`; `src/lib/ai/research-agent.ts` records continuation metadata in the `plan-created` trace event, and `agentResult` surfaces the continuation source in structured chat results.
- `src/components/ai/agent-trace-panel.tsx` now derives a lightweight continuation lineage card from existing trace metadata, showing Continued from and Continued by links and allowing users to switch between related Research Agent runs without a new persisted lineage schema.
- `src/lib/ai/research-agent-llm-planner.ts` now includes bounded Continuation context in the planner prompt, and `src/lib/ai/research-agent.ts` builds that context from source session id, compaction id, and source summary so continuation runs plan forward from compressed prior work.
- `src/lib/ai/research-agent.ts` now restores continuation recovery context from the source `AgentSession`: preserved compaction/session evidence is merged into the next context pack, prior omitted recovery hints/semantic previews are injected as bounded heavy input, and plan/context trace metadata records recovered evidence counts for audit.
- Continuation planner prompts now receive recovery-aware continuation context, including recovered summaries, omitted recovery hints, omitted semantic previews, and recovered evidence refs, so resumed Research Agent runs can plan forward from compressed context instead of only seeing source ids.
- `src/components/ai/agent-trace-panel.tsx` now renders compact Continuation recovery audit cards with recovered evidence count, recovered summary, prior omitted recovery hints, and semantic previews in the timeline.
- Verification:
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-agent-context-pack.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/components/ai/__tests__/agent-memory-panel.test.tsx" "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/components/ai/__tests__/agent-memory-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/components/ai/__tests__/ai-chat-panel.test.tsx" "src/components/ai/__tests__/agent-trace-panel.test.tsx" "src/components/ai/__tests__/agent-memory-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/components/ai/__tests__/ai-chat-panel.test.tsx" --maxWorkers=2`
  - `npm run typecheck`
  - `npm run test:docs`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-agent-context-budget-profiles.test.ts" "src/lib/__tests__/ai-research-agent-workflows.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" --maxWorkers=1`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-research-agent-workflows.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-agent-context-pack.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-agent-session.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent-llm-planner.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/components/ai/__tests__/agent-trace-panel.test.tsx" "src/components/ai/__tests__/ai-chat-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" "src/components/ai/__tests__/ai-chat-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/components/notebook/__tests__/markdown-cell.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-agent-context-pack.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-result-view-model.test.ts" "src/components/ai/__tests__/ai-chat-panel.test.tsx" "src/components/ai/__tests__/agent-memory-panel.test.tsx" --maxWorkers=1`
  - `./node_modules/.bin/vitest.cmd run "src/components/ai/__tests__/agent-memory-panel.test.tsx" --maxWorkers=1`
  - `./node_modules/.bin/vitest.cmd run "src/stores/__tests__/agent-session-store.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" "src/components/ai/__tests__/agent-memory-panel.test.tsx" "src/components/ai/__tests__/ai-chat-panel.test.tsx" --maxWorkers=1`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-agent-memory.test.ts" "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-agent-memory.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-agent-tool-broker.test.ts" "src/components/ai/__tests__/agent-memory-panel.test.tsx" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent-llm-planner.test.ts" --maxWorkers=2`
  - `./node_modules/.bin/vitest.cmd run "src/lib/runner/__tests__/problem-utils.test.ts" --maxWorkers=2`
  - `npx tsc --noEmit --pretty false`

## P4: Workflow Presets

Goal: ship user-facing Research Agent modes instead of one generic action.

Tasks:

- Markdown research workflow:
  - summarize note set
  - extract claims
  - build evidence-backed reading note
- Notebook analysis workflow:
  - inspect code/output
  - interpret results
  - propose next experiment
- Knowledge organization workflow:
  - compare folders/source sets
  - generate matrix/draft note
- Teaching workflow:
  - explain selected concept
  - examples
  - quiz/draft
- Keep PDF workflow listed but implemented in separate PDF window.
- Each workflow should map to a preset prompt, context profile, planner hints, and output artifact policy.

Acceptance:

- AI Chat defaults to automatic workflow inference; users are not required to choose a workflow before asking.
- Advanced surfaces such as Command Palette can still preselect a workflow preset when the user explicitly asks for one.
- Each workflow produces evidence-backed answer plus optional draft/proposal.
- Workflow outputs are resumable from Workbench artifacts.

Suggested code areas:

- `src/lib/ai/research-agent-workflows.ts`
- `src/components/ai/ai-chat-panel.tsx`
- `src/components/ai/selection-ai-hub.tsx`
- `src/lib/prompt/executor.ts`

Verification:

- Unit tests for workflow presets.
- Component tests for workflow selection.
- Browser smoke for key flows.

Status:

- Current active sequential phase.
- P6.4 workflow preset registry and P6.3 note-taking config provide supporting infrastructure for this phase.
- First productization slice completed: AI Chat / product Research Agent surfaces now infer a concrete workflow when the user leaves workflow on Auto. Auto maps notebook cues to Notebook Analysis, comparison/matrix cues to Literature Matrix, organization/linking cues to Knowledge Organization, teaching/explanation cues to Teaching Explain, reading-note cues to Reading Note, and defaults to Markdown Research.
- Inferred workflows use the same planner hints, context budget profile, memory scopes, and trace labels as explicit workflows. `agentResult.workflowInferred` lets structured Chat results label the workflow as automatic without adding another selector.
- Second productization slice completed: Research Agent answers now include workflow-specific output sections for Markdown Research, Reading Note, Notebook Analysis, Literature Matrix, Knowledge Organization, and Teaching Explain. This keeps template usage one-step and moves professional structure into the generated result.
- Third productization slice completed: workflow results now carry one-click Workbench draft suggestions through Chat metadata. Reading Note and paper-reading style runs map to `paper_note`, Notebook Analysis to `code_explainer`, Literature Matrix to `comparison_summary`, Knowledge Organization and Markdown Research to `research_summary`, while Teaching Explain stays answer-only. Draft creation remains user-triggered through the existing Chat action.
- Fourth productization slice completed: Research Agent follow-up actions are workflow-aware. Draft-capable workflows expose the save-draft action, Knowledge Organization exposes a proposal-generation handoff, and answer-only workflows such as Teaching Explain no longer show extra Workbench buttons by default.
- Fifth productization slice completed: Agent Result views now include a compact Workbench section with artifact mode (`draft-ready`, `proposal-ready`, `draft-and-proposal`, or `answer-only`), draft template details when available, workflow actions, and the no-silent-write safety contract.
- Sixth productization slice completed: the AI Chat Research Agent browser regression now covers Reading Note, Knowledge Organization, and Teaching Explain through the real diagnostics page, asserting workflow inference, Workbench mode, follow-up action kinds, draft suggestion title, and draft/proposal button visibility.
- Seventh productization slice completed: the browser regression now exercises the real follow-up actions, asserting Reading Note creates a Workbench draft, Knowledge Organization creates a Workbench proposal, and Teaching Explain remains answer-only with no artifact creation.

## P5: Production Hardening

Goal: make the system safe, debuggable, and regression-resistant.

Tasks:

- Tool schema/result inspector UI. Started: Trace timeline now renders standardized tool result envelopes as a compact inspector with status/version, summary, metrics, artifacts, diagnostics, and preview fields.
- Standardized `AgentToolResultPreview` formatting.
- Better error taxonomy: planner, context, tool, approval, provider, storage.
- Metrics counters in trace metadata: step count, tool count, context tokens, omitted sections, duration.
- Session export for debugging.
- QA script for Research Agent smoke.
- Browser smoke path for AI Chat -> Research Agent -> Trace -> approval.
- Accessibility pass for Trace/Memory/Agent controls.
- i18n cleanup for corrupted legacy strings in agent protocol surfaces.

Acceptance:

- Failures are understandable without reading logs.
- A regression script covers the core Research Agent loop.
- UI remains usable with long traces and many sessions.

Status:

- Current active sequential phase: P5 / Production Hardening.
- First P5 slice completed: Trace Tool Result Inspector replaces loose result-schema text with a compact field-based inspector, using the existing Tool Broker result envelope metadata.
- Second P5 slice completed: Memory approval suggestions now use a compact review view model instead of exposing every candidate metadata field inline. The Memory panel shows the AI recommendation, adjusted confidence, kind, primary reason, evidence, risk, policy, recovery, and provenance while keeping approval/rejection on the existing Tool Broker path with no silent writes.
- Third P5 slice completed: agent failures now have a lightweight typed diagnostic model. Tool Broker policy/tool failures and Research Agent read-tool, observation replanner, and evidence-resolution failures record `errorCategory`, `errorStage`, `errorToolName`, and `errorRecoveryHint` trace metadata. Trace UI renders the category/stage/recovery line directly on error events without requiring raw metadata expansion.
- Fourth P5 slice completed: Agent Session debug bundles are now exportable from Trace as bounded JSON copied to the clipboard. The bundle includes session summary, trace/result/error diagnostic summaries, approvals, compactions, omitted-context counters, and provenance counts while intentionally omitting full pending tool request args.
- Fifth P5 slice completed: `scripts/agent-qa-smoke.mjs` and `npm run qa:agent-smoke` now provide a repeatable Research Agent QA smoke gate. The script runs focused Agent unit/component tests, TypeScript, docs, and the AI Chat Research Agent browser regression by default, with `--dry-run`, `--unit-only`, `--skip-browser`, `--skip-typecheck`, and `--skip-docs` options for faster local loops.
- Sixth P5 slice completed: Trace and Memory panel controls now have production-grade accessibility semantics without adding extra UI. Collapsible headers expose `aria-expanded`/`aria-controls`, selected session and memory rows expose `aria-current`, and icon-only debug, approval, compaction, memory action buttons expose stable accessible names. Component tests cover these interaction semantics.
- Seventh P5 slice completed: the AI Chat Research Agent browser regression now includes a diagnostics-only Trace approval fixture. It creates a real `runner.runCode` Tool Broker pending approval, clicks the Trace approval action in the diagnostics Trace panel, and asserts the request reaches `runner.runCode:completed` with the expected runner output.
- Eighth P5 slice completed: AI Chat workflow follow-up actions now expose stable regression anchors for saving drafts and generating proposals. The browser regression uses those `data-testid` anchors instead of translated button text, removing fragile i18n/encoding fallbacks while keeping the visible UI unchanged.
- Ninth P5 slice completed: AI Chat Agent composer state is now modeled by a pure `agent-composer-view-model` instead of scattered JSX conditionals. Effort presets, workflow label, model label, advanced visibility, memory suggestion state, submit intent, and runtime limits are derived in one tested place. AI Chat toolbar controls now expose stable test ids and ARIA state for mode, effort, advanced panel, workflow label, and submit. The Agent QA smoke unit set now includes the composer view model and AI Chat panel tests.
- Tenth P5 slice completed: AI Chat composer rendering is now split into focused local `ComposerToolbar` and `ComposerAdvancedPanel` components. The default Chat composer stays compact, while Agent-only effort controls, workflow status, memory suggestion, and prompt-saving controls remain scoped behind Agent mode / Advanced state. AI Chat panel tests cover the compact default and Agent expansion semantics so future UI work cannot quietly reintroduce redundant always-visible controls.
- Eleventh P5 slice completed: explicit Research Agent workflow presets now behave like a lightweight override, not another configuration surface. The composer view model derives `auto` versus `explicit` workflow state, displays the preset title instead of an internal id, and exposes a clear action in the collapsed Advanced path so users can return to automatic workflow inference. Tests cover explicit workflow execution, clearing back to auto inference, and the high-effort context budget behavior for explicit workflows.
- Twelfth P5 slice completed: Trace and Memory now share a pure `agent-session-audit-view-model` for run audit metrics instead of deriving overlapping summaries inside separate panels. Trace keeps the same compact Run Summary UI but reads from the shared model; Memory uses the same audit model to contextualize active-run memory approvals with workflow, plan, evidence, and pending memory counts. This reduces panel drift while preserving the existing approval-gated Memory write path.
- Thirteenth P5 slice completed: `scripts/agent-qa-smoke.mjs` now supports explicit single-stage QA runs with `--typecheck-only`, `--docs-only`, and `--browser-only` in addition to `--unit-only` and existing skip flags. The QA gate also includes the new session audit view-model test, and script tests reject conflicting `--*-only` flags so slow full gates can be diagnosed without ad hoc command reconstruction.
- Fourteenth P5 slice completed: AI Chat Agent result rendering now has a dedicated pure `agent-result-view-model` instead of embedding Research Agent section construction inside the generic AI result view model. The new model owns Answer, Run, Workbench, Plan, and Observations sections, deterministic observation truncation, and follow-up action kind summaries. Existing Chat rendering remains visually unchanged, but the result contract is now reusable for future full Agent result pages and report-style research run views.
- Fifteenth P5 slice completed: Trace now includes a compact Run Report rendered from a reusable `agent-run-report-view-model` and `AgentRunReport` component. The report turns the active Agent Session plus shared audit metrics into Answer, Run, Plan, Approvals, Memory, and Context sections without adding a new route or modal. This creates the first production-facing report surface for future full Agent result pages while preserving existing Trace approvals, lineage, compactions, and timeline.
- Sixteenth P5 slice completed: Run Report now carries lightweight action anchors generated by the pure report view model. Reports always expose Inspect trace, and add Review approvals / Review memory only when the active session has pending approval or memory approval work. Trace wires the memory action to the existing Agent Session focus path, so clicking it opens the Memory review flow without adding another modal or settings surface.
- Seventeenth P5 slice completed: Run Report actions now have a fuller in-panel review loop. Review approvals expands Trace and marks the pending approval region with a stable anchor plus restrained highlight, while Review memory and Chat result actions use the shared `focusAgentSession` helper for session focus. This keeps approval and memory work connected to the existing Trace / Memory surfaces instead of adding another configuration-heavy workflow.
- Eighteenth P5 slice completed: pending user work now has a shared Review Queue view model. `agent-review-queue-view-model` normalizes tool approvals and memory approvals across sessions, prioritizes current-run work, and feeds Trace / Memory review summaries without adding a new task-center panel. This gives future workflow presets and Lattice skills one typed source for "what needs review next" while preserving explicit approval execution in Tool Broker.
- Nineteenth P5 slice completed: Run Report now consumes the shared Review Queue context when available. Report summaries, approval section details, and Review approval / memory actions use the same queue-derived pending counts and next-action semantics that Trace and Memory already share, keeping the result surface aligned with the actual user work queue without adding another review screen.
- Twentieth P5 slice completed: P6 entry planning now has a typed Lattice Skill Registry foundation. `src/lib/ai/lattice-skills/skill-registry.ts` registers current-thread skills, PDF-reserved skills, ownership, workflow mapping, approval mode, write scope, and readiness summaries without enabling any new writes or UI. This turns the Lattice Product Skills backlog into a testable code contract while keeping PDF item/annotation implementation scoped to the separate PDF window.
- First scheduled P6 current-thread slice completed: `lattice.resolvePathIdentity` is now a read-only Tool Broker tool available to Research workflows under `read_workspace`. The path identity skill is marked ready in the registry, returns canonical Lattice paths / file id candidates / annotation sidecars / PDF item candidate paths, and remains denied for chat-profile sessions by policy.
- Second scheduled P6 current-thread slice completed: workflow presets and note-taking config now produce a typed Research Agent workflow execution profile. `buildResearchAgentWorkflowExecutionProfile()` joins workflow policy, resolved note config, current-thread Lattice skills, PDF-reserved skills, read-only/approval-gated/write boundaries, and skill tool lists into planner-safe hints. This makes Markdown research, notebook analysis, knowledge organization, teaching explain, and PDF-adjacent planning behave automatically without adding another primary UI control.
- Third scheduled P6 current-thread slice completed: Research Agent default plans now automatically add a read-only `lattice.resolvePathIdentity` step when a real `filePath` is present. The step runs through the shared read-tool loop before evidence resolution, contributes planned tool observations to synthesis, and remains auditable through Tool Broker / Trace / compaction metadata.
- Fourth scheduled P6 current-thread slice completed: Chinese workflow inference now uses real Chinese academic task cues for notebook analysis, literature matrix, knowledge organization, teaching explain, and reading-note runs. The notebook trigger was tightened to avoid misrouting literature-review tasks that mention experimental methods, and Chat runner follow-up actions are covered with normal Chinese labels instead of mojibake.
- Fifth scheduled P6 current-thread slice completed: P6.5 now has a typed Lattice skill capability contract. `AgentToolCapability` includes `lattice_read_identity`, note/notebook/update capabilities, and PDF-reserved capabilities; `lattice.resolvePathIdentity` uses `lattice_read_identity` instead of generic `read_workspace`; Lattice skills declare `requiredCapabilities`; workflow execution profiles expose required capability boundaries to planner hints without enabling new write tools.
- Sixth scheduled P6 current-thread slice completed: P6.3 now has a real Workbench draft contract for note-taking workflows. `AiDraftSuggestion` carries optional `content`, `targetPath`, and `writeMode`; `research-agent-chat-runner` maps reading-note, literature-matrix, markdown-research, and notebook-analysis note config into evidence-backed draft content, stable default paths, quote policy metadata, configured sections, and create-mode Workbench handoff; AI Chat follow-up saving preserves that payload without adding extra UI.
- Seventh scheduled P6 current-thread slice completed: Lattice project rules now exist as typed operation contracts instead of prompt-only guidance. `src/lib/ai/lattice-skills/operation-contract.ts` encodes path identity, Workbench draft handoff, PDF item workspace, PDF annotation sidecar, notebook workflow boundary, and knowledge organization proposal rules. Workflow execution profiles inject those contracts into planner hints, including no direct markdown writes, no overwrite in create mode, no manual `.lattice/items` manifests, no blind annotation sidecar replacement, and no fabricated PDF coordinates.
- Eighth scheduled P6 current-thread slice completed: P6.3 draft planning is now modular and Lattice-aware. `src/lib/ai/lattice-skills/note-taking-draft-planner.ts` owns note-taking draft title/content/targetPath/writeMode planning for Reading Note, Literature Matrix, Markdown Research, Notebook Analysis, and PDF-adjacent paper reading. `research-agent-chat-runner` now delegates to that planner, and `pdf-title` naming derives Workbench draft targets from PDF evidence labels/locators without enabling PDF writes.
- Ninth scheduled P6 current-thread slice completed: proposal planned writes are now Lattice-aware. `src/lib/ai/lattice-skills/proposal-planned-writes.ts` normalizes model plannedWrites, filters unsafe absolute/traversal targets, fills missing content previews from proposal steps and evidence refs, and creates a conservative `AI Drafts/<summary> Plan.md` fallback when the model omits write targets. `AiOrchestrator.proposeTask()` now uses that planner so Knowledge Organization and other proposal-first flows enter Workbench with reviewable planned writes instead of empty proposals.

Suggested code areas:

- `src/components/ai/agent-trace-panel.tsx`
- `src/lib/ai/agent-tool-broker.ts`
- `src/lib/ai/research-agent.ts`
- `scripts/`
- `qa/`

Verification:

- Unit tests, component tests, browser smoke, typecheck.
- P5 QA smoke: `npm run qa:agent-smoke`.

## P6: Lattice Product Skills Adaptation Backlog

Goal: turn Lattice product rules into typed Agent skills/tools instead of burying them in prompts.

Source: user-provided prompt attachment on 2026-06-07. The attachment is treated as product intent, not as exact implementation truth; every item must be verified against existing Lattice code before implementation.

Scope split:

- Current AI Agent thread: skill registry, workflow presets, note-taking config model, Tool Broker / Policy / Trace / Approval integration.
- Separate PDF thread: PDF item workspace creation, PDF annotation writeback, PDF visual validation, Explorer projection.

Principles:

- All write-capable Agent skills must execute through Tool Broker, Policy, Trace, and Approval.
- No Agent path may directly write files or mutate workspace state outside broker-managed APIs.
- Reuse existing Lattice services first; do not duplicate PDF item, annotation, file identity, or storage logic.
- If precise PDF text coordinates are unavailable, the Agent must not fabricate highlights; it must downgrade to area/text/comment plans and record the downgrade reason in trace.

Planned skill modules:

- `src/lib/ai/lattice-skills/path-identity.ts`
- `src/lib/ai/lattice-skills/pdf-item-skill.ts`
- `src/lib/ai/lattice-skills/pdf-annotation-skill.ts`
- `src/lib/ai/lattice-skills/note-taking-skill.ts`
- `src/lib/ai/lattice-skills/notebook-skill.ts`
- `src/lib/ai/lattice-skills/skill-config.ts`
- `src/lib/ai/lattice-skills/operation-contract.ts`
- `src/lib/ai/lattice-skills/proposal-planned-writes.ts`
- `src/lib/ai/lattice-skills/skill-registry.ts`

Registry status:

- Current-thread foundation completed: `src/lib/ai/lattice-skills/skill-registry.ts` now registers `path-identity`, `note-taking`, `notebook-analysis`, and `knowledge-organization` as AI Agent-thread skills.
- PDF-reserved foundation completed: `pdf-item-workspace` and `pdf-annotation` are registered as PDF-thread owned and hidden from default current-thread listings.
- Readiness helpers completed: `listLatticeSkills`, `getLatticeSkill`, `listLatticeSkillsForWorkflow`, and `buildLatticeSkillReadiness` provide typed entry points for future P6 slices.
- Operation contract foundation completed: `src/lib/ai/lattice-skills/operation-contract.ts` records Lattice-specific operation rules for path identity, Workbench draft/writeback safety, PDF item manifests, annotation sidecars, notebook execution boundaries, and knowledge organization proposals.
- Skill descriptors now map to `operationContractIds`, and Research Agent workflow execution profiles inject the resolved operation contracts into planner hints without enabling any new write tools.
- QA coverage completed: `src/lib/__tests__/ai-lattice-skill-registry.test.ts` covers default PDF hiding, workflow mapping, ownership, approval-gated skills, and readiness summary.
- QA coverage extended: `src/lib/__tests__/ai-lattice-skill-registry.test.ts` and `src/lib/__tests__/ai-research-agent-workflows.test.ts` cover operation contract mapping, Workbench overwrite safety hints, PDF item manifest rules, annotation sidecar merge/fabrication prohibitions, notebook mutation boundaries, and PDF-thread reservations.

P6.0 Path Identity Skill:

- Add a pure resolver for Lattice path identity.
- Input: `workspaceRootPath`, `filePathOrAbsolutePath`.
- Output: `latticePath`, `fileId`, optional `itemFolderPath`, optional `annotationPath`.
- Must preserve workspace root prefix rules such as `atom/Categorized Papers/paper.pdf`.
- Must reuse or align with existing file identity helpers.
- Add Tool Broker tool later: `lattice.resolvePathIdentity`.

Status:

- Pure resolver completed: `src/lib/ai/lattice-skills/path-identity.ts` adds `resolveLatticePathIdentity`.
- Resolver reuses `resolveFileIdentity`, `getAnnotationFilePath`, `getDefaultPdfItemFolderPath`, and `getPdfItemAnnotationIndexPath`; it does not create folders, write manifests, or mutate annotations.
- Outputs include `latticePath`, `fileName`, canonical `FileIdentity`, primary/candidate file ids, annotation sidecar path, optional PDF item folder path, optional item manifest path, and optional annotation index path.
- Desktop workspace display prefixes are stripped before file id derivation while preserving canonical display paths through the existing file identity helper.
- QA coverage completed: `src/lib/__tests__/ai-lattice-path-identity.test.ts` covers workspace-relative PDF paths, desktop absolute paths under the workspace display path, web workspace canonical fallback, annotation sidecar paths, and PDF item paths.
- Tool Broker read-only integration completed: `lattice.resolvePathIdentity` now runs through Agent Tool Broker with `read_workspace` capability. It returns the pure `LatticePathIdentity` result, standard result envelope metadata, and Trace tool result records; it performs no writes.
- Policy behavior completed: research/writeback/automation profiles inherit the existing `read_workspace` behavior, while plain chat still denies the tool by policy.
- Workflow planner integration completed: workflow allowed-tool lists now include `lattice.resolvePathIdentity`, so planner hints expose the path identity tool schema to Research Agent workflows.
- Default Research Agent execution completed: when `runResearchAgent()` receives a real `filePath`, the deterministic fallback/default plan inserts `resolve-lattice-path-identity` between context pack creation and evidence resolution. The read-tool loop executes it as a read-only planned tool and records the result in tool observations plus Trace/compaction audit metadata.

P6.1 PDF Item Workspace Skills:

- Future PDF-window tools:
  - `pdf.ensureItemWorkspace`
  - `pdf.createReadingNote`
  - `pdf.createNotebook`
- Must reuse or align with `src/lib/pdf-item.ts`.
- Must not overwrite existing note/notebook files.
- Writes must be approval-gated.
- Trace must show manifest path, target path, and artifact filename.

P6.2 PDF Annotation Skills:

- Future PDF-window tools:
  - `pdf.appendAnnotations`
  - `pdf.createAnnotationIndexMarkdown`
  - `pdf.planAnnotationsFromReading`
- Must read and merge existing `.lattice/annotations/<fileId>.json`; never overwrite blindly.
- Must support highlight, underline, area, text, ink, comment where existing annotation model supports them.
- Precise text annotation requires coordinate provenance.
- Coordinate-less plans must downgrade safely and explain why in trace.

P6.3 Configurable Note-Taking Skill:

- Add a typed `NoteTakingSkillConfig` model with:
  - language
  - note style
  - template
  - file naming policy
  - section list
  - quote policy
  - annotation policy
  - notebook policy
  - approval mode
- Defaults should support academic reading notes with sections:
  - one-sentence takeaway
  - key claims
  - evidence
  - methods/setup
  - results
  - open questions
  - links
- Memory can store user preferences only after approval.
- Each workflow can override default config per run.

Status:

- First current-thread slice completed on 2026-06-07.
- Added `src/lib/ai/research-agent-workflows.ts`.
- Added `DEFAULT_NOTE_TAKING_SKILL_CONFIG` and `resolveNoteTakingSkillConfig`.
- Workflow defaults can merge note style, quote policy, annotation policy, notebook policy, sections, language, naming, and approval mode.
- Explicit per-run/user overrides win over workflow defaults.
- Second current-thread slice completed on 2026-06-09.
- `buildResearchAgentWorkflowExecutionProfile()` now includes the resolved note-taking contract in planner hints, so per-workflow defaults and user overrides are visible to the Agent before draft/proposal handoff.
- Agent QA smoke now includes `ai-research-agent-workflows.test.ts`, keeping note config and workflow execution profile behavior in the standard unit gate.
- Third current-thread slice completed on 2026-06-09.
- `AiDraftSuggestion` now supports draft `content`, `targetPath`, and `writeMode`, so Research Agent workflow results can hand a complete Workbench draft contract to AI Chat instead of only a title/template hint.
- `src/lib/ai/lattice-skills/note-taking-draft-planner.ts` maps `NoteTakingSkillConfig` into draft title, default target path, create write mode, workflow metadata, quote policy, annotation policy, approval mode, evidence list, generated workflow output, and configured section scaffolding.
- Reading Note, Literature Matrix, Markdown Research, and Notebook Analysis now create evidence-backed draft suggestions through the same contract; Knowledge Organization and Teaching Explain remain proposal/answer-oriented and do not create implicit drafts.
- AI Chat follow-up draft saving now preserves the structured draft content and target path when creating the Workbench draft, keeping the UI one-click and avoiding an extra review dialog.
- Fourth current-thread slice completed on 2026-06-09.
- `research-agent-chat-runner` now delegates note-taking draft planning to the shared planner, reducing duplicated title/content/path logic before future note/notebook/organization skill work.
- `pdf-title` naming now uses PDF evidence labels or locators to generate safer Workbench draft targets such as `AI Drafts/<PDF title> Reading Note.md`; this improves paper-reading draft handoff without creating PDF item workspaces or annotations in this thread.
- Agent QA smoke now includes `ai-note-taking-draft-planner.test.ts`, covering reading-note draft content, date-title naming, pdf-title evidence naming, workflow artifact type mapping, and answer/proposal-only workflows that should not emit drafts.

P6.4 Workflow Presets:

- Add workflow presets:
  - `paper-reading` (implementation remains PDF-window scoped where needed)
  - `pdf-annotation` (PDF window)
  - `reading-note`
  - `notebook-from-paper` (PDF window for paper extraction; current thread can own generic notebook workflow)
  - `literature-matrix`
  - `knowledge-organization`
  - `teaching-explain`
- Each workflow must define prompt preset, context budget profile, allowed tools, output artifact policy, approval policy, trace labels, and tests.

Status:

- First current-thread slice completed on 2026-06-07.
- Added typed workflow preset registry for:
  - `markdown-research`
  - `reading-note`
  - `notebook-analysis`
  - `literature-matrix`
  - `knowledge-organization`
  - `teaching-explain`
  - `paper-reading` (PDF-scoped, opt-in)
  - `pdf-annotation` (PDF-scoped, opt-in)
  - `notebook-from-paper` (PDF-scoped, opt-in)
- `listResearchAgentWorkflows()` hides PDF-scoped workflows by default.
- `buildResearchAgentWorkflowPlannerHints()` generates planner-safe workflow hints from allowed tools, artifact policy, approval policy, note config, and preset hints.
- Shared Research Agent surface runner now accepts `workflowId` and per-run note config overrides, resolves the workflow registry, injects workflow hints into the LLM planner prompt, and passes workflow metadata into the core Research Agent run.
- Core Research Agent runs now store workflow id/title in result metadata and the `plan-created` trace event.
- Chat-formatted Research Agent answers now include the active workflow when one is selected.
- AI Chat no longer exposes workflow selection in the primary input path; P4 owns product-level automatic workflow inference, while Command Palette / seeded advanced runs can still preselect non-PDF workflows backed by `listResearchAgentWorkflows()`.
- Product-level automatic workflow inference status is tracked under P4. P6.4 remains the typed preset/config registry and Lattice skill adaptation backlog behind that product behavior.
- Selection AI agent mode now infers `notebook-analysis` for notebook/code selections and `markdown-research` for other non-PDF default contexts.
- Command Palette now exposes built-in Research Agent workflow commands for non-PDF workflows. Running a workflow command opens AI Chat and selects that workflow without bypassing Chat context collection, Tool Broker, approval gates, or Trace.
- Second current-thread slice completed on 2026-06-09.
- `buildResearchAgentWorkflowExecutionProfile()` turns each workflow preset into an internal execution profile with current-thread Lattice skills, read-only skills, approval-gated skills, workspace-write boundaries, PDF-reserved skill reminders, and skill tool lists.
- `buildResearchAgentWorkflowPlannerHints()` now injects the execution profile into the planner prompt, so workflow behavior is still automatic from Chat/Selection AI while the Agent receives precise Lattice capability boundaries.
- PDF-scoped workflows can include read-only path identity context, but PDF item workspace and annotation writeback remain reserved and explicitly described as non-executable in this AI Agent thread.
- Chinese workflow inference hardening completed: tests now cover Chinese notebook output analysis, literature-review comparison tables, knowledge-base organization, teaching explanations, and reading-note draft requests, with the literature-matrix route protected from broad notebook `experiment` false positives.

P6.5 Policy Capabilities:

- Added capabilities:
  - `lattice_read_identity`
  - `lattice_create_pdf_item`
  - `lattice_write_pdf_annotation`
  - `lattice_create_note`
  - `lattice_create_notebook`
  - `lattice_update_note`
- Current-thread implementation completed on 2026-06-09:
  - `chat`: denies `lattice_read_identity` and all Lattice writes, preserving plain Chat as non-workspace-mutating.
  - `research`: allows `lattice_read_identity` automatically and keeps note/notebook/update Lattice writes approval-gated.
  - `writeback` / `automation`: allow `lattice_read_identity` automatically and keep all Lattice writes approval-gated.
  - `lattice.resolvePathIdentity` now uses `lattice_read_identity` in Tool Broker policy, Trace, and decision metadata.
  - `LatticeSkillDescriptor.requiredCapabilities` maps each skill to explicit Agent capabilities.
  - Workflow execution profiles now include required Lattice capabilities in planner hints.
  - PDF item workspace and PDF annotation capabilities are defined for policy clarity but remain reserved for the PDF implementation window; no current-thread PDF write tool is enabled.

P6.6 Lattice Operation Contracts:

- Current-thread implementation completed on 2026-06-09.
- Added `src/lib/ai/lattice-skills/operation-contract.ts` as a typed, testable contract layer for Lattice project rules that the Agent must respect before tool planning or artifact handoff.
- Contracts now cover:
  - Path identity: resolve canonical Lattice paths, file id candidates, annotation sidecar path, PDF item folder path, manifest path, and annotation index path before planning writes.
  - Workbench draft handoff: use `AiDraftArtifact` / `AiDraftSuggestion`; default to `AI Drafts`; do not write markdown directly; do not overwrite existing explicit create targets; append only to explicit Markdown targets.
  - PDF item workspace: `.lattice/items/<generated-file-id>/manifest.json` is version 4 and PDF-thread reserved; child notes, notebooks, annotation indexes, and manifest migration must reuse `pdf-item.ts`.
  - PDF annotation sidecar: `.lattice/annotations/<fileId>.json` normalizes to version 3; future writes must read/merge existing sidecars; precise highlights require coordinate provenance; coordinate-less plans must downgrade with Trace provenance.
  - Notebook boundary: runner execution and notebook mutation remain approval-gated; prefer proposals for experiments and new notebooks.
  - Knowledge organization: multi-note structure, links, and indexes must start as Workbench proposals with planned writes.
- `LatticeSkillDescriptor.operationContractIds` maps each skill to its required operation contracts.
- `buildResearchAgentWorkflowExecutionProfile()` now exposes `operationContracts` and injects formatted contract hints into `buildResearchAgentWorkflowPlannerHints()`, so automatic workflows still receive project-specific Lattice rules without adding UI controls.

P6.7 Proposal Planned Writes:

- Current-thread implementation completed on 2026-06-10.
- Added `src/lib/ai/lattice-skills/proposal-planned-writes.ts` as a pure planned-write planner for Workbench proposals.
- `buildLatticeProposalPlannedWrites()` now:
  - preserves valid model-proposed `targetPath` / `mode` pairs after path normalization,
  - filters unsafe absolute paths and `..` traversal targets,
  - fills empty `contentPreview` values from proposal summary, steps, and evidence refs,
  - creates a conservative `AI Drafts/<summary> Plan.md` create-mode fallback when model output is invalid JSON or omits write targets.
- `AiOrchestrator.proposeTask()` now derives `plannedWrites` and `approvedWrites` from the planner, so proposal-first workflows such as Knowledge Organization produce Workbench-reviewable target drafts by default without direct workspace mutation.
- Agent QA smoke now includes `ai-proposal-planned-writes.test.ts` and `ai-orchestrator.test.ts`, covering planned write normalization, unsafe path filtering, fallback planned writes, and orchestrator proposal integration.

Acceptance:

- Agent can resolve Lattice path identity correctly for workspace-prefixed paths.
- PDF child docs and annotations are created only through approved tools in the PDF implementation window.
- All write-capable skills create Trace records and Approval requests.
- Users can configure note templates, style, naming, quote policy, and annotation policy.
- Memory stores only user-approved preferences.
- Unit tests cover path rules, manifest builders, annotation schema builders, config merging, and policy decisions.

Latest verification:

- `npx vitest run "src/lib/__tests__/ai-research-agent-workflows.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-planner.test.ts" --maxWorkers=2`
- `npx vitest run "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent-llm-planner.test.ts" "src/lib/__tests__/ai-research-agent.test.ts" "src/lib/__tests__/ai-research-agent-workflows.test.ts" --maxWorkers=2`
- `npx vitest run "src/components/ai/__tests__/ai-chat-panel.test.tsx" "src/lib/__tests__/selection-actions.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-research-agent-workflows.test.ts" --maxWorkers=2`
- `npx vitest run "src/components/ui/__tests__/plugin-command-dialog.test.tsx" "src/components/ai/__tests__/ai-chat-panel.test.tsx" "src/lib/__tests__/selection-actions.test.ts" "src/lib/__tests__/ai-research-agent-workflows.test.ts" --maxWorkers=2`
- `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/ai-research-agent-workflows.test.ts" "src/lib/__tests__/ai-research-agent-chat-runner.test.ts" "src/lib/__tests__/ai-result-view-model.test.ts" "src/components/ai/__tests__/ai-chat-panel.test.tsx" --maxWorkers=1`
- `npm run typecheck`
- `npm run test:docs`

Research targets before implementation:

- `src/lib/pdf-item.ts`
- `src/lib/universal-annotation-storage.ts`
- `src/types/universal-annotation.ts`
- `src/hooks/use-file-system.ts`
- `src/lib/file-identity.ts`
- `src/lib/pdf-document-binding.ts`
- `src/lib/ai/agent-tool-broker.ts`
- `src/lib/ai/agent-policy.ts`
- `src/lib/ai/research-agent.ts`
- `src/lib/ai/agent-memory.ts`

## Immediate Next Code Package

Completed on 2026-06-07 for AI Chat:

1. Add Research Agent action to AI Chat.
2. Build `runResearchAgentFromChat` helper or hook.
3. Use current runtime settings to create planner generator.
4. Collect active file/content/selection/evidence context.
5. Call `runResearchAgent`.
6. Append assistant message with answer/evidence refs.
7. Ensure Trace Panel opens/shows session.
8. Add tests for configured provider, provider missing/default plan, planner failure fallback.

Definition of done:

- User can trigger a real Research Agent run from AI Chat without test-only helpers.
- Result is visible in chat.
- Trace is visible and connected to the run.
- Planner warnings are visible.
- No write/draft/proposal/code action bypasses approval.

Next coherent package:

1. Add browser smoke for AI Chat -> Research Agent -> Trace/Evidence. Done on 2026-06-07.
2. Add browser smoke for Selection AI -> Research Agent -> Chat/Trace/Evidence. Done on 2026-06-07.
3. Start P2 controlled multi-step tool loop design and tests. First read-tool loop slice done on 2026-06-07.
4. Add command/workflow surface entries for markdown research, notebook analysis, knowledge organization, and teaching. Done through Command Palette workflow commands on 2026-06-07.
5. Continue P2 approval pause/resume, cancellation, step-limit work, and result previews. Step-limit/cancellation checks, artifact approval resume finalization, and richer tool result previews done on 2026-06-08.
6. Start P6 current-thread slice: workflow preset registry plus configurable note-taking skill model, leaving PDF write tools to the PDF window.
   - Done on 2026-06-07 for registry/config foundation.
   - Done on 2026-06-07 for shared surface runner workflow injection, planner hints, trace/result metadata, and chat formatted workflow summary.

Next coherent package:

1. Add richer workflow result views beyond text-first chat output.
2. Continue P2 loop hardening: UI polish around structured previews and surfacing reconciliation status in chat/result summaries.
   - Step limit, cancellation checks, artifact approval resume finalization, richer tool result previews, generalized approval reconciliation, and Trace Panel approval-to-reconciliation wiring completed on 2026-06-08.
3. Add workflow-specific browser smoke coverage for at least `reading-note` and `notebook-analysis` through Command Palette or seeded diagnostics state.
4. Add command-palette workflow diagnostics that assert command selection opens AI Chat with the selected advanced workflow preset while the default Chat UI remains automatic.

## Required Verification Commands

For AI Agent work:

```bash
npx vitest run "src/lib/__tests__/ai-research-agent*.test.ts" "src/stores/__tests__/agent-session-store.test.ts" "src/stores/__tests__/agent-memory-store.test.ts" "src/components/ai/__tests__/agent-trace-panel.test.tsx" --maxWorkers=2
npm run typecheck
```

After UI changes:

```bash
npx vitest run "src/components/ai/__tests__/*.test.tsx" --maxWorkers=2
npm run typecheck
```

Before broad handoff:

```bash
npm run test:run
npm run typecheck
```
