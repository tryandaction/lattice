# Lattice v2.3.1 Release Notes

Release date: 2026-06-28

## Release Focus

This build closes the current polish pass for the web and desktop products, with emphasis on formula input, Markdown/PDF interaction, release safety, and dependency hygiene.

## Highlights

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
- `npm run lint`: passed with 0 errors and 114 existing warnings
- `npm run test:docs`: passed, 40 files checked
- Focused regression tests for Markdown extraction, workspace indexing, Quantum Keyboard, formula copy, unified input, and HUD behavior: 36 tests passed
- `npm run test:run`: 247 files passed, 1874 tests passed
- `npm run build`: passed
- `npm run tauri:build`: passed
- `npm run release:prepare -- --version 2.3.1 --artifacts-dir src-tauri/target/release`: passed
- `npm run test:desktop:pdf-smoke`: passed against the built desktop executable

Note: the full Vitest run still emits jsdom's informational `Not implemented: navigation to another Document` line, but the suite exits successfully with no failed tests.

## Desktop Artifacts

Artifacts are available in `releases/v2.3.1/`:

- `Lattice_2.3.1_x64_en-US.msi` SHA256 `54a5e122b4185b47cc3c347bc154af834edf23b36807f442bfa76512989ac31e`
- `Lattice_2.3.1_x64-setup.exe` SHA256 `345f946336e2d9df26995731c85170b3bb7a8441530beee6c1d65a58efa0373a`
- `lattice.exe` SHA256 `41613e1413d21f3a99680a196d7671bd0462dbdb529adb7e0ccc1d399e490a07`

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
