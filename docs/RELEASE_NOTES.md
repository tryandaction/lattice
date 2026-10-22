# Lattice v3.1.3 Release Notes

## October 21 AI reference completion correction

- Whole-file references finish immediately; page and heading references remain optional. The cursor moves past the separator synchronously and ordinary question text does not reopen the menu or become inserted into the path.
- Reserved characters and literal percent signs round-trip once. Incomplete encoded input remains editable. Folder filtering, parent navigation and direct typed paths are consistent.
- Missing explicit relative directories, including quoted paths with spaces, report a precise error instead of scanning unrelated files or substituting an earlier document.
- Local browser regression exercises the actual Composer, picker and source tools with synthetic documents and a deterministic provider replacement. No real model calls are made. The 3.1.3 gate, installer, desktop smokes and web deployment are recorded in [the October 21 record](tests/2026-10-21-final-delivery.md).

## October 21 Agent source and PDF revision refresh

- An explicit local folder path with spaces resolves by walking only its authorized path. This still works when the root has more than 12,000 unrelated entries. `@folder` references support Chinese request text directly after the path and remain scoped to that folder; reading still follows the existing file and byte limits.
- The `@` picker stays beside the composer, follows window resizing and scrolling, and supports nested folder browsing. Enter and Tab select a candidate before the composer can send the text accidentally. Picker labels follow the selected UI language.
- PDF formula OCR validates the loaded revision at all entry points. Stale rendered pixels are discarded, and the picker uses a high-resolution region capture.
- Desktop file revisions use filesystem metadata instead of the JavaScript time at which a `File` wrapper was created.
- Cloud operator monitoring validates reauthorization, UTC billing periods, vendor coverage, and freshness. Offline preflight reports missing configuration without claiming production deployment.

The final build, installation, preference-preservation, and desktop/web verification evidence is recorded in `docs/tests/2026-10-21-final-delivery.md`.

## Previous v3.1.1 formula recognition refresh

## October 21 formula recognition and PDF review

- The managed local CPU formula recognizer now uses the pinned Pix2Text-MFR-1.5 ONNX assets. Its source image, raw model prediction, token/truncation state and editable LaTeX stay available for review. A 72-image synthetic comparison showed better root, matrix-cell and aligned-equation structure than the previous bundled model; font-weight/style ambiguity and some 3x3 matrix outputs still require manual correction.
- PDF selection and annotation can recognize formulas from a high-resolution page-region crop even when PDF.js has no selectable text. Crop padding is independent of the saved annotation geometry, and zoom, rotation and device scale are covered by browser pixel regression.
- Plugin and PDF formula rendering share strict KaTeX safety limits. Untrusted HTML and external resource commands are rejected, and malformed or truncated OCR results cannot be silently copied or applied as verified output.
- Installed-product verification found and fixed a desktop file timestamp defect: each file read previously acquired a new synthetic modification time, so unchanged PDF selections and full scans could be rejected as changed. Snapshots now retain actual filesystem modification times, and plugin version checks read metadata without loading the whole PDF.
- The first candidate passed 4,860 tests but failed the installed formula workflow. Its result is retained; the corrected candidate requires a new full quality gate and installed-product verification. No model-provider calls are used.

The exact installed build, Web deployment, hashes, preference-preservation checks and remaining limitations are recorded in `docs/tests/2026-10-21-final-delivery.md` after release verification.

## Previous v3.1.0 refresh

## October 19 safe-closeout refresh

- Historical PDF annotations and research children retain their canonical storage identity when the workspace is opened at a parent or nested folder. The reported historical paper was verified in an isolated local copy through parent → child → parent, restoring 29 annotations and its child index each time without writing to the original documents.
- Batched file renames retain open-document identity and unsaved drafts. Desktop imports stage private chunks and commit without replacing an existing destination. Browser imports use a clearly named, unique import folder to protect existing workspace files.
- PDF, cloud-library and plugin controls receive further Chinese/English coverage. Formula results stay usable in narrow windows, retain edited LaTeX, and report a missing optional OCR backend explicitly. Native PDF formula extraction remains available without that backend.
- Desktop and web artifacts were refreshed from the same 2231-file source snapshot. The complete gate passed with 4621 tests and 2 skipped tests. The local desktop update preserves 43 preference fields, configured providers and 22 existing conversations. No additional real-model requests were made for this closeout.

