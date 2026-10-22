#!/usr/bin/env node
/**
 * Reconcile orphaned ("dead") and duplicate PDF items in a Lattice workspace.
 *
 * Safe by default: it only prints a plan. Pass --apply to execute it.
 *
 * Usage:
 *   node scripts/reconcile-pdf-items.mjs [--workspace <path>] [--apply] [--json]
 *
 * Behavior (mirrors src/lib/pdf-item-reconciliation.ts):
 *   - Scans the workspace for live *.pdf paths.
 *   - Reads .lattice/items/* /manifest.json and groups by fileFingerprint.
 *   - Absorbs dead/duplicate items into a live survivor: their sub-files are
 *     merged WITHOUT overwriting, the absorbed item folder is removed, and the
 *     survivor manifest is updated to point at the live PDF path.
 *   - Items that are dead but have no live sibling by fingerprint are only
 *     reported, never modified automatically.
 */

import {
  readdirSync,
  readFileSync,
  existsSync,
  statSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, basename, sep } from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const asJson = args.includes("--json");
const wsIndex = args.indexOf("--workspace");
const positional = args.find((arg) => !arg.startsWith("--"));
const workspace = resolve(
  wsIndex >= 0 && args[wsIndex + 1] ? args[wsIndex + 1] : positional ?? process.cwd(),
);

const ITEMS_DIR = join(workspace, ".lattice", "items");
const IGNORED_DIRS = new Set([".lattice", "node_modules", ".git"]);

function norm(value) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function walkPdfs(dir, base, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      walkPdfs(join(dir, entry.name), base, out);
    } else if (entry.name.toLowerCase().endsWith(".pdf")) {
      out.push(norm(relative(base, join(dir, entry.name))));
    }
  }
}

function buildLiveSet() {
  const workspaceName = basename(workspace);
  const live = [];
  walkPdfs(workspace, workspace, live);
  const liveSet = new Set();
  for (const path of live) {
    liveSet.add(norm(path));
    if (path.startsWith(`${workspaceName}/`)) {
      liveSet.add(norm(path.slice(workspaceName.length + 1)));
    } else {
      liveSet.add(norm(`${workspaceName}/${path}`));
    }
  }
  return { live, liveSet };
}

function loadManifests() {
  const manifests = [];
  const orphanDirs = [];
  if (!existsSync(ITEMS_DIR)) {
    return { manifests, orphanDirs };
  }

  for (const name of readdirSync(ITEMS_DIR)) {
    const dir = join(ITEMS_DIR, name);
    if (!statSync(dir).isDirectory()) {
      continue;
    }
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) {
      orphanDirs.push({ folder: `.lattice/items/${name}`, reason: "no manifest.json" });
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (!parsed || typeof parsed.itemId !== "string") {
        orphanDirs.push({ folder: `.lattice/items/${name}`, reason: "invalid manifest" });
        continue;
      }
      const knownPdfPaths = Array.isArray(parsed.knownPdfPaths)
        ? parsed.knownPdfPaths.filter((path) => typeof path === "string")
        : parsed.pdfPath
          ? [parsed.pdfPath]
          : [];
      manifests.push({
        itemId: parsed.itemId,
        pdfPath: parsed.pdfPath ?? "",
        itemFolderPath: parsed.itemFolderPath ?? `.lattice/items/${name}`,
        fileFingerprint: typeof parsed.fileFingerprint === "string" ? parsed.fileFingerprint : null,
        knownPdfPaths,
        createdAt: parsed.createdAt ?? 0,
        updatedAt: parsed.updatedAt ?? 0,
        dir,
      });
    } catch {
      orphanDirs.push({ folder: `.lattice/items/${name}`, reason: "unreadable manifest" });
    }
  }
  return { manifests, orphanDirs };
}

function isLive(manifest, liveSet) {
  return [manifest.pdfPath, ...manifest.knownPdfPaths]
    .map(norm)
    .filter(Boolean)
    .some((path) => liveSet.has(path));
}

