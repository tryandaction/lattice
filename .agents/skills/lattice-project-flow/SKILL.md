---
name: lattice-project-flow
description: Use when working on the Lattice repository for feature development, release prep, deployment, or stage-close tasks. Covers the repository-specific execution order, release policy, local-vs-remote boundaries, and quality gates for PDF, Word, Markdown, code, and desktop/web delivery.
---

# Lattice Project Flow

## Core Rules

- Treat `npm run qa:gate` as the required pre-release gate.
- Treat `npm run release:prepare` as the canonical local release packager.
- Update desktop release artifacts locally under `releases/` only.
- Do not assume `releases/` should be committed; check `.gitignore` first.
- Do not deploy remotely unless the user explicitly asks to deploy.
- Do not run `git commit` or `git push` unless the user explicitly confirms.

## Release Policy

- Local desktop release refresh:
  - Run `npm run qa:gate`
  - Then run `node scripts/prepare-release.mjs --skip-qa` only if `qa:gate` already passed in the same phase
- Full local release packaging:
  - `npm run release:prepare`
- Dry-run metadata check:
  - `npm run release:prepare -- --dry-run`

## Deployment Policy

- Web deployment:
  - Use `npm run deploy:web` only when the user explicitly asks to update the live web deployment.
- Desktop release:
  - Refresh local artifacts in `releases/v2.1.0` or the current versioned folder.
  - Do not assume GitHub Release upload is desired.

## Default Execution Order

For stage-close work, prefer this order:

1. Implement or refine code changes.
2. Run focused tests for the changed area.
3. Run `npm run typecheck`.
4. Run `npm run qa:gate` before stage-close if the user expects a releasable state.
5. If requested, refresh local desktop release artifacts.
6. If explicitly requested, deploy web.
7. If explicitly requested, `git add`, `git commit`, `git push`.

## Feature-Specific Guidance

### PDF Work

- Prefer changes in `src/components/renderers/pdf-highlighter-adapter.tsx` for the real PDF reading workflow.
- `src/components/renderers/pdf-viewer.tsx` is not the primary annotated PDF experience.
- For PDF search, keep result data and page overlay coordinates in the same normalized coordinate space.
- For PDF bibliography, prefer:
  - local metadata extraction first
  - DOI / arXiv enrichment second
  - copy/export actions third

### Word Work

- `src/components/renderers/word-viewer.tsx` is the active Word preview path.
- `docx` should preview through `mammoth`.
- `doc` should degrade gracefully with a compatibility notice and import path.
- If Word preview seems "broken", first verify the file is not being filtered out by `src/lib/constants.ts`.

### Search Work

- For cross-file search, prefer the shared extraction utility in `src/lib/searchable-text.ts`.
- Keep workspace search and viewer-local search logically separate:
  - workspace search for discovery
  - viewer search for within-document navigation
- Reuse existing editor-native search where available instead of building parallel systems.

## Testing Priorities

- For PDF viewer changes:
  - `src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`
  - `src/components/renderers/__tests__/pdf-viewer.test.tsx`
  - related `src/lib/__tests__/pdf-*`
- For Word viewer changes:
  - `src/components/renderers/__tests__/word-viewer.test.tsx`
- For workspace search changes:
  - `src/components/layout/__tests__/workspace-search-panel.test.tsx`
  - `src/lib/__tests__/searchable-text.test.ts`

## Known Practical Boundaries

- Some older tests may emit `act(...)` warnings without blocking real functionality.
- Treat failing deterministic tests as blockers.
- Treat warnings as cleanup work unless they block release confidence.

## Final Close-Out Expectations

- State exactly what changed in product behavior.
- Distinguish:
  - code shipped
  - local release updated
  - web deployed
  - Git pushed
- If only local release was refreshed, say so explicitly.