Delivery evidence and remaining production operations are recorded in `docs/tests/2026-10-19-safe-closeout-delivery.md`. Local monitoring and recovery tooling does not mean production alert delivery, independent encrypted backups or a recovery drill have been deployed. The optional image-OCR model is not bundled.

## October 19 output-budget convergence

- Chat, streamed answers, Agent synthesis, document batches and reviewed file generation use the configured model's effective output ceiling. An empty answer at that ceiling no longer triggers the same capped request again. The ceiling is shared with the protocol adapter; user settings and model capability values are not silently increased.
- A failed JSON repair retains findings already verified against the original source and reports the remaining evidence gaps. Truncated answers with visible text can still continue without losing their prefix.
- Empty output at the ceiling has a localized Chinese/English explanation, including the effective token limit and reasoning settings. Hidden thinking is never presented as a completed answer.
- The October 17 refresh added private Supabase uploads up to 20 MiB, tested response-body timeout/cancellation and retry cleanup, PDF cross-column/cross-page annotation persistence, and file-watcher/drag-drop improvements. The initial 5 MiB notes below describe the earlier release.

Three additionally authorized synthetic glm-5.3 requests reached the native HTTP path: planning succeeded; two answer attempts had the current page-12 evidence but returned no visible text at the configured 8192-token model ceiling. The final attempt was a recovery diagnostic with historical planning/empty-output replay, not a fresh end-to-end run. These model results remain failed; the new ceiling behavior is validated with deterministic protocol/component tests. See docs/tests/2026-10-18-model-output-convergence.md for gates and remaining online limits.

## October 13 Agent and attachment refresh

- Chat and Agent resolve pasted desktop folder paths, including spaces and Chinese names, within the authorized workspace. An opened paper named in a request is read directly rather than blocked by an unrelated workspace scan. TeX and code paths are not mistaken for source requests.
- API Agent shares the 12 callable Lattice tools with the native assistant: actual source discovery/read/search, skill descriptions, PDF annotations and child files, reviewed file proposals, and bounded numeric calculation. Folder searches cannot finish with a paper conclusion before reading actual source text. Script execution retains the existing runner review boundary.
- The source picker is replaced with a compact attachment button. Files and validated PNG/JPEG/WEBP images can be uploaded, dropped or pasted, persist by conversation, and stay attached to follow-ups, retries and interrupted reading tasks. Unknown binary formats and damaged documents are explicitly unreadable. Native Codex accepts inline images; Claude image input remains unavailable in the current bridge.
- A private Supabase Storage backend is available for deployments without an R2 subscription. The initial backend supports a 5 MiB single-file limit and a 950 MB service budget, with user JWT/RLS and atomic blob registration. Deployment still requires operator authorization; this local desktop refresh does not make the hosted cloud library live.

Two specifically authorized synthetic live requests were used on October 13: Custom (Anthropic Messages) / glm-5.3 synthesized actual file-read and numeric-tool results in one API request; OpenAI / gpt-6.1-sol performed a native Codex tool request against a temporary synthetic file. No private documents were uploaded. The API run used a concrete pre-built plan, and the Codex run validated the native protocol rather than the complete product UI. Image transport is covered by protocol and browser tests, with no paid image-model inference claimed.

## October 12 desktop refresh

- Cloud libraries are a source inside the existing file workbench: the same file tree, tabs, pane splitting, viewers and editing controls. Local and cloud documents can share a layout.
- Right-click a local file or folder and select **上传到云端库…**. Confirm the destination library/folder; PDF uploads include linked annotations and research files. Legacy source bindings are checked and any omitted records are reported.
- Set **我的云库昵称** in shared-library management. Cloud PDF annotations display collaborator names, and the existing PDF item panel lists and creates cloud research children.
- Cloud Markdown and HTML can display relative images; save/reload, draft retention and access revocation use source-aware handling. Cancelling an obsolete read no longer interrupts synchronization.
- AI conversations keep prior source context after switching tabs and resolve files by name. Codex completed two authorized synthetic requests including a file tool call and remembered context. Claude's native protocol was repaired, but its configured DeepSeek model mapping was rejected by the upstream service; no successful Claude inference is claimed.

