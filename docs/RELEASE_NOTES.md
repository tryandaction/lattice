# Lattice v2.3.1 Release Notes

Release date: 2026-06-28

## Release Focus

This build closes the current polish pass for the web and desktop products, with emphasis on formula input, Markdown/PDF interaction, release safety, and dependency hygiene.

## Highlights

- PDF item workspaces now support folders and arbitrary file types instead of limiting companion entries to Markdown and notebooks.
- PDF item folders now expand in Explorer and the PDF Item panel, so nested companion files of any type can be browsed and opened.
- Dragging a file or folder onto a PDF in Explorer moves it into that PDF's item workspace and immediately refreshes the PDF's virtual child tree.
- PDF item routing now recovers annotations and companion files across PDF moves, renames, copies, and alternate workspace roots through manifest and fingerprint lookup.
- Quantum Keyboard now follows the physical-keyboard model: only the 26 QWERTY letter keys are shown in the HUD, while number keys keep normal keyboard behavior.
- Candidate insertion supports `Shift+number+letter`; for example, `Shift+2+I` inserts the second candidate for `I`.
- Double-Tab opening from Markdown/CodeMirror no longer writes an unwanted tab or blank indentation into the document.
- MathLive structure insertion now uses placeholders and moves into the first slot after inserting brackets, fractions, matrices, and cases.
- Rendered formulas now expose right-click actions for `Copy Markdown formula` and `Copy LaTeX formula`.
- Markdown frontmatter extraction no longer depends on `gray-matter`; the app now uses a small local parser for the simple metadata shapes Lattice needs.
- Dependency audit is clean after removing the old `gray-matter/js-yaml` chain and overriding `esbuild` to `0.28.1`.

## Validation

Completed on 2026-06-28:

- `npm audit --registry=https://registry.npmjs.org --audit-level=moderate`: 0 vulnerabilities
- `npm run typecheck`: passed
- PDF item drag/drop and nested-folder focused regression tests: `src/lib/__tests__/pdf-item.test.ts`, `src/components/renderers/__tests__/pdf-item-workspace-panel.test.tsx`, `src/components/explorer/__tests__/tree-view.test.tsx`, `src/components/main-area/__tests__/universal-file-viewer.test.tsx`, and `src/stores/__tests__/workspace-store-execution.test.ts` passed
- `npm run lint`: passed with 0 errors and 120 existing warnings
- `npm run test:docs`: passed, 40 files checked
- Focused regression tests for Markdown extraction, workspace indexing, Quantum Keyboard, formula copy, unified input, and HUD behavior: 36 tests passed
- `npm run test:run`: 247 files passed, 1874 tests passed
- `npm run build`: passed
- `npm run tauri:build`: passed
- `npm run release:prepare -- --version 2.3.1 --artifacts-dir src-tauri/target/release`: passed
- PDF copy routing smoke: copied the Jandura/Pupillo 2022 Rydberg gates PDF into `atom/Theoretical Research/taiyi/essay/`; source and copy hashes match, and the PDF item manifest now records both the original and copied paths.
- `npm run test:desktop:pdf-smoke`: passed against the built desktop executable

Note: the full Vitest run still emits jsdom's informational `Not implemented: navigation to another Document` line, but the suite exits successfully with no failed tests.

## Desktop Artifacts

Artifacts are available in `releases/v2.3.1/`:

- `Lattice_2.3.1_x64_en-US.msi` SHA256 `a058fed7fd4b1a3c2305e302b2b0f58971863acdeefa7e9d9b1737aa4f7bd5d5`
- `Lattice_2.3.1_x64-setup.exe` SHA256 `8ffe0b7f053a5476043b21fff1e6a46f838e591ae9f03e18cfcfab0c65198ef6`
- `lattice.exe` SHA256 `6b2039593ab01d6e89ed0b48f437619de6c3451589fcf5041f57feade2901dfc`

## Desktop/Web Sync

- `next build` successfully generated the production frontend.
- `tauri:build` rebuilt the same frontend through Tauri's `beforeBuildCommand` and packaged the desktop app from that output.
- `release:prepare` copied the latest desktop executable and installers into `releases/v2.3.1/` and regenerated manifest, checksums, and release summary.
- The desktop PDF smoke script now waits for newly created annotation overlays before opening their menus, so the real WebView smoke covers the asynchronous annotation render path.

## Manual Smoke Before External Publishing

Before distributing outside the local development machine, run a real Windows desktop smoke pass:

- Install the NSIS setup package and launch Lattice.
- Open a real workspace and verify recent workspace restore.
- Open Markdown, PDF, and Notebook files.
- Verify Quantum Keyboard Double-Tab open, formula insertion, and rendered formula right-click copy.
- Create and jump to a PDF annotation.
- Confirm close-with-unsaved Markdown still prompts correctly in the installed desktop app.