function plan(manifests, liveSet) {
  const byFingerprint = new Map();
  for (const manifest of manifests) {
    if (!manifest.fileFingerprint) {
      continue;
    }
    const group = byFingerprint.get(manifest.fileFingerprint) ?? [];
    group.push(manifest);
    byFingerprint.set(manifest.fileFingerprint, group);
  }

  const actions = [];
  for (const [fingerprint, group] of byFingerprint) {
    if (group.length < 2) {
      continue;
    }
    const liveGroup = group.filter((manifest) => isLive(manifest, liveSet));
    if (liveGroup.length === 0) {
      continue;
    }

    const survivor =
      liveGroup.find((manifest) => liveSet.has(norm(manifest.pdfPath))) ?? liveGroup[0];
    const survivorLivePath = liveSet.has(norm(survivor.pdfPath))
      ? norm(survivor.pdfPath)
      : (survivor.knownPdfPaths.map(norm).find((path) => liveSet.has(path)) ??
        norm(survivor.pdfPath));

    for (const member of group) {
      if (member.itemId === survivor.itemId) {
        continue;
      }
      actions.push({
        fingerprint,
        survivorItemId: survivor.itemId,
        survivorItemFolderPath: norm(survivor.itemFolderPath),
        survivorDir: survivor.dir,
        survivorPdfPath: survivorLivePath,
        survivorKnownPdfPaths: [
          ...new Set([
            ...survivor.knownPdfPaths.map(norm),
            ...member.knownPdfPaths.map(norm),
            survivorLivePath,
          ]),
        ],
        absorbedItemId: member.itemId,
        absorbedItemFolderPath: norm(member.itemFolderPath),
        absorbedDir: member.dir,
      });
    }
  }
  return actions;
}

function mergeDirNoOverwrite(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) {
    return 0;
  }
  mkdirSync(targetDir, { recursive: true });
  let merged = 0;
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      merged += mergeDirNoOverwrite(sourcePath, targetPath);
    } else if (!existsSync(targetPath)) {
      copyFileSync(sourcePath, targetPath);
      merged += 1;
    }
  }
  return merged;
}

function applyActions(actions) {
  let applied = 0;
  for (const action of actions) {
    const survivorManifestPath = join(action.survivorDir, "manifest.json");
    if (!existsSync(survivorManifestPath)) {
      continue;
    }
    if (action.absorbedItemFolderPath !== action.survivorItemFolderPath) {
      mergeDirNoOverwrite(action.absorbedDir, action.survivorDir);
      rmSync(action.absorbedDir, { recursive: true, force: true });
    }
    const survivorManifest = JSON.parse(readFileSync(survivorManifestPath, "utf8"));
    survivorManifest.pdfPath = action.survivorPdfPath;
    survivorManifest.knownPdfPaths = action.survivorKnownPdfPaths;
    survivorManifest.updatedAt = Date.now();
    writeFileSync(survivorManifestPath, `${JSON.stringify(survivorManifest, null, 2)}\n`);
    applied += 1;
  }
  return applied;
}

const { live, liveSet } = buildLiveSet();
const { manifests, orphanDirs } = loadManifests();
const actions = plan(manifests, liveSet);
const absorbedIds = new Set(actions.map((action) => action.absorbedItemId));
const deadWithoutSibling = manifests
  .filter((manifest) => !isLive(manifest, liveSet) && !absorbedIds.has(manifest.itemId))
  .map((manifest) => ({
    itemId: manifest.itemId,
    pdfPath: manifest.pdfPath,
    itemFolderPath: norm(manifest.itemFolderPath),
    fileFingerprint: manifest.fileFingerprint,
  }));

if (apply) {
  const applied = applyActions(actions);
  console.log(`Applied ${applied} reconciliation action(s) to ${workspace}.`);
  if (deadWithoutSibling.length) {
    console.log(
      `Skipped ${deadWithoutSibling.length} dead item(s) with no live sibling (manual review):`,
    );
    for (const item of deadWithoutSibling) {
      console.log(`  - ${item.itemId}  (${item.pdfPath})`);
    }
  }
} else if (asJson) {
  console.log(
    JSON.stringify(
      { workspace, livePdfCount: live.length, manifestCount: manifests.length, orphanDirs, actions, deadWithoutSibling },
      null,
      2,
    ),
  );
} else {
  console.log(`Workspace: ${workspace}`);
  console.log(
    `Live PDFs: ${live.length}   Items: ${manifests.length}   Orphan dirs (no manifest): ${orphanDirs.length}`,
  );
  console.log(`Reconciliation actions (absorb into survivor): ${actions.length}`);
  for (const action of actions) {
    console.log(`  - absorb ${action.absorbedItemId}`);
    console.log(`      into ${action.survivorItemId}  (live pdf: ${action.survivorPdfPath})`);
  }
  for (const item of deadWithoutSibling) {
    console.log(`  ! dead item, no live sibling by fingerprint: ${item.itemId}  (${item.pdfPath})`);
  }
  for (const orphan of orphanDirs) {
    console.log(
      `  ! orphan dir: ${orphan.folder}${orphan.reason ? ` (${orphan.reason})` : ""}`,
    );
  }
  console.log("\nDRY-RUN — no changes written. Re-run with --apply to execute.");
}