Nickname synchronization requires the included `202610120001_cloud_member_display_names.sql` migration and matching Worker API. Local delivery does not deploy the production service. Verification and installation evidence: `docs/tests/2026-10-12-cloud-context-runtime-repair.md`.

## Skins and plugin workflows

- Five coordinated skins — Lattice, Folio, Breeze, Atelier and Nocturne — each support light and dark modes. Workspace chrome, settings, editors, AI panels and plugin panels share color, typography, density, radius and motion tokens. PDF content retains its document geometry.
- Appearance settings support preview, cancellation, saved custom themes, validated JSON import/export, and a prompt/template exchange for AI-assisted theme design. Imported themes cannot execute scripts, inject arbitrary CSS or load remote assets. Custom theme storage failures are reported instead of pretending a save succeeded.
- A unified plugin center brings together installation, permissions, activation status, commands, settings, diagnostics and removal. Updating a plugin revokes its prior trust until it is reviewed again. Failed or interrupted bundle writes cannot expose a partially installed plugin as ready.
- Formula extraction can scan the current PDF page, a selection or the document. Results provide rendered previews, editable LaTeX, source navigation, Markdown/LaTeX copying and export. Corrections are used in exported files. Changing the source or unloading the plugin invalidates outstanding work.
- Text PDFs use measured glyph geometry and drawing structure for fractions and matrices. Image OCR remains an optional local backend; this build does not bundle pix2tex or certify its recognition quality. Source extraction and user correction remain available without that backend.

Release evidence and local desktop installation status are recorded in `docs/tests/2026-10-05-skins-plugins-integration.md`. Real paid model requests and compatibility with arbitrary Obsidian or VS Code plugins are outside this release's verification.

## Previous v3.0.0 release

Local verified build: 2026-09-27. Initial v3 acceptance is recorded in `docs/superpowers/plans/2026-09-18-v3-research-workbench.md`; targeted citations and effective Agent workflows are tracked in `docs/superpowers/plans/2026-09-21-targeted-claim-citations.md` and `docs/superpowers/plans/2026-09-21-agent-effective-workflows.md`.

## Research experience in v3.0

- September 21 targeted citation correction: supplied context pages are no longer displayed as an automatic source inventory. Chat and Agent cite short, verifiable original passages beside the claims they support. PDF and Markdown links switch the actual file, reveal the quoted content and outline its text with red dashed frames. Page-only or whole-file context cannot masquerade as a precise citation; unsupported or ambiguous quotes remain unresolved. Cross-file PDF/Markdown round trips no longer treat saved reading positions as cached text, and explicit citation navigation supersedes old reading-position restoration.
- Click the short citation beside a supported claim to open its original passage. PDF keywords and Markdown sentences use their actual character ranges, including wrapped lines, for red dashed target frames. Available context remains behind a separate context entry and is not displayed as a source inventory.
- Agent model requests retain the provider's actual model ID. Failed, empty or prompt-echo answers stop instead of presenting internal context as a successful answer; resumed production tasks rebuild evidence rather than treating truncated audit previews as source text.
- PDF annotation workflows produce at most five verified quote-and-reason proposals. Review and apply per file, wait for durable sidecar confirmation, and undo this batch while preserving annotations edited afterward. File identity and shared operation claims prevent a same-name file or a second pane from consuming the request. Failed AI writes restore earlier pending user edits.
- Research note settings reach the actual answer generator. Drafts contain generated content and persistent workspace citation links, without empty section scaffolds or repeated full-page previews. Memory suggestions are opt-in so unrelated approvals do not displace the task.
- Switch the composer to Agent to choose a research workflow. Expand Note settings to choose language, style, sections, quotation policy and a custom template. Settings persist locally and are passed into the research runner. Empty fields and Default restore the workflow defaults. Draft and write approval policies remain in place.
- Rapid PDF navigation no longer permits superseded quote lookups or search retries to move the viewport back. Persistent highlights and temporary AI evidence remain separate.
- PDF mouse-selection previews, saved highlights and boundary adjustments share measured text geometry and line merging. Shortening a multi-line selection updates its last line immediately, including repeated pointer events; restoring the original range preserves its text and position. Existing text markup can recover measured geometry when its quotation and location match.
- Markdown reading keeps image/link/code components stable when math support finishes loading. Local HTML previews resolve images, linked stylesheets and CSS image URLs from the granted workspace; source editing remains available.
- Browser webpage previews can fall back to a sandboxed direct frame, with an external-browser action for sites that restrict embedding. Desktop keeps its native webview path.

