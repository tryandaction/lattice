# Lattice Code OSS Desktop Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reproducible Lattice-branded Code OSS desktop development distribution with a built-in Lattice extension and permanent activity-bar entry.

**Architecture:** Repository-owned scripts pin and validate Microsoft Code OSS source outside tracked files, apply a small deterministic product and extension overlay, and invoke upstream build tooling. The first phase does not migrate research features or remove Tauri; it establishes the native desktop shell that all later phases depend on.

**Tech Stack:** Node.js 22, Microsoft Code OSS 1.128.0, Electron, npm, VS Code extension manifests, Vitest, Windows PowerShell build environment

---

Git commit steps are intentionally omitted because the product owner requested development directly in the existing `main` worktree without implicit commits or pushes.

## File Map

- `desktop/code-oss/source.json`: immutable upstream source contract.
- `desktop/code-oss/product/product.json`: Lattice product identity and Open VSX configuration overlay.
- `desktop/code-oss/product/builtInExtensions.json`: repository-owned built-in extension list.
- `desktop/code-oss/extensions/lattice-workbench/package.json`: built-in extension contribution contract.
- `desktop/code-oss/extensions/lattice-workbench/extension.js`: minimal activation and command implementation.
- `desktop/code-oss/extensions/lattice-workbench/media/lattice-activity.svg`: monochrome Workbench activity icon.
- `scripts/prepare-code-oss-desktop.mjs`: immutable source validation, generated build-worktree preparation, overlay, and build preparation.
- `scripts/__tests__/prepare-code-oss-desktop.test.mjs`: pure source and overlay contract tests.
- `scripts/__tests__/code-oss-product-contract.test.mjs`: product identity and extension contribution tests.
- `.gitignore`: excludes generated upstream checkout and build output.
- `package.json`: exposes check, prepare, and build commands without adding third-party runtime dependencies.

## Task 1: Pin The Upstream Source Contract

**Files:**

- Create: `desktop/code-oss/source.json`
- Create: `scripts/prepare-code-oss-desktop.mjs`
- Create: `scripts/__tests__/prepare-code-oss-desktop.test.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing source-contract test**

Create a test that imports `readSourceContract`, `validateSourceContract`, and `sourceLayout` from the preparation script:

```js
const contract = await readSourceContract("desktop/code-oss/source.json");
expect(validateSourceContract(contract)).toEqual([]);
expect(contract).toMatchObject({
  repository: "https://github.com/microsoft/vscode.git",
  tag: "1.128.0",
  commit: "fc3def6774c76082adf699d366f31a557ce5573f",
});
expect(sourceLayout("C:/repo").checkoutRoot).toBe(
  path.join("C:/repo", ".lattice-build", "code-oss", "source"),
);
```

Also verify rejection of a floating branch, non-HTTPS repository, malformed commit, and path escaping the repository root.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```text
npx vitest run scripts/__tests__/prepare-code-oss-desktop.test.mjs
```

Expected: FAIL because the preparation module and source contract do not exist.

- [ ] **Step 3: Add the pinned source contract**

Use this exact contract:

```json
{
  "schemaVersion": 1,
  "repository": "https://github.com/microsoft/vscode.git",
  "tag": "1.128.0",
  "commit": "fc3def6774c76082adf699d366f31a557ce5573f",
  "checkoutDirectory": ".lattice-build/code-oss/source"
}
```

- [ ] **Step 4: Implement pure contract helpers**

Export helpers that validate exact schema version, official repository URL, numeric release tag, lowercase 40-character commit, and repository-relative checkout path. `sourceLayout(repoRoot)` returns absolute checkout, overlay, and stamp paths without performing I/O.

- [ ] **Step 5: Ignore generated source and output**

Add only these generated paths:

```text
/.lattice-build/code-oss/
/desktop/code-oss/dist/
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run the same Vitest command. Expected: all source-contract tests pass.

## Task 2: Validate And Prepare The Upstream Checkout

**Files:**

