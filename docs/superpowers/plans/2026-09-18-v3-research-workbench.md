# Lattice v3.0 Research Workbench Implementation Plan

> Execute task-by-task using subagent-driven-development and verification-before-completion. User authorization covers implementation and local release preparation; no git operations or remote publishing.

**Goal:** Deliver verifiable AI evidence navigation and configurable research workflows, harden reading/editing, and produce a locally validated v3.0.0 release.

**Architecture:** Reuse CitationContract → shared link router → pane navigation completion; reuse existing research workflow registry, configuration, and Agent execution. Keep PDF, Markdown, and HTML fixes inside their existing modules.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, Zustand, CodeMirror 6, PDF.js, Vitest, Playwright, Tauri 2.

**Spec:** `docs/superpowers/specs/2026-09-18-v3-research-workbench-design.md`

## Global Constraints

- Preserve existing uncommitted work. No commit, push, branch, remote deployment, core dependency upgrade, or live private-data AI requests.
- Read installed Next.js guides before edits; use failing regression tests for production behavioral fixes.
- Final release requires `npm run qa:gate` and real interaction checks. Record failures honestly.
- Only one top-level task is in_progress. Independent scoped audits may run alongside implementation; no competing file ownership.

## Todo

| Task | Status |
| --- | --- |
| 1. Repository baseline and design | completed |
| 2. Evidence navigation and scoped product audits | completed |
| 3. Configurable research workflow and reader fixes | completed |
| 4. Integrated browser/desktop regression and full quality gate | completed |
| 5. v3.0.0 packaging, checksums, release notes | completed |

## Task 1: Baseline

- [x] Inspect status, architecture, existing roadmap, scripts and release folders.
- [x] Read local Next.js client/static-export guides and Context7 CodeMirror/PDF.js references.
- [x] Run typecheck: passed.
- [x] Run focused baseline: 23 files / 146 tests passed. jsdom emitted two unsupported document navigation notices.
- [x] Design follows existing contracts instead of adding another execution framework.

## Task 2: Evidence navigation

Files: `src/lib/link-router/parse-link-target.ts`, `src/lib/ai/citation-contract.ts`, `src/lib/reference-navigation.ts`, `src/components/ai/chat-timeline.tsx`, associated existing tests.

- [x] Regression examples: `paper.pdf#page=3&text=Energy%20A%2BB%20%26%20C`; quoted text split across Markdown lines; citation chip invokes the existing evidence callback immediately.
- [x] Observe failing tests before fixing parsing order/decoding and navigation semantics.
- [x] Preserve PDF page/snippet target, strict evidence binding, and source detail access.
- [x] Verify focused tests and real source click with deterministic local fixtures.

## Task 3: Research and readers

Files: `src/components/ai/chat-composer.tsx`, existing workflow configuration/store/runner modules; `src/components/renderers/pdf-highlighter-adapter.tsx` and geometry modules; Markdown live-preview and HTML/web viewers only for demonstrated defects.

- [x] Audit existing workflow selection/configuration to execution and persistence; implement missing user-visible connection without new workflow engine.
- [x] Audit PDF pointer selection and persistence; fix reproducible high-impact inconsistencies with regression tests.
- [x] Audit Markdown special-format and HTML preview behavior; fix demonstrated defects while retaining source editing.
- [x] Read independent review findings and resolve blocking issues before integration.

## Task 4: Verification

- [x] Run focused tests for all changed areas and `npm run typecheck`.
- [x] Run browser regression for AI links, PDF, Markdown and HTML; inspect screenshots and console output.
- [x] Run desktop smoke if supported by the current Windows session.
- [x] Run `npm run qa:gate`; fix deterministic failures and rerun affected gates.

## Task 5: Release

- [x] Update package, lockfile, Cargo and Tauri version metadata to 3.0.0; preserve dependency versions.
- [x] Refresh changelog and release notes with actual behavior and current limits.
- [x] After gate success run `node scripts/prepare-release.mjs --skip-qa --artifacts-dir src-tauri/target/release`.
- [x] Verify artifact versions, size and SHA256 against manifest; report any unvalidated installation/real-provider boundary.

## Execution ledger

