# Lattice Release Readiness

This document is the release gate for Lattice desktop candidates. A candidate is not ready when core smoke is failing, even if new features are working.

## Current v3.1.x integration

Updated: 2026-10-21. Version 3.1.3 passed the full gate (558 files / 4966 tests), was installed with unchanged preferences and credential-file hashes, and was deployed to the existing web origin. Desktop AI reference and PDF identity smokes passed on the same built executable. See [current delivery evidence](tests/2026-10-21-final-delivery.md) and [historical requirement coverage](superpowers/plans/2026-10-20-requirement-coverage.md). Earlier snapshots below are historical.

## v3.0.0 Candidate Status

Updated: 2026-09-27. **Targeted citations and effective Agent workflows passed final acceptance.**

The final gate exited 0: 387 test files / 2999 tests, typecheck, 114 docs, both frontend builds, Rust, MSI and NSIS. ESLint reports 0 errors / 154 warnings. Production web and the new desktop passed cross-file PDF/Markdown navigation, keyword and wrapped-sentence target frames, plus real loopback Anthropic requests through the Agent composer with durable annotation save/reopen/undo and no-write failure cases. Both extracted installers passed code/Markdown/extension checks. See `output/v3-validation/evidence/EFFECTIVE_WORKFLOWS_QA.md`. No live paid-provider call or installation over the user's existing app was performed. The September 21 and 20 snapshots below describe earlier builds.

The acceptance criteria are in [V3_ACCEPTANCE.md](./V3_ACCEPTANCE.md); the execution record is in [the v3 implementation plan](./superpowers/plans/2026-09-18-v3-research-workbench.md).

Latest September 21 correction: sentence-local independent links, multiple PDF pages and sources, same-page subquotes, shared inline/source navigation, and preservation of cited preambles/evidence text. Final gate exited 0 with 382 files / 2917 tests, 112 docs, typecheck, both frontend builds, Rust, MSI and NSIS. Development browser, production browser and new desktop each passed four inline links and sequential same-page/cross-page navigation. Both extracted installers passed code/Markdown/extension smoke. Current evidence: `output/v3-validation/evidence/INLINE_CITATIONS_QA.md`; plan: [inline evidence links](./superpowers/plans/2026-09-21-inline-evidence-links.md). The September 20 results below describe the initial v3 acceptance.

- AI source navigation, configurable research notes, Markdown stability, local HTML resources, and browser regression have implementation and focused validation evidence.
- The final 2026-09-20 gate exited 0: ESLint 0 errors / 151 warnings, typecheck, 111 documentation files, 381 test files / 2898 tests, frontend and Rust builds, MSI and NSIS. Both extracted installers passed isolated code execution, Markdown save, file move and extension interaction without page/console errors.
- The user's additional PDF blocker is resolved: previews and persistence share measured character geometry and normalized line merging; repeated boundary events cannot restore old multi-line rectangles after shortening. The final binary passed real mouse single-line/multi-line shortening and restoration, trusted Ctrl+C and stored-data reread. Restored screen geometry differs by 0 px in both cases; main-workspace PDF smoke also passed. Evidence is in `output/v3-validation/evidence/V3_QA_REPORT.md` and `desktop-boundary-final-validation.json`.
- Desktop smoke must set a unique `LATTICE_DIAGNOSTICS_PROFILE`, `WEBVIEW2_USER_DATA_FOLDER`, and `LATTICE_DESKTOP_SMOKE_KEEP_EXISTING=1`. The diagnostic identifier isolates Tauri stores and CodeOSS profiles; a browser-only profile does not isolate native stores.
- Release packaging now verifies exact installer version tokens and the Windows executable ProductVersion before replacing the release output directory. Dry-run output is explicitly unverified.
- `releases/v3.0.0` now contains MSI, NSIS, the executable, release notes, QA report, manifest and SHA256 checksums. All three binary sizes/hashes were independently checked against the manifest. This is a local release only; the installed user application was not replaced and no remote deployment or Git push occurred.

The historical v2 snapshots below do not prove v3 readiness.

## Launch Scope

Primary launch surface:

- PDF annotation
- Image viewing and image annotation diagnostics
- Markdown Live Preview
- Notebook/Python runner
- AI evidence/workbench
- Code workbench compatibility imports for common VS Code settings and task workflows

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

## v2.3.1 Current Gate Snapshot

Updated: 2026-07-23.

Completed automated checks in this pass:

- `npm audit --registry=https://registry.npmjs.org --audit-level=moderate`
- `npm run typecheck`
- `npm run lint`
- `npm run test:docs`
- `npm run test:run`
- `npm run test:run -- src/config/__tests__/quantum-keymap.test.ts src/components/editor/codemirror/live-preview/__tests__/math-rendering-output.test.ts src/lib/__tests__/unified-input-handler.test.ts src/components/hud/__tests__/hud-logic.test.ts src/components/hud/__tests__/keycap.test.ts`
- `npm run test:run -- src/__tests__/prepare-release-script.test.ts src/lib/__tests__/formula-composer.test.ts src/stores/__tests__/quantum-formula-library-store.test.ts src/config/__tests__/quantum-keymap.test.ts`
- `npm run build`
- `npm run tauri:build`
- `npm run release:prepare -- --version 2.3.1 --artifacts-dir src-tauri/target/release`
- `npm run test:desktop:pdf-smoke`
- `npm run test:run -- src/lib/vscode-compat/__tests__/storage.test.ts src/lib/vscode-compat/__tests__/mapper.test.ts src/lib/vscode-compat/__tests__/status.test.ts src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx src/components/renderers/__tests__/jupyter-renderer.test.tsx src/components/renderers/__tests__/code-editor-viewer.test.tsx`
- `npm run release:prepare -- --skip-qa --artifacts-dir src-tauri/target/release`

Latest 2026-07-23 gate results:

- Full Vitest: 864/864 suites and 2,263/2,263 tests passed.
- ESLint: 0 errors and 134 warnings; TypeScript passed; 85 documentation files passed.
- The pinned code-server 4.128.0 / Code OSS 1.128.0 / Node 22.18.0 runtime is
  now a mandatory Tauri resource in MSI and NSIS, eliminating the broken
  dependency on a developer-side `target/release/code-oss-runtime` directory.
- VS Code extensions are imported before Workbench startup, and new isolated
  profiles use Node's system certificate API instead of the hanging native
  Windows certificate addon.
- The constrained extension host refreshes stale imported extension paths by
  publisher/name identity after a VS Code extension version upgrade. Focused
  verification covers the recovery contract, 10 Rust host tests, and the real
  installed Claude Dev 4.0.10 entry.
- TypeScript excludes `.lattice-build` and `src-tauri/code-oss-runtime`, removing
  32,610 generated TypeScript inputs from the release typecheck without
  reducing application-source coverage. The full typecheck passed in 168s.
- The official dependency audit reports 8 findings (1 low, 2 moderate, 5 high).
  No breaking or package-mutating automatic fix was applied without approval.
- Final UI automation is pending because Windows was locked. Production build,
  package manifests, hashes, and automated regression are verified.

Current 2026-07-05 patch focus:

- VS Code compatibility is opt-in and no longer rescans the workspace on folder open.
- One-click VS Code import now loads the local profile without file picking and surfaces concrete import counts in Settings.
- Executable code, read-only code browsing, editable `.ipynb`, and read-only `.ipynb` now enter the VS Code Workbench Surface after import.
- Extension contribution scanning now covers languages, snippets, commands, views, view containers, menus, notebooks, notebook renderers, grammars, themes, debuggers, and configuration.
- `docs/VS_CODE_COMPATIBILITY_PLAN.md` records the shipped layer, near-term hardening plan, and future Extension Host Bridge boundary.
- Quantum Keyboard HUD now uses the 26-letter physical-keyboard model.
- `Shift+number+letter` candidate selection is covered by keymap tests.
- Markdown/CodeMirror Double-Tab startup no longer writes stray indentation.
- MathLive structure insertion moves into the first placeholder.
- Rendered formulas expose Markdown/LaTeX copy choices through the formula right-click menu.
- Markdown frontmatter extraction uses the local simple parser instead of the old `gray-matter/js-yaml` dependency chain.
- The official dependency audit currently reports 2 moderate findings through
  `pptx-preview -> echarts < 6.1.0` (GHSA-fgmj-fm8m-jvvx). npm offers only a
  breaking forced downgrade to `pptx-preview@1.0.0`; this release does not apply
  that unsafe automatic change and keeps PPT as a maintained, non-growth surface.