- Modify: `scripts/prepare-code-oss-desktop.mjs`
- Modify: `scripts/__tests__/prepare-code-oss-desktop.test.mjs`

- [ ] **Step 1: Write failing checkout inspection tests**

Use synthetic directories and injected command output to verify:

```js
expect(inspectCheckout(layout, contract, { head: contract.commit, tagCommit: contract.commit })).toEqual({
  ready: true,
  errors: [],
});
expect(inspectCheckout(layout, contract, { head: "0".repeat(40), tagCommit: contract.commit }).errors)
  .toContain("Code OSS checkout HEAD does not match the pinned commit.");
```

Test missing `package.json`, missing `src/vs/code/electron-main/main.ts`, and a tag that resolves to a different commit.

- [ ] **Step 2: Run the focused test and verify RED**

Expected: FAIL because checkout inspection is missing.

- [ ] **Step 3: Implement checkout inspection and command construction**

Export `inspectCheckout` and `buildCheckoutCommands`. The command sequence must be:

```text
git init <checkout>
git -C <checkout> remote add origin <repository>
git -C <checkout> fetch --depth 1 origin refs/tags/<tag>:refs/tags/<tag>
git -C <checkout> checkout --detach <commit>
```

Existing correct checkouts are reused. Existing incorrect checkouts fail with an actionable error; the script never deletes them automatically.

- [ ] **Step 4: Add CLI modes**

Implement:

```text
node scripts/prepare-code-oss-desktop.mjs --check
node scripts/prepare-code-oss-desktop.mjs --prepare
```

`--check` performs no writes. `--prepare` creates the parent directory, initializes or updates the checkout, validates required files, and writes a source stamp atomically.

- [ ] **Step 5: Run tests and prepare the real checkout**

Run:

```text
npx vitest run scripts/__tests__/prepare-code-oss-desktop.test.mjs
node scripts/prepare-code-oss-desktop.mjs --prepare
node scripts/prepare-code-oss-desktop.mjs --check
```

Expected: tests pass, the official source is checked out at the pinned commit, and the final check exits 0.

## Task 3: Define The Lattice Product Overlay

**Files:**

- Create: `desktop/code-oss/product/product.json`
- Create: `desktop/code-oss/product/builtInExtensions.json`
- Create: `scripts/__tests__/code-oss-product-contract.test.mjs`

- [ ] **Step 1: Write failing product contract tests**

Verify the product overlay uses:

```js
expect(product).toMatchObject({
  nameShort: "Lattice",
  nameLong: "Lattice Scientific Workbench",
  applicationName: "lattice",
  dataFolderName: ".lattice-code",
  urlProtocol: "lattice",
});
expect(product.extensionsGallery.serviceUrl).toBe("https://open-vsx.org/vscode/gallery");
expect(JSON.stringify(product)).not.toMatch(/Microsoft Visual Studio Code|marketplace\.visualstudio\.com/i);
expect(builtIns).toContain("lattice.lattice-workbench");
```

- [ ] **Step 2: Run product tests and verify RED**

Run:

```text
npx vitest run scripts/__tests__/code-oss-product-contract.test.mjs
```

Expected: FAIL because product files do not exist.

- [ ] **Step 3: Add minimal product metadata**

Define Lattice names, Windows mutex/service identifiers, protocol, data folder, license URLs owned by the repository, telemetry disabled by omission, and Open VSX endpoints. Do not copy Microsoft product identifiers, update URLs, or marketplace URLs.

- [ ] **Step 4: Add the built-in extension list**

Use a JSON array containing `lattice.lattice-workbench`. Later phases can append built-in extensions only when they have a separate responsibility.

- [ ] **Step 5: Run product contract tests and verify GREEN**

Expected: all product identity and registry tests pass.

## Task 4: Create The Built-In Lattice Workbench Extension

**Files:**

- Create: `desktop/code-oss/extensions/lattice-workbench/package.json`
- Create: `desktop/code-oss/extensions/lattice-workbench/extension.js`
- Create: `desktop/code-oss/extensions/lattice-workbench/media/lattice-activity.svg`
- Modify: `scripts/__tests__/code-oss-product-contract.test.mjs`

