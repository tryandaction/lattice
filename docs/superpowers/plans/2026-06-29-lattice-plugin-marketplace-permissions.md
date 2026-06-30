# Lattice Plugin Marketplace And Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Lattice plugins from a plain enable/trust list into a safe local marketplace with package validation, clear permissions, and runtime enforcement.

**Architecture:** Keep the existing built-in registry, OPFS/localStorage repository, worker host, audit log, and settings page. Add a shared permission catalog, a marketplace catalog builder, stricter manifest diagnostics, and a single runtime permission assertion path used by worker requests.

**Tech Stack:** TypeScript, React, Zustand, Vitest, existing Lattice plugin runtime.

---

## File Structure

- Create `src/lib/plugins/permission-catalog.ts`
  - Owns all plugin permission metadata, risk levels, categories, aliases, and helper functions.
- Create `src/lib/plugins/marketplace.ts`
  - Builds unified catalog entries from built-in plugin manifests and installed plugin manifests.
- Modify `src/lib/plugins/manifest.ts`
  - Uses the permission catalog, validates package shape, and surfaces warnings.
- Modify `src/lib/plugins/runtime.ts`
  - Uses shared permission assertions and records denied access in the audit log.
- Modify `src/components/settings/settings-dialog.tsx`
  - Presents marketplace-style plugin cards, source/status/risk filters, validation warnings, and readable permission groups.
- Modify `src/lib/i18n/en-US.ts` and `src/lib/i18n/zh-CN.ts`
  - Adds marketplace, permission risk, package validation, and filter labels.
- Add tests:
  - `src/lib/__tests__/plugin-permission-catalog.test.ts`
  - `src/lib/__tests__/plugin-marketplace.test.ts`
  - Extend `src/lib/__tests__/plugin-manifest.test.ts`
  - Extend `src/lib/__tests__/plugin-formula-extractor-registry.test.ts`

## Tasks

### Task 1: Permission Catalog

- [x] Add tests verifying known permissions, aliases, risk levels, and summaries.
- [x] Implement `permission-catalog.ts`.
- [x] Replace hardcoded settings permission labels with catalog metadata.

### Task 2: Manifest Diagnostics

- [x] Add tests for invalid contribution IDs, invalid main path, duplicate permissions, and warnings.
- [x] Update `ManifestValidationResult` to include `warnings`.
- [x] Validate `main`, `entry`, contribution arrays, and permission metadata through catalog helpers.

### Task 3: Marketplace Catalog

- [x] Add tests merging built-in and installed plugin manifests.
- [x] Implement source states: `built-in`, `installed`, `override`.
- [x] Add catalog fields: `official`, `recommended`, `installed`, `enabled`, `trusted`, `risk`, `permissionGroups`, `validation`.

### Task 4: Runtime Permission Enforcement

- [x] Add tests for denied worker actions producing audit entries.
- [x] Replace repeated permission checks with `assertPluginPermission`.
- [x] Keep legacy read permissions compatible.
- [x] Audit package asset reads without blocking package-local resources.

### Task 5: Settings UI

- [x] Replace plain plugin list with compact marketplace sections.
- [x] Add filters for source, risk, and status.
- [x] Show manifest warnings and high-risk permission summaries directly on cards.
- [x] Keep existing install zip/folder, trust, enable, uninstall, update, audit, and command controls.

### Task 6: Verification

- [x] Run targeted plugin tests.
- [x] Run settings UI tests if available.
- [x] Run `npm run typecheck`.
- [x] Update this plan with completed verification notes.

Verification completed:

- `npm run test:run -- "src/lib/__tests__/plugin-permission-catalog.test.ts" "src/lib/__tests__/plugin-manifest.test.ts" "src/lib/__tests__/plugin-marketplace.test.ts" "src/lib/__tests__/plugin-formula-extractor-registry.test.ts"` passed: 4 files, 18 tests.
- `npx tsc --noEmit --incremental false --pretty false` passed.

## Safety Boundaries

- No remote plugin download in this phase.
- No arbitrary untrusted code execution outside the existing worker pathway.
- Built-in official plugins may stay trusted by default.
- User-installed plugins remain disabled until trusted and enabled.