## Current boundaries

- Scheduled AI execution has no connected executor in this release and is explicitly unavailable; old entries remain visible for inspection/removal.
- HTML preview keeps scripts disabled. Complex bundled web apps, stylesheet import chains and responsive `srcset` assets are outside the local-resource resolver's current scope.
- Browser embedding remains subject to the destination site's frame policy. Local checks use deterministic AI fixtures and do not prove live-provider availability.
- Full VS Code extension parity and installation verification on another Windows machine are not part of this local build's evidence.

## Previous v2.3.2 foundation

Release date: 2026-08-31

## Release Focus

This build completes the current desktop and AI-workbench polish pass, with
profile-based multi-provider AI configuration, protocol-aware streaming,
controlled MCP configuration, responsive workspace startup, and refreshed
Windows release artifacts.

## AI Connections And MCP Settings

AI settings now support independent profiles for OpenAI Chat Completions and
Responses, Anthropic Messages, Google Gemini, Ollama, OpenRouter, Groq,
Together AI, Fireworks AI, SiliconFlow, Azure OpenAI, and custom
OpenAI-compatible or Anthropic Messages endpoints. Each connection keeps its
API key separate from its metadata and supports its own endpoint, protocol,
model, timeout, retry, and custom headers. The connection router selects the
active configured connection before falling back to legacy provider settings.

Each connection now keeps a persistent model catalog with a default model,
display name, context window, maximum output tokens, and enabled state. Users
can fetch available models, add model IDs manually, edit model metadata, set a
default, and remove entries without losing the legacy single-model setting.
Custom protocol connections intentionally start with an empty model catalog;
the protocol does not imply a model vendor. Users can fetch the gateway's
catalog or add the model IDs supported by their channel.

Connection tests now distinguish missing credentials, authorization, rate
limits, server failures, protocol mismatch, timeout, and browser/network
failures without exposing API keys. Streaming responses are normalized for the
supported Chat Completions, Responses, Anthropic, Gemini, and Ollama formats.

The MCP settings panel validates local stdio and HTTPS Streamable HTTP server
definitions and records a per-server tool approval mode. This release does not
automatically start MCP processes or execute remote MCP tools; those actions
remain intentionally explicit for a later runtime integration phase.

## 2026-08-17 AI Workspace Agent Reliability Fix

Research Agent answer synthesis can now fall back to the bounded local summary
without incorrectly marking the session as failed. This prevents the internal
`Cannot append trace event to terminal agent session` error from replacing the
answer when a provider-side synthesis request fails. Agent-mode questions are
also shown exactly as entered instead of exposing the internal
`[Research Agent]` routing prefix.

## 2026-07-23 Self-contained Workbench Release Fix

The Windows desktop packages now include the pinned code-server 4.128.0 / Code
OSS 1.128.0 runtime and Node 22.18.0. Production no longer depends on a runtime
directory left beside a developer build, a separately installed VS Code, or a
first-use server download. The packaged Server remains loopback-only and uses a
random per-process token.

VS Code extensions are imported into the isolated Lattice profile before the
Workbench process starts, so Code OSS discovers them during normal startup
instead of several seconds after the Extension Host is already running. A new
profile also enables Node's built-in Windows system certificate store instead
of loading the code-server native `windows-ca-certs` module that can stall on
the bundled Node runtime. Existing user settings files are never overwritten.

The constrained native extension bridge now also survives extension upgrades.
When an imported extension's recorded version directory has been replaced, the
host resolves the newest installed package with the same publisher/name ID and
refreshes its `main`, `browser`, and activation metadata before activation.
This fixes stale-entry failures such as a recorded Claude Dev 4.0.8 path after
VS Code has installed 4.0.10.

