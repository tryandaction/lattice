# Lattice Plugin System Cleanup Plan

Date: 2026-06-28

## Goals

- Keep the plugin system focused on real product value instead of demo entries.
- Make plugin settings feel like a professional product surface: compact, clear, theme-aware, and bilingual.
- Ensure app-level dialogs capture pointer, wheel, context-menu, and keyboard interaction so modal actions do not leak to the workbench below.
- Align the command center and plugin entry icons with the requested visual direction.

## Scope

### Keep

- `formula-extractor`: official built-in plugin. It remains trusted and enabled by default.
- User-installed plugins from the local plugin store. They remain available, but require trust before enabling.

### Hide From Official Built-ins

- `core.hello`
- `core.panel-demo`
- `core.word-count`
- `core.table-of-contents`
- `core.markdown-linter`
- `core.code-formatter`
- `core.template-library`
- `core.citation-manager`

These modules can stay in the codebase as development references, but they should not be registered as official built-in plugins until they are product-ready and localized.

## UI Design

- Settings > Extensions shows a concise plugin header, search, global enable toggle, and a single official tool card for Formula Extractor.
- Plugin cards show:
  - name and description
  - status badge
  - source badge
  - version/author in muted metadata
  - compact permission chips
  - one primary enable checkbox/toggle
- Built-in official plugins are trusted by default and show a trusted badge instead of a separate trust checkbox.
- User-installed plugins keep the trust flow, but the action is button-like and visually separated.
- Plugin ID and raw permission strings are no longer the main reading path.

## Modal Interaction Contract

- App-level modals use `UI_MODAL_OVERLAY_CLASS` / `UI_MODAL_PANEL_CLASS`, which sit above resize handles and floating workbench UI.
- Modal panels stop pointer, mouse, click, context-menu, wheel, drag, and keyboard propagation.
- Overlay clicks close the modal only when the user clicks the overlay itself, not when an event bubbles from dialog content.

## Icon Updates

- Command center uses `SquareTerminal`.
- Plugin/extension surfaces use `Cable`, closer to the requested plugin icon direction.
- Plugin panel surfaces continue to use a panel icon where the meaning is specifically "panel", not "extension settings".

## Verification

- Registry test confirms only Formula Extractor is exposed as an official built-in plugin.
- Command dialog tests continue to pass.
- Typecheck must pass.

## 2026-06-29 Closure Notes

- Official built-in registry now exposes only `formula-extractor`; demo plugins are no longer registered as product plugins.
- Settings > Extensions uses compact official/trusted/status badges and no longer foregrounds raw demo-style metadata.
- Command center and plugin dialogs use elevated modal layers to cover workbench split handles and stop event propagation from leaking to the page below.
- Desktop plugin dock now matches the plugin icon language, has a wider scan-friendly panel list, and shows command action errors inline instead of failing silently.
- Plugin command runtime now records missing commands in the audit log and rejects the promise, so callers can show useful feedback.
- Plugin shortcuts catch command failures and avoid unhandled promise errors.
- Formula Extractor panel catches command failures and displays them inline.

## 2026-06-29 Verification

- `npm run test:run -- "src/components/ui/__tests__/plugin-command-dialog.test.tsx" "src/lib/__tests__/plugin-formula-extractor-registry.test.ts" "src/plugins/formula-extractor/__tests__/panel.test.tsx"`: 3 files, 14 tests passed.
- `npm run typecheck`: passed.