- Desktop PDF smoke passed after hardening the smoke bridge to wait for newly created annotation overlays before opening their menus.
- `docs/guides/quantum-keyboard.md` has been rewritten to match the shipped behavior.
- Native A2.1 Python debugging now has a real Tauri/debugpy path and a persistent
  Run and Debug activity-bar sidebar. Focused verification covers DAP framing,
  session cleanup, breakpoint persistence/verification, CodeMirror markers,
  stack/scopes/variables/evaluation, and the start-event race where debugpy can
  stop before the Tauri start command returns.
- Native A2.2.1 Node debugging uses pinned Microsoft vscode-js-debug 1.117.0 for
  local `node` / `pwa-node` program launches. A real smoke proves breakpoint,
  stack, scopes, local variables, continue, termination, and cleanup. Attach,
  browser/terminal, child/worker sessions, advanced breakpoints, and arbitrary
  extension adapters remain outside this release boundary.
- Direct extension language providers now have a real Host-to-CodeMirror path
  for Completion, Hover, Definition, Diagnostics, References, Formatting,
  current-file Rename, and current-file CodeAction. A real CommonJS fixture
  verifies all eight capabilities plus document version changes and background
  activation warm-up.
- Editable notebooks now expose a VS Code-style runtime/kernel toolbar and
  synchronize the active code cell to the Extension Host as a versioned virtual
  document. Focused frontend verification covers the notebook bridge and the
  left-gutter editor layout.
- The Extensions sidebar separates runnable entries from metadata-only imports
  and provides real activate/retry actions. Focused verification covers the
  desktop command wrapper, Zustand state transition, and sidebar interaction.
- Latest focused verification: 4 frontend files / 38 tests passed; Rust 64/64;
  `next build` completed with full TypeScript and 14 static routes.
- Language Client/Pylance/Rust Analyzer/ESLint/Volar service routing and
  multi-file WorkspaceEdit application remain explicit post-launch scope.

Current self-contained v2.3.1 build artifacts in `releases/v2.3.1/`:

- `Lattice_2.3.1_x64_en-US.msi` (303,078,413 bytes) SHA256 `72eac3079a9b7a46ea3f3b33780ab1695bebd151d4e9552b539c2e01148d761d`
- `Lattice_2.3.1_x64-setup.exe` (210,648,023 bytes) SHA256 `740910c7e451e4be9b25016b97bf0bd05c7e0206a593faba0669e0cd89ace613`
- `lattice.exe` (18,494,464 bytes) SHA256 `3b2a1ae75042b0176f62521153b25c4f492e05f55266a72702ac890ac6361f4f`

Desktop/Web sync status:

- `next.config.ts` exports production web assets to `web-dist`.
- `src-tauri/tauri.conf.json` keeps `build.beforeBuildCommand: "npm run build"` and `build.frontendDist: "../web-dist"`.
- The v2.3.1 Tauri build completed after rebuilding the same static frontend, so desktop and web products are aligned for this release.

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

- Code files now support editing, syntax highlighting, snippets, workspace
  settings import, task surfacing, one-click local VS Code profile import,
  installed extension contribution metadata, eight direct extension language
  Provider capabilities, and native local Python/debugpy plus Node/js-debug
  program-launch paths. This is not full VS Code extension, Language Client, or
  debugger parity.
- Remote attach, browser/terminal launches, child/worker debug sessions, advanced breakpoint conditions/logpoints, arbitrary extension-provided adapters, and rich project indexing remain post-launch scope.
- `stopOnEntry` is forwarded to debugpy but is not treated as a deterministic first-stop guarantee; line breakpoints are the supported deterministic stop path.
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
