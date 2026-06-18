# AI Coding Agent Roadmap

Last updated: 2026-06-18

This document scopes the next Lattice AI Agent slice for coding, co-work, and agent workflows. It builds on `AI_AGENT_WORKBENCH_PLAN.md` and `AI_AGENT_SYSTEM_TODO.md`: Lattice remains evidence-first, local-first, and approval-first. The goal is not to clone a generic autonomous coding agent; the goal is to make code review and change planning fit Lattice's mixed workspace of notes, papers, notebooks, code, evidence refs, and Workbench artifacts.

## External Benchmark

Current benchmarked systems converge on a small product contract:

- OpenAI Codex: repo instructions through `AGENTS.md`, coding tasks, review/debug flows, MCP/customization hooks, and auditable tool use.
- Claude Code: terminal-native coding assistant with settings, permissions, hooks, MCP, subagents, and memory through project guidance.
- OpenAI Agents SDK: agents, tools, handoffs, guardrails, sessions, human-in-the-loop, and tracing as explicit primitives.
- Open-source references: OpenHands, Aider, OpenCode, and Goose show that serious coding agents need file context, patch review, command/test loops, and permission boundaries.

Useful source map:

- https://developers.openai.com/codex/
- https://developers.openai.com/codex/guides/agents-md
- https://github.com/openai/codex
- https://code.claude.com/docs/en/overview
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/hooks
- https://openai.github.io/openai-agents-js/
- https://github.com/OpenHands/OpenHands
- https://github.com/Aider-AI/aider
- https://github.com/sst/opencode
- https://github.com/block/goose

## Current Lattice Stage

Lattice is in a late P5 / early P6 product-hardening stage for Research Agent infrastructure. The first coding-agent slice is now implemented as a reviewable, approval-first workflow rather than an autonomous writer:

- Strong: AgentSession, Trace, approval records, context packs, memory, workflow presets, Lattice skills, operation contracts, and Workbench draft/proposal handoff.
- Strong: policy denies shell/network/direct workspace writes by default and keeps draft/proposal/code/memory behind approval.
- Implemented: `code-change-plan` workflow preset, `coding-change-review` operation contract, coding-aware Workbench proposal planned writes, coding result surface, and reviewable target/risk/test/patch-preview output.
- Implemented: Approval-gated QA Runner planning that turns inferred target files into allowed/suggested/rejected command plans, creates Agent approval requests, records trace events, imports resolved approval results into Evidence, and links Evidence entries back to the source Agent Trace.
- Implemented: Co-work Session Inbox that aggregates local Agent sessions, pending approvals, handoff summaries, blocked/running state, and workspace dirty-file risk for multi-window handoff.
- Still intentionally denied: autonomous file editing, host shell, network fetches, git operations, production APIs, and automatic test execution.

## Product Target

First coding milestone: `code-change-plan`.

The workflow should:

- Read and search workspace context through Tool Broker only.
- Resolve Lattice path identity before planning file-targeted work.
- Resolve evidence and cite files, code selections, and workspace chunks.
- Produce a code review/change plan with target files, risk notes, patch preview, test plan, and approval path.
- Offer a Workbench proposal handoff; no draft, file write, shell, network, or git operation happens automatically.
- Keep all generated planned writes under reviewable `AI Drafts/...` paths unless a safe relative target is explicitly proposed.

## Development Route

### P0 Coding Review Contract

- Add `code-change-plan` workflow preset.
- Add `coding-change-review` operation contract.
- Add a `Coding Change Review` Lattice skill mapped to the workflow.
- Add workflow inference for code files and coding-review cues.
- Selection AI code selections should route to `code-change-plan`, while notebooks continue using `notebook-analysis`.

### P1 Proposal Artifact Contract

- Extend proposal planned writes with a coding-aware fallback.
- Include target files, patch/diff preview, risk checklist, test plan, and approval path in `contentPreview`.
- Keep unsafe absolute paths and `..` traversal filtered.
- Default fallback target: `AI Drafts/<summary> Code Review Plan.md`.

### P2 Result And Trace Surface

- Add workflow-specific answer output for `code-change-plan`.
- Add proposal follow-up action for `code-change-plan`.
- Reuse Agent result sections and Workbench proposal UI instead of adding another panel.

### P3 Approval-Gated QA Runner

- Implemented as a planning and approval handoff surface.
- Infers target files from the active workbench tab, dirty tabs, and Agent trace target paths.
- Produces allowed/suggested/rejected command plans for safe local validation scripts.
- Creates `runner.runCode` approval requests with markdown command plans only; it does not execute shell commands directly.
- Imports resolved approval results into Evidence with dedupe keys and source metadata.
- Supports Trace to protocol deep links and Evidence to source Trace backlinks.

### P4 Co-work Inbox

- Implemented as a local, auditable inbox inside Agent Protocol Center.
- Aggregates pending approvals, handoff summaries, blocked/running/completed session state, active trace focus, and workspace dirty-file risk.
- Exports inbox state into the protocol Markdown handoff.
- Still single-device/local-first; no background multi-agent scheduler or remote collaboration transport is enabled.

### P5 Hook/MCP Layer

- Future slice only.
- Add local hook contracts around tool requests/results.
- Keep MCP and network tools disabled until a dedicated permission model exists.

## First Slice Acceptance

- `code-change-plan` appears in non-PDF Research Agent workflows.
- Coding tasks and code files infer the workflow.
- Planner hints include the coding operation contract and the no-direct-write boundary.
- Agent output contains target files, risk, patch preview, test plan, and Workbench proposal next step.
- Workbench follow-up exposes a proposal action for coding workflow.
- Coding proposal planned writes filter unsafe targets and generate a safe review artifact fallback.
- Approval-gated QA Runner can create trace-visible approval requests without direct shell execution.
- Resolved QA approvals can be imported into Evidence and traced back to the source Agent session.
- Co-work Session Inbox exposes session status, pending approvals, handoff summaries, and workspace risk.
- Agent smoke unit set, typecheck, docs checks, and product build are required before release.

## Remaining Development Route

### R0 Patch/Diff Review Refinement

- Add richer structured diff previews for code-change proposals while keeping all writes as reviewable Workbench artifacts.
- Preserve the current target-file filtering for absolute paths, traversal, and non-workspace paths.
- Add focused tests for multi-file patch previews and rollback notes.

### R1 Approval Result Capture

- Add a typed attachment shape for command output summaries so QA approvals can store structured stdout/stderr/status metadata instead of relying only on `resultPreview`.
- Keep imports deduped by session, approval, and status.
- Keep Evidence backlinks to Agent Trace mandatory for imported runner results.

### R2 Local Hooks Layer

- Introduce local hook contracts around tool request/result events.
- Start with read-only observability hooks and policy checks.
- Do not enable MCP, network, or shell tools until a dedicated permission model and UI approvals exist.
