# Bundled Code OSS Runtime Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace discovery of the user's Visual Studio Code executable with a reproducibly provisioned, bundled Code OSS runtime while retaining the legacy launcher only as an explicit development fallback.

**Architecture:** A checked-in runtime package definition pins the official `code-server` package archive based on Code OSS 1.128.0. A Node preparation script provisions the package with its locked dependencies, copies the compatible Node 22 executable, verifies required entrypoints, and writes a generated manifest. A focused Rust module resolves and validates the bundled runtime; `vscode_workbench.rs` consumes that module before considering the legacy external CLI.

**Tech Stack:** Node.js 22, npm lockfiles, code-server 4.128.0 / Code OSS 1.128.0, Rust, Tauri 2, Vitest, Cargo tests

---

Git commit steps are intentionally omitted because repository instructions prohibit commits unless the user explicitly requests them.

### Task 1: Pin and validate the runtime package contract

**Files:**
- Create: `src-tauri/code-oss-runtime/package.json`
- Create: `src-tauri/code-oss-runtime/runtime-source.json`
- Create: `scripts/prepare-code-oss-runtime.mjs`
- Create: `scripts/__tests__/prepare-code-oss-runtime.test.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing manifest validation tests**

Add tests importing `readRuntimeSource`, `validateRuntimeSource`, and `runtimeLayout` from the preparation script. Verify that the pinned manifest resolves to code-server `4.128.0`, Code OSS `1.128.0`, Node major `22`, and rejects an archive without a SHA-256 digest.

```js
const source = await readRuntimeSource("src-tauri/code-oss-runtime/runtime-source.json");
expect(validateRuntimeSource(source)).toEqual([]);
expect(runtimeLayout("C:/runtime")).toMatchObject({
  nodeExecutable: path.join("C:/runtime", "bin", "node.exe"),
  entrypoint: path.join("C:/runtime", "node_modules", "code-server", "out", "node", "entry.js"),
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx vitest run scripts/__tests__/prepare-code-oss-runtime.test.mjs`

Expected: FAIL because `prepare-code-oss-runtime.mjs` does not exist.

- [ ] **Step 3: Add the pinned source and package definitions**

Use this source contract:

```json
{
  "schemaVersion": 1,
  "distribution": "code-server",
  "runtimeVersion": "4.128.0",
  "codeOssVersion": "1.128.0",
  "nodeMajor": 22,
  "packageUrl": "https://github.com/coder/code-server/releases/download/v4.128.0/package.tar.gz",
  "packageSha256": "d0da733a6e6f83f0af026303c40caa6906f5ff27e37a4f7eabe91e7b5015ec93",
  "entrypoint": "node_modules/code-server/out/node/entry.js"
}
```

The runtime package uses the same pinned archive URL as its sole dependency. Ignore only generated `node_modules`, `bin/node.exe`, and the generated provision manifest, not the source contract or lockfile.

- [ ] **Step 4: Implement pure validation and layout helpers**

Export helpers that do not touch the network. Validate schema version, exact non-empty versions, Node major, HTTPS GitHub source URL, 64-character lowercase SHA-256, and a relative entrypoint that cannot escape the runtime root.

- [ ] **Step 5: Run the focused tests**

Run: `npx vitest run scripts/__tests__/prepare-code-oss-runtime.test.mjs`

Expected: PASS.

### Task 2: Provision a self-contained Windows runtime

**Files:**
- Modify: `scripts/prepare-code-oss-runtime.mjs`
- Modify: `scripts/__tests__/prepare-code-oss-runtime.test.mjs`
- Create: `src-tauri/code-oss-runtime/package-lock.json`

- [ ] **Step 1: Write failing provision-state tests**

Create temporary runtime layouts and verify `inspectProvisionedRuntime` reports these exact failures:

```js
expect(result.errors).toContain("Bundled Node executable is missing.");
expect(result.errors).toContain("Code OSS server entrypoint is missing.");
expect(result.errors).toContain("Provision manifest is missing.");
```

Also verify a complete synthetic layout returns `ready: true` and the source fingerprint changes when the pinned source changes.

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run scripts/__tests__/prepare-code-oss-runtime.test.mjs`

Expected: FAIL because provision inspection is not implemented.

- [ ] **Step 3: Implement idempotent provisioning**

`prepareCodeOSSRuntime` must:

1. Read and validate `runtime-source.json`.
2. Return immediately when the generated manifest fingerprint and required files are valid.
3. Require the current executable to be Node major 22.
4. Run `npm ci --omit=dev` in `src-tauri/code-oss-runtime` with a hidden Windows process.
5. Copy `process.execPath` to `src-tauri/code-oss-runtime/bin/node.exe`.
6. Verify the installed code-server version and entrypoint.
7. Write `provision-manifest.json` atomically with source fingerprint, versions, architecture, and generated timestamp.

The script supports `--check` to perform no writes and fail when the runtime is absent or stale.

- [ ] **Step 4: Generate the lockfile**

Run from `src-tauri/code-oss-runtime`: `npm install --package-lock-only --ignore-scripts`

Expected: a lockfile with code-server resolved from the pinned GitHub archive and integrity metadata for all transitive dependencies.

- [ ] **Step 5: Provision and verify the real runtime**

Run: `node scripts/prepare-code-oss-runtime.mjs`

Run: `node scripts/prepare-code-oss-runtime.mjs --check`

Expected: both commands exit 0; the second reports that code-server 4.128.0 and bundled Node 22 are ready without modifying files.

### Task 3: Add the runtime to desktop preparation and packaging

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Create: `scripts/__tests__/desktop-resource-contract.test.mjs`

- [ ] **Step 1: Write a failing resource contract test**

Read `package.json` and `src-tauri/tauri.conf.json`. Assert:

```js
expect(pkg.scripts["prepare:code-oss-runtime"]).toBe("node scripts/prepare-code-oss-runtime.mjs");
expect(pkg.scripts["prepare:desktop-resources"]).toContain("prepare:code-oss-runtime");
expect(tauri.bundle.resources).toContain("code-oss-runtime/**/*");
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run scripts/__tests__/desktop-resource-contract.test.mjs`

Expected: FAIL because the script and resource glob are absent.

- [ ] **Step 3: Wire preparation and packaging**

Add `prepare:code-oss-runtime` before TypeScript and bridge preparation. Add `code-oss-runtime/**/*` to Tauri resources. Do not add runtime files to the main application binary.

- [ ] **Step 4: Run resource tests and preparation checks**

Run: `npx vitest run scripts/__tests__/prepare-code-oss-runtime.test.mjs scripts/__tests__/desktop-resource-contract.test.mjs`

Run: `npm run prepare:desktop-resources`

Expected: tests pass and all three resource preparation steps complete.

### Task 4: Resolve the bundled runtime in Rust

**Files:**
- Create: `src-tauri/src/code_oss_runtime.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/vscode_workbench.rs`

- [ ] **Step 1: Write failing Rust unit tests**

Test a pure `resolve_runtime_layout(resource_root, platform)` helper against synthetic layouts. Required behavior:

```rust
assert_eq!(runtime.kind, CodeOSSRuntimeKind::BundledCodeServer);
assert!(runtime.executable.ends_with("bin/node.exe"));
assert!(runtime.entrypoint.ends_with("node_modules/code-server/out/node/entry.js"));
assert!(resolve_runtime_layout(&missing_root, "windows").is_err());
```

Test `build_code_server_args` for loopback-only binding, isolated user-data and extensions paths, disabled telemetry, the canonical workspace path, and absence of external-download arguments.

- [ ] **Step 2: Run Rust tests and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml code_oss_runtime`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the focused runtime module**

Define:

```rust
pub enum CodeOSSRuntimeKind { BundledCodeServer, LegacyVSCodeTunnel }

pub struct CodeOSSRuntime {
    pub kind: CodeOSSRuntimeKind,
    pub executable: PathBuf,
    pub entrypoint: Option<PathBuf>,
    pub version: String,
}
```

Parse the provision manifest, require matching architecture, validate canonical files, and return actionable errors. Resolve the application resource directory through Tauri only in a thin adapter; keep layout validation pure and unit-testable.

- [ ] **Step 4: Prefer the bundled runtime in Workbench startup**

Update `desktop_start_vscode_workbench` to launch:

```text
node.exe <code-server-entrypoint> --bind-addr 127.0.0.1:<port> --auth none
  --disable-telemetry --user-data-dir <lattice-profile>/user-data
  --extensions-dir <lattice-profile>/extensions <workspace>
```

Create the isolated profile under Tauri app-local-data. Install the bundled Lattice bridge into that extensions directory. The legacy `code-tunnel` resolver is used only when `LATTICE_ALLOW_LEGACY_VSCODE_WORKBENCH=1` is explicitly set in development.

- [ ] **Step 5: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml code_oss_runtime`

Run: `cargo test --manifest-path src-tauri/Cargo.toml vscode_workbench`

Expected: PASS.

### Task 5: Expose runtime identity and migration status to the frontend

**Files:**
- Modify: `src-tauri/src/vscode_workbench.rs`
- Modify: `src/lib/vscode-workbench/desktop.ts`
- Modify: `src/components/vscode-compat/native-vscode-workbench-pane.tsx`
- Modify: `src/components/vscode-compat/__tests__/native-vscode-workbench-pane.test.tsx`

- [ ] **Step 1: Write failing snapshot tests**

Extend test snapshots with:

```ts
runtimeKind: "bundledCodeServer",
runtimeVersion: "4.128.0",
profilePath: "C:/Users/test/AppData/Local/Lattice/code-oss",
legacyFallback: false,
```

Verify the pane presents an actionable error when runtime provisioning is missing and never labels a legacy fallback as the bundled runtime.

- [ ] **Step 2: Run the focused frontend tests and verify failure**

Run: `npx vitest run src/components/vscode-compat/__tests__/native-vscode-workbench-pane.test.tsx src/lib/vscode-workbench/__tests__/desktop.test.ts`

Expected: FAIL because snapshot types do not expose runtime identity.

- [ ] **Step 3: Extend the Rust and TypeScript snapshot contracts**

Add the four fields to every snapshot state. Error detail must name the missing runtime preparation command for development builds. Production builds must report a corrupt installation instead of attempting a network download.

- [ ] **Step 4: Run focused frontend and Rust tests**

Run: `npx vitest run src/components/vscode-compat/__tests__/native-vscode-workbench-pane.test.tsx src/lib/vscode-workbench/__tests__/desktop.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml code_oss_runtime vscode_workbench`

Expected: PASS.

### Task 6: Phase 1 verification

**Files:**
- Modify: `docs/DESKTOP_FEATURES.md`
- Modify: `docs/LATTICE_RELEASE_READINESS.md`

- [ ] **Step 1: Document actual behavior and transitional boundary**

State that production uses the bundled Code OSS runtime and isolated profile. Document the explicit legacy development environment variable and mark the custom extension-host shim as transitional.

- [ ] **Step 2: Run focused and static verification**

Run: `node scripts/prepare-code-oss-runtime.mjs --check`

Run: `npx vitest run scripts/__tests__/prepare-code-oss-runtime.test.mjs scripts/__tests__/desktop-resource-contract.test.mjs src/components/vscode-compat/__tests__/native-vscode-workbench-pane.test.tsx src/lib/vscode-workbench/__tests__/desktop.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml code_oss_runtime`

Run: `cargo test --manifest-path src-tauri/Cargo.toml vscode_workbench`

Run: `npm run typecheck`

Expected: all commands pass.

- [ ] **Step 3: Build the desktop application**

Run: `npm run tauri:build`

Expected: the installer contains `code-oss-runtime`, starts without a separately installed VS Code, and does not download a server on first use.

- [ ] **Step 4: Continue to Phase 2**

Create the next implementation plan for managed lifecycle events and the authenticated native bridge. Do not refresh the release directory until the complete repository QA gate passes.