- 2026-09-18: Existing dirty workspace retained; no worktree because user forbids unsolicited branches and current uncommitted integration is required. Release output does not exist yet.
- 2026-09-18: No `update_plan`/`create_memory` tools available; this file is the persistent task board. Sequential-thinking used for high-level verification strategy, Context7 for library-specific references.
- 2026-09-18: Reproduced then fixed bare-PDF anchor misrouting, encoded delimiters, multi-line Markdown snippets, absolute Windows evidence paths, and direct source navigation. Focused verification: 125 tests passed before the final review fixes.
- 2026-09-18: Research selector and note settings now feed the runner; settings include validation, serialized persistence, default restoration, and protection against stale hydration. Scheduled execution is clearly unavailable instead of accepting unexecutable tasks.
- 2026-09-18: PDF stale quote resolution/search retry guards, stable Markdown renderer identities, HTML local styles/images, and isolated webpage fallback implemented.
- 2026-09-18: Independent review found valid multi-line code locators rejected and fallback iframe refresh ineffective. Both corrected, covering tests passed (24 tests).
- 2026-09-18: Browser regression passed all PDF segments across two runs. The first run lacked the real-paper path; the remaining run used the repository's existing Saffman paper. Image annotations, Selection AI, provider/chat failure recovery, AI links, research-agent and performance flows also passed. Expected mocked HTTP failures appear in provider failure tests.
- 2026-09-18: Full `qa:gate` started with v3.0.0 metadata. Results and package verification pending.
- 2026-09-18: First gate: lint 0 errors, typecheck and docs passed; 380/381 test files passed, 2874/2875 tests passed. The scheduling tool still requested approval for unavailable execution; fixed the broker's preflight and its covering test (12/12 passed). A verified `citation:` token was also stripped by ReactMarkdown's URL filter; a failing UI test now covers a narrow evidence-bound exception (19 citation/renderer tests passed).
- 2026-09-18: Final gate restarted after fixes. Additional browser UI proof passed: source chip to PDF quote frame, settings and reload persistence at 1440×1000 and 1000×800, and main-workspace HTML styles/images at 1440×960. No page errors in those checks.
- 2026-09-18: Second gate found a real Agent terminal-state bug when unavailable scheduling emitted a terminal error before the plan loop recorded its result. Changed the unavailable broker response to a failed tool observation; the runner now records the actual failure once, without impossible approval or masked trace error. Agent/broker/planner focused 50/50 passed.
- 2026-09-18: User explicitly authorized parallel agents and required all directions accepted before product update. Acceptance is fixed in `docs/V3_ACCEPTANCE.md`; an active task goal tracks the complete local release.
- 2026-09-18: Independent final PDF pass fixed search-close/file-switch scroll cancellation and callback ordering, added late-success/invalid-page cases (16 focused passed). Workflow pass fixed restore ABA and in-progress draft overwrite (16 focused passed).
- 2026-09-18: Release pass added exact installer version tokens, Windows PE ProductVersion verification before output replacement, and opt-in isolated Tauri diagnostic profiles. Release-script 4/4 and Rust diagnostic-profile 3/3 passed. Third complete gate started after integration.
- 2026-09-20: Revalidated authoritative state after continuation: the third gate is terminal, with 380/381 files and 2885/2887 tests passing. Two PDF adapter failures concern deep-page rendering without IntersectionObserver notification and first-click sidebar navigation to an unrendered page. No live gate/build process and no `releases/v3.0.0` output exist. PDF specialist owns reproduction and correction; release remains unapproved until the failures and desktop/package checks are resolved.
- 2026-09-20: PDF gate root cause was the test DOM helper resetting a live scroller and replacing its scroll spy whenever another page rendered. Kept the same geometry assertions/timeouts and initialized scroll properties only once. Complete PDF adapter suite passed 139/139 in 44.58s; no production behavior was weakened. Full gate restarted as `lattice-v3-qa-gate-20260920.log`.
- 2026-09-20: Full qa:gate exited 0: ESLint 0 errors / 151 warnings, typecheck, 111 docs, 381 files / 2887 tests, both Next production builds, Rust release, MSI and NSIS succeeded. ProductVersion/FileVersion of the new executable and MSI ProductVersion are 3.0.0. Isolated desktop smoke and final packaging remain in progress.
- 2026-09-20: MSI administrative extraction succeeded at a short native Windows path (long extraction path initially failed). NSIS extraction succeeded with 8215 files; its executable SHA256 matches target/release. Both extracted programs passed code/Markdown save, JavaScript run, move and extension host smoke with no page/console errors. Basic desktop PDF and main-workspace PDF markup checks passed using isolated profiles and a copied paper.
- 2026-09-20: User observed oversized highlights in the visible test window. Verified exact provenance: hard-coded real-paper seed rectangles, not the transient selected quote. Real-paper diagnostics now resolve seed text markup against real page text; browser screenshot and stored rect check pass. User additionally requires real mouse-preview/saved-highlight/boundary-adjustment consistency, so release remains blocked despite the preceding gate success.
- 2026-09-20: Specialist identified a real geometry discrepancy: initial authoritative creation uses raw PDF.js TextItem approximations, while boundary adjustment uses rendered text-node Range glyph measurements; authoritative stored geometry can lock in the first approximation. A regression and shared measured-model fix are being developed before another full gate/rebuild. No v3 release directory has been published.
- 2026-09-20: Real MSI pointer evidence confirms same-ID quote rect/indices differ before and after boundary adjustment (single-line x drift about 8.25 px; multi-line `direc tions` becomes `directions`). New measured-model fix passed 226 focused tests and real single-line preview/save/boundary comparison at 0 px delta. Independent multi-line browser check still found 0.75 px per-edge preview/save height difference, traced to pixel-vs-normalized merge settings. A short-selection test also proved quote-only repair leaves stale offsets and expands `For small` to `i For small`. Both remain active PDF consistency blockers; no passing smoke is used to waive them.
- 2026-09-20: Follow-up isolated the trustworthy-Range bug from a jsdom drag fixture that had preselected text before pointerdown. The reconciler now synchronizes exact Range offsets/geometry together. The new preview path uses the persistent overlay's normalized merger. Latest 4 PDF files / 226 tests and typecheck passed. Real browser comparison: single-line highlight and narrow-viewport underline all edges 0 px; multi-line 1440 viewport all edges 0 px; 1920 viewport max 0.015625 px; resize normalized delta <0.000071. New full `qa:gate` is running in `output/v3-validation/evidence/qa-gate-geometry-final.log`; old installers remain non-final.
- 2026-09-20: Geometry gate completed 380/381 files, 2896/2897 tests. Sole failure was the old source-string contract requiring PDFium-only selection, despite production deliberately selecting validated DOM geometry. Updated it to require native PDFium probe, trusted down/up, real copy/persistence and no synthetic pointer/preselected Range in the mouse selector. All 8 contract tests passed. Full release gate restarted as `qa-gate-geometry-release.log`; no product code changed after the geometry browser verification.
- 2026-09-20: The next gate passed 381 files / 2897 tests and frontend/Rust builds. New-binary desktop comparison proved initial/restored single/multi-line quote, offsets and geometry agree, but exposed intermediate shortening reuse: repeated unchanged pointer offsets could restore original multi-line rects while text remained shortened. Added a failing regression and guarded original-rect reuse by exact quote identity. Adapter + adjustment 154/154 passed. Stopped the now-obsolete task-owned NSIS build (no user process touched) and restarted the full gate as `qa-gate-boundary-final.log`. Final release remains pending this final correction and new-binary intermediate-boundary validation.
- 2026-09-20: Final gate passed 381 files / 2898 tests, both frontend builds and the Rust release build; installer bundling is running. The staged new binary passed real single-line and multi-line mouse selection, shortening, restoring, Ctrl+C and persistence validation: restored screen geometry delta is 0 px in both cases; stored normalized delta is below 1.2e-8. Main-workspace PDF smoke also passed. Independent read-only review found no blocking regression and adjustment tests passed 10/10. Evidence: `output/v3-validation/evidence/desktop-boundary-final-validation.json` and `desktop-boundary-product.json`. Final installer checks and packaging remain pending.
- 2026-09-20: Final `qa:gate` exited 0 and both installers completed. Final MSI administrative extraction and NSIS extraction each passed code execution, Markdown save, file move and extension interaction with no page/console errors. MSI ProductVersion and both embedded executable versions are 3.0.0; NSIS embedded executable SHA256 matches target/release. Source freeze unchanged (1090 files); final docs check passed 111 files. Local release assembly is now authorized by the completed acceptance gates.
- 2026-09-20: Canonical release preparation completed with verified status at `releases/v3.0.0`; independent manifest verification passed all three binary sizes and SHA256 values. Added installation guidance, release notes, QA report and PDF fix evidence. Five acceptance directions and local packaging are complete, within the documented live-provider / cross-machine / HTML / scheduled-execution limits. No commit, push, branch, remote deployment or replacement of the user's installed app occurred.