- [ ] **Step 1: Write failing extension contribution tests**

Assert the manifest:

```js
expect(extension.publisher).toBe("lattice");
expect(extension.name).toBe("lattice-workbench");
expect(extension.engines.vscode).toBe("^1.128.0");
expect(extension.extensionKind).toEqual(["ui"]);
expect(extension.contributes.viewsContainers.activitybar[0]).toMatchObject({
  id: "lattice",
  title: "Lattice",
  icon: "media/lattice-activity.svg",
});
expect(extension.contributes.views.lattice.map((view) => view.id)).toContain("lattice.research");
```

Also require `lattice.openResearch`, `lattice.importVSCodeProfile`, and `lattice.showMigrationStatus` commands.

- [ ] **Step 2: Run product tests and verify RED**

Expected: FAIL because the built-in extension is absent.

- [ ] **Step 3: Add the minimal extension manifest**

Contribute one activity-bar container, a welcome-enabled Research view, and the three commands. Mark untrusted-workspace support as limited and do not request proposed APIs.

- [ ] **Step 4: Implement minimal activation**

Register the three commands. `lattice.openResearch` focuses the Research view. The two migration commands display an explicit Phase 1 message instead of pretending migration is implemented. Export `activate` and `deactivate` using CommonJS because upstream built-in extensions support that runtime directly.

- [ ] **Step 5: Add a compliant activity icon**

Add a monochrome 24 by 24 SVG using `currentColor`, no embedded raster data, no Microsoft or VS Code marks, and a simple Lattice cube/grid identity.

- [ ] **Step 6: Run product tests and verify GREEN**

Expected: all extension contribution tests pass.

## Task 5: Apply The Overlay Deterministically

**Files:**

- Modify: `scripts/prepare-code-oss-desktop.mjs`
- Modify: `scripts/__tests__/prepare-code-oss-desktop.test.mjs`

- [ ] **Step 1: Write failing overlay-plan tests**

Verify `buildOverlayPlan(repoRoot, buildRoot)` maps:

```text
desktop/code-oss/product/product.json -> <build-worktree>/product.json
desktop/code-oss/extensions/lattice-workbench -> <build-worktree>/extensions/lattice-workbench
```

Verify every destination stays inside the generated build worktree and duplicate destinations are rejected. The immutable source checkout must never appear as an overlay destination.

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because overlay planning is absent.

- [ ] **Step 3: Implement atomic overlay application**

Create a detached Git worktree at the pinned commit. On Windows its physical root must be `C:\lb\LatticeCodeOSS\build-source`; do not use a junction to the repository because Node resolves the physical whitespace-containing path before upstream native build commands. Store staging data and `overlay-manifest.json` under the owned `C:\lb\LatticeCodeOSS` root. On non-Windows platforms use `.lattice-build/code-oss/build-source` and `.lattice-build/code-oss/staging`. Copy files through staging, compare content hashes, replace only changed destinations in the build worktree, and record source and destination hashes. Never modify the immutable source checkout or tracked Lattice files outside `desktop/code-oss`.

- [ ] **Step 4: Wire built-in extension registration**

Read upstream `product.json`, merge the Lattice product overlay, and ensure the built-in extension directory is included in the upstream build input. Preserve upstream open-source built-in extension declarations unless they conflict with Lattice product identity.

- [ ] **Step 5: Run focused tests and apply the real overlay**

Run:

```text
npx vitest run scripts/__tests__/prepare-code-oss-desktop.test.mjs scripts/__tests__/code-oss-product-contract.test.mjs
node scripts/prepare-code-oss-desktop.mjs --prepare
```

Expected: tests pass and `overlay-manifest.json` records the exact generated files.

## Task 6: Add Build Commands And Environment Diagnostics

**Files:**