The release contract now requires `code-oss-runtime/**/*` in both MSI and NSIS.
The self-contained packages are consequently much larger than the earlier
invalid 14-17 MB shells: the verified NSIS is 210,648,023 bytes and the MSI is
303,078,413 bytes. TypeScript resource preparation is content-aware and leaves
unchanged files untouched, avoiding needless Tauri resource invalidation on
subsequent builds.

The release typecheck excludes the generated `.lattice-build` and bundled
`src-tauri/code-oss-runtime` trees. More than 32,000 generated TypeScript files
were previously captured by the repository-wide include glob; application
source coverage is unchanged while the full non-incremental typecheck now
finishes normally.

This change provides the real Code OSS editor, Explorer, terminal, Run and
Debug, Extensions view, and compatible extension webviews inside Lattice's
Workbench tab. It does not guarantee that every desktop VS Code extension is
web-compatible or that proprietary Microsoft-only extension services work in
Code OSS. The final automated desktop click-through remains pending because the
Windows session was locked during this build; static package inspection,
production compilation, and the complete automated test suite passed.

## 2026-07-20 Compatibility Truth Update

The Lattice-native VS Code surface is now explicit about what is real and what
is bounded. The left activity bar always exposes Run and Debug as a native
sidebar. Supported local Python `launch` configurations use a direct managed
`debugpy.adapter` DAP session. Supported local `node` / `pwa-node` program
launches use the pinned Microsoft `vscode-js-debug` 1.117.0 standalone server.
Both paths provide real file breakpoints, stepping, stack/scopes, variables,
selected-frame evaluation, and bounded output. Code files remain
open in Lattice's CodeMirror editor with VS Code-style markers and controls;
users do not have to reopen the folder in another workbench.

Remote attach, browser/terminal launches, child-process or worker debugging,
advanced breakpoint features, and arbitrary extension-provided debug adapters
remain explicitly unsupported and are shown as such. The compatibility layer
must not be read as full VS Code or Cursor/Trae parity. Earlier release notes
describing a complete real VS Code Workbench takeover are historical claims and
do not expand this verified native A2.1/A2.2.1 capability boundary.

## 2026-07-21 Extension Language Provider Bridge

Imported local CommonJS VS Code extensions can now affect the native Lattice
code editor through real Host calls instead of inventory-only icons. The bridge
supports Completion, Hover, Definition, Diagnostics, References, document
Formatting, current-file Rename, and current-file CodeAction/Quick Fix. Results
are versioned, path-checked, bounded by a 1.2 second provider timeout, and
isolated per extension. CodeMirror displays completion, hover, diagnostics, and
navigation directly; formatting and Quick Fix are available from the code
command bar. Opening a code file returns before language extensions activate,
while a deduplicated background warm-up prepares matching extensions.

This does not make every VS Code extension compatible. Extensions that depend
on `vscode-languageclient`, Pylance, Rust Analyzer, ESLint server, Volar, an
integrated terminal, remote services, or additional unimplemented APIs still
require separate LSP/service routing. Rename and CodeAction edits that touch
multiple files are rejected rather than partially applied.

## 2026-07-21 Notebook and Extension Activation Follow-up

Editable `.ipynb` notebooks now use a flatter VS Code-style notebook surface:
Run All, stop, restart, code/Markdown insertion, runtime management, and kernel
selection are grouped in one fixed toolbar; the selected interpreter path and
runtime state remain visible in a compact status row. Code cells use a left run
gutter with execution counts, square editor boundaries, and aligned problems
and outputs instead of independent rounded cards.

The active notebook code cell is synchronized to the Extension Host as a
versioned workspace-scoped virtual document. Matching language providers can
therefore contribute completion, hover, and diagnostics inside notebook code,
using the same bounded bridge as normal code files.

The Extensions sidebar no longer labels every inactive import as `skipped`.
Extensions with a runnable desktop entry are shown separately and can be
activated or retried explicitly; settings/theme/contribution-only imports are
collapsed under an honest metadata-only section. A failed extension remains a
per-extension compatibility diagnostic and does not mark the whole Host as
failed. Importing or listing an extension still does not prove compatibility:
activation must reach `active`, and extensions requiring unsupported VS Code
APIs or external language servers can still fail.

## Highlights

