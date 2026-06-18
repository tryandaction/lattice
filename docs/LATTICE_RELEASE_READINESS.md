# Lattice Release Readiness

This document is the release gate for Lattice desktop candidates. A candidate is not ready when core smoke is failing, even if new features are working.

## Launch Scope

Primary launch surface:

- PDF annotation
- Image viewing and image annotation diagnostics
- Markdown Live Preview
- Notebook/Python runner
- AI evidence/workbench

Maintain but do not expand before launch:

- PPT viewer
- Word viewer
- Plugin surfaces
- Webview surfaces

## Required Commands

Run from the project root:

```bash
npm run typecheck
npm run test:run
npm run build
```

Desktop release candidates must also pass:

```bash
npm run tauri:build
```

For the full local release gate:

```bash
npm run qa:gate
```

Use `npm run release:prepare -- --dry-run` when checking release metadata without writing release files.

## Targeted Checks For Current High-Risk Areas

Run these when changing PDF, code runner, workspace search, or Explorer behavior:

```bash
npm run test:run -- "src/components/renderers/__tests__/code-editor-viewer.test.tsx"
npm run test:run -- "src/lib/__tests__/pdf-highlighter-adapter-utils.test.ts"
npm run test:run -- "src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx"
npm run test:run -- "src/components/layout/__tests__/workspace-search-panel.test.tsx"
npm run test:run -- "src/components/explorer/__tests__/tree-view.test.tsx"
```

Run these when changing image viewing, image annotations, or the image edit model:

```bash
npm run test:run -- "src/components/renderers/__tests__/image-viewer.test.tsx"
npm run test:run -- "src/lib/__tests__/image-tldraw-state.test.ts"
npm run test:run -- "src/lib/__tests__/tldraw-serialization.test.ts"
npm run test:run -- "src/lib/__tests__/non-destructive-editing.test.ts"
npm run test:run -- "src/lib/__tests__/image-editor-operations.test.ts"
npm run test:run -- "src/lib/__tests__/image-editor-scientific.test.ts"
npm run test:run -- "src/lib/__tests__/image-editor-canvas-pipeline.test.ts"
```

## Desktop Smoke Gate

Before tagging or publishing a desktop candidate, complete [Desktop Smoke Checklist](./DESKTOP_SMOKE_CHECKLIST.md).

Minimum manual flow:

- Open workspace.
- Open PDF.
- Create PDF annotation.
- Jump to annotation from sidebar/backlink.
- Open an image, zoom/pan/rotate, create an image annotation, read sidecar, remount, and confirm restore.
- Write Markdown and verify live preview.
- Run a Python notebook cell.
- Restart and confirm workspace/layout/tabs/view state restore.

## Known Launch Limits

- Code files support editing and local run flows, but full VS Code parity is not part of this gate yet.
- LSP completion, debugger breakpoints, remote kernels, and rich project indexing are post-launch scope.
- PPT/Word/plugin/Webview must remain usable, but are not the launch growth surface.
- Browser-only checks do not replace real Tauri desktop smoke.

## Fail Criteria

Block the release if any of these occur:

- React runtime crash, including maximum update depth errors.
- Blank pane after opening common code, Markdown, PDF, or notebook files.
- PDF annotations do not persist or cannot be navigated from the sidebar.
- Image annotations do not persist, cannot restore from sidecar, or cause the background image to disappear.
- Notebook/Python runner failures are hidden from the user instead of appearing in output or Problems.
- Workspace restore loses the last workspace, active file, pane layout, or critical view state.
- Test output is noisy enough that a real failure is hard to identify.

## v2.3.0 Current Gate Snapshot

Updated: 2026-06-07.

Completed automated checks in this pass:

- `npx tsc --noEmit --pretty false`
- `npm run test:run -- src/components/main-area/__tests__/universal-file-viewer.test.tsx src/components/renderers/__tests__/pdf-viewer.test.tsx`
- `npm run test:browser-regression:pdf -- --continue-on-failure`
- `npm run build`
- `npm run tauri:build`
- `npm run release:prepare -- --skip-qa`

Current PDF regression status:

- Browser PDF.js probe passed.
- PDF render/text/layout segment passed with Rydberg two-column, formula, ligature, Greek-name, and citation probes.
- PDF interaction segment passed with pane-scoped sidebar and zoom flows.
- PDF state segment passed with scroll, file switch, and manual zoom restore.
- Default PDF open path is intentionally kept on the lightweight `PDFViewer`; annotation/highlighter mode remains explicit until its PDF.js lifecycle is fully stabilized.

Current v2.3.0 desktop artifacts in `releases/v2.3.0/`:

- `Lattice_2.3.0_x64_en-US.msi` SHA256 `02910b717af4429b99e4818ff01d231e82d6ca00697eea5a1edaaf86e67a1a68`
- `Lattice_2.3.0_x64-setup.exe` SHA256 `2466165d25384d225d7482f76fd26705afd09d73b66d03fa7651ce8b9bf63b8f`
- `lattice.exe` SHA256 `d16796bd2b5af362970cd7b8e183842280c494793b0334bf2a5b26469bab18c4`

Current AI / coding agent release status:

- `code-change-plan` produces reviewable coding proposals without direct writes.
- Approval-gated QA Runner creates trace-visible approval requests and imports resolved results into Evidence.
- Evidence entries imported from QA approvals link back to the source Agent Trace.
- Co-work Session Inbox aggregates local Agent session status and workspace risk.
- Shell, network, git, direct workspace write, and automatic QA execution remain intentionally disabled by default.

Remaining manual gate before final publish:

- Install NSIS setup and MSI on a real Windows desktop session.
- Launch the installed app, open a real workspace, open a real Rydberg-style two-column paper PDF.
- Smoke selection/copy/highlight around formulas, right-column body text, cross-line highlights, Greek symbols, superscript/subscript notation, ligatures, and citation numbers.
- Save a PDF annotation, restart, and confirm restore/jump back to the annotation.

`release-manifest.json` currently reports `gitDirty: true`; final external publishing should be done from a clean release commit or with an explicit decision to publish a dirty local build.