- Modify: `package.json`
- Modify: `scripts/prepare-code-oss-desktop.mjs`
- Create: `scripts/__tests__/code-oss-desktop-script-contract.test.mjs`

- [ ] **Step 1: Write failing package-script tests**

Require:

```js
expect(pkg.scripts["code-oss:check"]).toBe("node scripts/prepare-code-oss-desktop.mjs --check");
expect(pkg.scripts["code-oss:prepare"]).toBe("node scripts/prepare-code-oss-desktop.mjs --prepare");
expect(pkg.scripts["code-oss:build"]).toBe("node scripts/prepare-code-oss-desktop.mjs --build");
```

- [ ] **Step 2: Run the script test and verify RED**

Expected: FAIL because scripts are absent.

- [ ] **Step 3: Implement environment diagnostics**

Before build, report exact versions and fail actionably for unsupported Node, Git, Python, C++ build tools, disk space, or upstream checkout state. Do not install global dependencies or change system configuration.

- [ ] **Step 4: Implement `--build` orchestration**

`--build` performs check, prepares upstream dependencies using the package manager declared by the pinned source, invokes the upstream Windows desktop build, and records Windows logs under `C:\lb\LatticeCodeOSS\logs`. The portable Node runtime and final distribution also remain under this physical short root. Child windows remain hidden. A failure reports the log path and exit code.

- [ ] **Step 5: Add package scripts and verify GREEN**

Run:

```text
npx vitest run scripts/__tests__/code-oss-desktop-script-contract.test.mjs
npm run code-oss:check
```

Expected: the script contract passes and the checkout/overlay check exits 0.

## Task 7: Build And Smoke-Test The Desktop Shell

**Files:**

- Modify: `scripts/prepare-code-oss-desktop.mjs` only if build evidence exposes a reproducible orchestration defect
- Create: `docs/qa/code-oss-desktop-foundation-smoke.md`

- [ ] **Step 1: Run the real desktop build**

Run:

```text
npm run code-oss:build
```

Expected: upstream dependency restoration and Windows desktop build exit 0, with the distribution path printed.

- [ ] **Step 2: Launch the built product on the Lattice workspace**

Launch the generated executable with:

```text
<lattice-code-oss.exe> "C:/universe/software development/me/Lattice"
```

Expected: one Lattice-branded Code OSS window opens without code-server, Tauri, or a console window.

- [ ] **Step 3: Verify visible shell behavior**

Record screenshot and interaction evidence for:

- permanent Lattice activity icon
- native Explorer with the requested workspace
- direct opening of a TypeScript file
- Extensions view
- terminal creation
- Source Control view
- Run and Debug view
- command palette entries for the three Lattice commands

- [ ] **Step 4: Verify process architecture**

Confirm the process tree contains the Code OSS/Electron processes and extension host, and contains no `code-server` process and no Lattice Tauri window.

- [ ] **Step 5: Write the foundation smoke record**

Document commands, versions, paths, screenshots, measured startup time, process evidence, failures, and remaining Phase 2 gaps. Do not claim the complete migration is released at this phase.

## Task 8: Phase 1 Quality Gate

**Files:**

- Modify: `docs/DESKTOP_FEATURES.md`
- Modify: `docs/LATTICE_RELEASE_READINESS.md`

- [ ] **Step 1: Document the dual-path migration state**

State that the Code OSS desktop shell is the accepted future path while the Tauri build remains transitional until research views and the native core service are migrated.

- [ ] **Step 2: Run focused tests**

Run:

```text
npx vitest run scripts/__tests__/prepare-code-oss-desktop.test.mjs scripts/__tests__/code-oss-product-contract.test.mjs scripts/__tests__/code-oss-desktop-script-contract.test.mjs
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 3: Run repository static checks**

Run:

```text
npm run typecheck
npm run test:docs
```

Expected: both commands exit 0.

- [ ] **Step 4: Review Phase 1 exit criteria**

Verify every Phase 1 criterion from the design document against executable or screenshot evidence. Record any unmet criterion as an active blocker instead of marking the phase complete.