- Lattice desktop now starts the bundled, version-pinned Code OSS Web Workbench instead of relying on a locally installed VS Code Server or a simulated extension panel.
- The current Lattice folder opens in the real VS Code Explorer and editor, with official language services, integrated terminal, tasks, Testing, Run and Debug, Extensions, and webview infrastructure.
- The Server binds only to `127.0.0.1`, requires a random per-process connection token, and imports the user's standard `.vscode/extensions` inventory into an isolated Lattice extension profile before startup.
- The VS Code activity panel is now a compact native-runtime launcher and status surface; the full Workbench opens in a main-area native WebView tab.
- Claude Code for VS Code and Codex were validated in the real Workbench: Claude rendered its editable primary-editor webview, and Codex rendered its sidebar authorization UI.
- The first launch uses the runtime already carried by the installer; no VS Code Server download is required.
- Workbench readiness now handles VS Code's token-authentication redirect directly, so an already-running Server no longer remains stuck in `preparing` after its authentication cookie would have been lost during probing.
- PDF item workspaces now support folders and arbitrary file types instead of limiting companion entries to Markdown and notebooks.
- PDF item folders now expand in Explorer and the PDF Item panel, so nested companion files of any type can be browsed and opened.
- Dragging a file or folder onto a PDF in Explorer moves it into that PDF's item workspace and immediately refreshes the PDF's virtual child tree.
- PDF item routing now recovers annotations and companion files across PDF moves, renames, copies, and alternate workspace roots through manifest and fingerprint lookup.
- Copied PDFs now also recover their original PDF item workspace when the opened workspace root changes the relative path prefix, such as opening `atom/` directly after a manifest recorded `atom/...`.
- Quantum Keyboard now follows the physical-keyboard model: only the 26 QWERTY letter keys are shown in the HUD, while number keys keep normal keyboard behavior.
- Candidate insertion supports `Shift+number+letter`; for example, `Shift+2+I` inserts the second candidate for `I`.
- Double-Tab opening from Markdown/CodeMirror no longer writes an unwanted tab or blank indentation into the document.
- MathLive structure insertion now uses placeholders and moves into the first slot after inserting brackets, fractions, matrices, and cases.
- Rendered formulas now expose right-click actions for `Copy Markdown formula` and `Copy LaTeX formula`.
- Markdown frontmatter extraction no longer depends on `gray-matter`; the app now uses a small local parser for the simple metadata shapes Lattice needs.
- The old `gray-matter/js-yaml` chain is removed and `esbuild` is overridden to
  `0.28.1`. The 2026-07-23 official audit reports 8 findings (1 low, 2 moderate,
  5 high) across `brace-expansion`, `dompurify`, `echarts`, `fast-uri`,
  `linkify-it`, and `sharp`. Automatic fixes were not applied because part of
  the fix set requires breaking `pptx-preview` and `sharp`/Next changes.
