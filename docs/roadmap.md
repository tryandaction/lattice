# Lattice Product Roadmap

Last updated: 2026-06-16

## Product Positioning

Lattice is a local-first research workspace for researchers, students, and technical teams. The product should combine:

- Zotero-grade PDF reading and annotation accuracy.
- Obsidian-style local files, notes, backlinks, and item workspaces.
- Notebook/code execution for reproducible research.
- Evidence-first AI agents that read, cite, annotate, draft, and organize work under user approval.
- A small, safe, high-quality plugin system for extensibility.

The near-term product goal is not to become a generic note app. Lattice should become a serious research operating system: PDF, notes, code, data, and AI all working on the same local evidence layer.

## Current Baseline

### PDF Reader And Annotations

Status: core fixed and release-ready for v2.3.0.

Completed capabilities:

- Zotero-style text markup pipeline: mouse/selection geometry is reconciled against PDF character models instead of trusting DOM selection text.
- Highlight and underline render as line-level text segments, not large paragraph blocks.
- Quote, copied text, stored character offsets, rects, and rendered highlight segments are aligned through canonical anchoring.
- Existing highlight, underline, area, text, pin, and ink annotations respond to click/hit-test.
- Area annotations no longer block ordinary text selection.
- PDF item workspace and `_annotations.md` sidecar format support persisted local annotations.
- Desktop release smoke test verifies the Saffman Fig. 5 target quote and six rendered line segments.

Remaining work:

- Maintain a corpus-level regression suite across representative papers.
- Productize AI-created PDF annotation drafts through the same sidecar contract.
- Keep performance budgets visible for selection, annotation rendering, page switching, and reopen/restore.

### AI Agent Workbench

Status: strong foundation, not yet fully productized.

Completed capabilities:

- Agent session, capability policy, tool broker, traces, memory, context pack, workspace summary cache.
- Formal research-agent orchestration with planning, tool calls, evidence resolution, draft/proposal creation, and approval gates.
- Available tools include workspace search/read, path identity resolution, evidence resolution, draft/proposal creation, code runner, and memory write.
- Selection AI, chat panel, workbench drafts, and proposal surfaces exist.
- Lattice operation contracts define approval-gated skills, including `pdf-annotation-sidecar`.

Gaps:

- Chat, selection AI, command palette, and workflow presets are not yet fully unified around one visible agent run model.
- Plan/trace UI needs a clearer execution timeline, tool IO preview, approval resume, and failure recovery.
- PDF annotation by AI is defined in contracts but still needs a polished user-facing flow.
- Agent results need a durable result page or run notebook, not only transient chat output.

### Plugin System

Status: runtime foundation exists, ecosystem is not yet ready.

Completed capabilities:

- Active plugin registry, command registration, panels, sidebar/toolbar/statusbar UI slots.
- Permission model for files, annotations, network, UI, editor extensions, themes, and storage.
- Plugin settings, key-value storage, workspace/vault events, modal/notice/settings helpers.
- Command dialog can show plugin commands and research-agent workflow commands.

Gaps:

- Need a simple plugin SDK, scaffolder, examples, and manifest validation.
- Need plugin manager UX: install, enable, disable, inspect permissions, view health/audit logs.
- Need API stability tiers and version compatibility checks.
- Some UI text and docs need encoding/i18n cleanup before public release.

### Core Workspace

Status: promising local-first base, needs polish and reliability hardening.

Strengths:

- PDF item workspaces, Markdown notes, notebook/code runner, file explorer, annotations panel, command palette, and AI workbench are already connected.
- Local-first storage is a strong commercial differentiator for privacy-sensitive research.

Risks:

- Documentation and some UI strings have stale or corrupted text.
- Performance needs product-level budgets and automated regression checks.
- Onboarding, update flow, crash reporting, diagnostics, and migration safety need hardening before a paid beta.

## Priority Path

### P0: Keep PDF Correctness Locked

- Add fixed regression fixtures for Saffman and a representative local corpus.
- Run automated checks for quote/rect consistency, multi-column selections, underline segments, area hit-test, reopen/zoom stability, and sidecar round trips.
- Add a developer diagnostic view that shows selected quote, character offsets, rect count, page, source, confidence, and repair status.

### P1: Productize AI PDF Annotation

- Expose an approved AI annotation workflow:
  - AI proposes quotes, notes, tags, and target PDF item.
  - Lattice resolves each quote through canonical PDF text anchoring.
  - User previews exact rendered rects before applying.
  - Accepted annotations are written to `_annotations.md` with source tags such as `ai`, `review`, `question`, or `important`.
- Reject or queue ambiguous matches instead of writing fabricated rects.
- Make AI-created annotations visually distinguishable but editable like human annotations.

### P2: Make Agent Runs A First-Class Product Surface

- Add an Agent Runs view with plan steps, evidence, tool calls, approvals, outputs, and final artifacts.
- Let users rerun, resume, cancel, or convert runs into notes/subdocuments.
- Connect command palette, selection AI, chat, and workflow presets to the same run model.
- Keep all writebacks approval-gated by default.

### P3: Ship A Small High-Quality Plugin SDK

- Provide `create-lattice-plugin`, typed APIs, examples, and a local plugin marketplace folder.
- Start with three plugin categories: PDF workflows, note/workspace automation, and export/report generation.
- Add permission review, compatibility checks, health logs, and safe uninstall.

### P4: Commercial Hardening

- Add update channel, release notes in app, diagnostics export, crash logs, and support bundle.
- Improve first-run onboarding around PDF, annotations, AI workbench, and local privacy.
- Define a paid beta boundary after PDF correctness and AI annotation workflows are stable.

## Commercial Strategy

Recommended market wedge:

- Start with researchers and graduate students who read many PDFs and need trustworthy AI help.
- Position against Zotero plus Obsidian plus generic AI chat, not against only one tool.
- Emphasize local-first evidence, exact PDF annotation, reproducible notes/code, and controlled AI writeback.

Potential paid tiers:

- Free: local PDF reading, notes, manual annotations, basic workspace.
- Pro: AI research workflows, AI PDF annotations, agent history, advanced OCR/repair, export packs.
- Lab/Team: shared workflow templates, managed plugin packs, audit/export, institutional support.

Main risks:

- PDF correctness must stay visibly reliable. One bad annotation can damage user trust.
- AI writeback must be approval-first and evidence-linked.
- Plugin power must not make the product feel unstable or unsafe.
- Documentation and onboarding must be cleaner than the current internal state.

## Next Milestone

The next release after v2.3.0 should focus on:

1. PDF corpus regression and diagnostics.
2. AI PDF annotation proposal/apply flow.
3. Agent Runs page.
4. Plugin SDK beta skeleton.
5. Encoding/i18n/docs cleanup.

This combination turns the current technical foundation into a coherent product story: trustworthy PDF reading plus intelligent, user-controlled research automation.