- VS Code workspace config import is now supported for `settings.json`, `keybindings.json`, `snippets`, `tasks.json`, recommended extensions, and installed extension inventory.
- VS Code import is now a true one-click desktop action: Lattice scans local VS Code profiles automatically without asking users to choose JSON files or folders.
- Installed VS Code extension `package.json` contribution points are now read for languages, snippets, commands, debuggers, display names, versions, and categories.
- Extension language contributions now create Lattice file associations, and extension snippet JSON files are imported into snippet completion where Lattice can map the language.
- Imported VS Code workspace settings now map into Lattice editor options, file associations, file/search excludes, and snippet completions.
- Code files now honor imported file associations for language resolution, workspace search exclusions, and explorer exclusions.
- Imported VS Code tasks now run through the Lattice execution panel with stdout/stderr output.
- Imported VS Code `launch.json` configurations now appear in the code workbench Run panel, with stable local execution mapping for the supported `node` / `pwa-node` / `python` / `debugpy` launch types.
- The Settings UI now keeps VS Code compatibility simple while showing concrete import feedback: source, import time, extension/task/snippet/file-association counts, extension language/command/debugger counts, and recognized extension capability status.
- Code files now show a VS Code compatibility status strip with formatter, tab size, extension/language/task/snippet counts, and runtime readiness.
- VS Code compatibility now preserves Lattice's native code and Notebook content surfaces while exposing a dedicated activity panel for real Host-registered commands and views; it no longer presents a takeover banner.
- `.ipynb` notebooks now surface imported VS Code context beside the document: kernel/runtime state, cell count, problems count, imported extension state, and a Run All Cells action when execution is available.
- Read-only code browsing and read-only `.ipynb` rendering now use the same VS Code Workbench Surface after import.
- Code and Notebook views retain `Open in VS Code / 用 VS Code 打开` as a desktop handoff action.
- The desktop build includes a constrained VS Code Extension Host Bridge: imported extensions with a desktop `main` entry can start locally, and only commands and views actually registered by that Host surface in the activity panel and command palette.
- The bridge supports workspace/document APIs plus explicit and contribution-derived `onCommand`, `onView`, `onLanguage`, and `onNotebook` activation; native Jupyter output remains separate from Host diagnostics.
- Extension contribution scanning now includes commands, views, view containers, menus, notebooks, notebook renderers, grammars, themes, debuggers, and configuration.
- VS Code import now preserves structured theme contributions and surfaces `workbench.colorTheme` in Settings and the VS Code Workbench Surface.
- Supported VS Code workbench commands contributed by extensions now route to the matching Lattice workbench panel; extension-private commands are clearly marked as requiring the future Extension Host Bridge.
- The VS Code Workbench Surface now filters extension capabilities by mapped, detected, and external status.
- The Extensions panel now includes compatibility diagnostics for mapped, detected, and external capability states.
- Imported VS Code tasks are grouped into default, build, test, and other sections, with default tasks marked in the Run & Tasks panel.
- `docs/VS_CODE_COMPATIBILITY_PLAN.md` documents the shipped compatibility layer, near-term hardening plan, and future Extension Host Bridge boundary.
- Code workbench behavior stays subordinate to Lattice's document-first flows for PDF, Markdown, HTML, formulas, links, annotations, and AI evidence.
- VS Code compatibility is now strictly opt-in from Settings; imported associations, excludes, snippets, and tasks do not affect folder opening while the compatibility toggle is disabled.
- Folder opening no longer performs a startup VS Code compatibility refresh pass, avoiding an unnecessary full workspace rescan.
- Follow-up validation and desktop packaging on 2026-07-05 refreshed local artifacts in `releases/v2.3.1/`.

## Validation

Completed on 2026-07-23 for the self-contained Workbench packages:

- Full Vitest regression: 864/864 suites and 2,263/2,263 tests passed.
- ESLint completed with 0 errors and 134 warnings; TypeScript passed; the
  85-file documentation check passed.
- Runtime contract and preparation checks passed for code-server 4.128.0,
  Code OSS 1.128.0, and Node 22.18.0.
- Production Next build, Rust release compilation, NSIS packaging, and MSI
  packaging completed. Installer manifests include the bundled Node executable,
  Code Server entrypoint, and provision manifest.
- Windows was locked during the final UI automation pass. No claim is made that
  this pass revalidated every extension click path; the previously installed
  desktop binary was explicitly excluded as evidence for the new build.
- `npm audit --audit-level=moderate` reports 8 findings (1 low, 2 moderate,
  5 high); no dependency mutation was performed without approval.

Completed on 2026-07-21 for the extension language provider bridge:

- Real Node Extension Host fixture passed Completion, Hover, Definition,
  Diagnostics, References, Formatting, Rename, CodeAction, document version
  changes, command registration, and asynchronous activation warm-up.
- Focused frontend verification passed 8 language-bridge tests, 13 desktop
  bridge tests, 10 Extension Host store tests, and 21 CodeEditorViewer tests.
- Strict isolated TypeScript semantic checking passed for all modified
  production entry points and their dependency graph.

Completed on 2026-07-20 for native Node debugging:

- Frontend regression: 291 files and 2,218 tests passed in bounded batches.
- Rust regression: 61 tests passed.
- Real `vscode-js-debug` smoke passed against a temporary JavaScript workspace:
  breakpoint, stack, scopes, local variable, continue, termination, and cleanup.
- Resource preparation tests: 5 passed; pinned asset SHA256
  `ad8d04ede9d4b75cc290fd5438a65047a06f786d04f604b6112485b36f090772`.
- ESLint: 0 errors and 136 existing warnings; TypeScript and 83-file docs check passed.
- Next static production build and Tauri release build passed; MSI and NSIS were produced.
- Official npm audit reports the known 2 moderate `pptx-preview -> echarts`
  findings; no high or critical findings.

Completed on 2026-07-12:

- Real VS Code Workbench Playwright acceptance passed for Explorer, source editor, Rust language status, PowerShell terminal, Run and Debug, Extensions, Claude Code, and Codex.
- The official Extensions view detected all 47 extensions from the user's `.vscode/extensions` directory and listed Claude Code for VS Code `2.1.207`.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 22 tests passed.
- `npm run qa:gate`: passed end to end.
- `npm run test:run`: 278 files passed, 2072 tests passed.
- `npm run test:docs`: 65 files checked.
- `npm run build`: passed, 14 static routes generated.
- `npm run tauri:build`: passed, producing MSI and NSIS bundles.

- `npm audit --registry=https://registry.npmjs.org --audit-level=moderate`: 0 vulnerabilities
- `npm run typecheck`: passed
- PDF item drag/drop and nested-folder focused regression tests: `src/lib/__tests__/pdf-item.test.ts`, `src/components/renderers/__tests__/pdf-item-workspace-panel.test.tsx`, `src/components/explorer/__tests__/tree-view.test.tsx`, `src/components/main-area/__tests__/universal-file-viewer.test.tsx`, and `src/stores/__tests__/workspace-store-execution.test.ts` passed
- `npm run lint`: passed with 0 errors and 118 existing warnings
- `npm run test:docs`: passed, 59 files checked
- Focused regression tests for Markdown extraction, workspace indexing, Quantum Keyboard, formula copy, unified input, and HUD behavior: 36 tests passed
- `npm run lint`: passed with existing warnings only
- `cargo check`: passed
- `npm run test:run`: 266 files passed, 2000 tests passed
- `npm run build`: passed
- `npm run tauri:build`: passed
- `npm run release:prepare -- --skip-qa`: passed after the same-phase validation/build
- `npm run test:run -- src/lib/vscode-compat/__tests__/storage.test.ts src/lib/vscode-compat/__tests__/auto-discovery.test.ts src/lib/vscode-compat/__tests__/mapper.test.ts src/lib/vscode-compat/__tests__/status.test.ts src/lib/vscode-compat/__tests__/task-actions.test.ts src/lib/vscode-compat/__tests__/glob.test.ts src/lib/vscode-compat/__tests__/language.test.ts src/lib/__tests__/searchable-text.test.ts`: 8 files passed, 25 tests passed
- `npm run test:run -- src/lib/vscode-compat/__tests__/storage.test.ts src/lib/vscode-compat/__tests__/mapper.test.ts src/lib/vscode-compat/__tests__/status.test.ts src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx src/components/renderers/__tests__/jupyter-renderer.test.tsx src/components/renderers/__tests__/code-editor-viewer.test.tsx`: 6 files passed, 30 tests passed
- `npm run typecheck`: passed
- `npm run test:docs`: passed, 59 files checked
- `npm run build`: passed
- PDF copy routing smoke: copied the Jandura/Pupillo 2022 Rydberg gates PDF into `atom/Theoretical Research/taiyi/essay/`; source and copy hashes match, and the PDF item manifest can route both `atom/Theoretical Research/...` and `Theoretical Research/...` to the original item workspace.
- `npm run test:desktop:pdf-smoke`: passed against the built desktop executable

Note: the full Vitest run still emits jsdom's informational `Not implemented: navigation to another Document` line, but the suite exits successfully with no failed tests.

## Desktop Artifacts

Artifacts are available in `releases/v2.3.1/`:

- `Lattice_2.3.1_x64_en-US.msi` SHA256 `7c1c5c2aee7b35f880b14c8b8a8b2569ad8ea4ce6bc8824c9a4595e364d480b0`
- `Lattice_2.3.1_x64-setup.exe` SHA256 `b202ac0d9d09ff8bc386b74b8a0dc85d92566e985ae4281c14592da5ea33b1eb`
- `lattice.exe` SHA256 `af270ccd99f2e85c4ab2ae0f4a67c8fa8b223abde63be449e0317bdba991a3af`

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
