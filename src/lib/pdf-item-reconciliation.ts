/**
 * PDF item reconciliation.
 *
 * Reattaches orphaned ("dead") and duplicate PDF items after a PDF was moved
 * or renamed outside Lattice. The forward path already repairs single moves
 * via `loadPdfItemManifest` fingerprint following and
 * `move/copyPdfItemWorkspace`; this module reconciles the *accumulated* mess:
 *
 *   - a dead item (its `pdfPath` / `knownPdfPaths` no longer resolve) that
 *     shares a `fileFingerprint` with a live item is absorbed into the live
 *     one — its sub-files (notes, notebooks, figures, numerical data) are
 *     merged without overwriting, then the dead item folder is removed;
 *   - duplicate live items with the same `fileFingerprint` collapse into a
 *     single survivor.
 *
 * `planPdfItemReconciliation` is a pure function (safe to run and print as a
 * dry-run). `applyPdfItemReconciliation` executes a plan through an injected
 * filesystem context so it stays unit-testable and never touches user data
 * without an explicit plan.
 */

import type { PdfItemManifest } from "./pdf-item";
import { normalizeWorkspacePath } from "./link-router/path-utils";

export interface PdfItemAbsorbAction {
  kind: "absorb";
  fingerprint: string;
  survivorItemId: string;
  survivorItemFolderPath: string;
  /** Live pdf path the survivor should point at after reconciliation. */
  survivorPdfPath: string;
  survivorKnownPdfPaths: string[];
  absorbedItemId: string;
  absorbedItemFolderPath: string;
}

export interface PdfItemReconciliationContext {
  loadManifest(itemFolderPath: string): Promise<PdfItemManifest | null>;
  saveManifest(manifest: PdfItemManifest): Promise<void>;
  /** Merge source folder into target folder without overwriting existing entries. Returns the number of entries merged. */
  mergeFolder(sourceFolderPath: string, targetFolderPath: string): Promise<number>;
  removeFolder(folderPath: string): Promise<void>;
}

export function isPdfItemManifestLive(
  manifest: PdfItemManifest,
  livePdfPaths: ReadonlySet<string>,
): boolean {
  const candidates = [manifest.pdfPath, ...manifest.knownPdfPaths].map(normalizeWorkspacePath);
  return candidates.some((path) => livePdfPaths.has(path));
}

export function planPdfItemReconciliation(
  manifests: readonly PdfItemManifest[],
  livePdfPaths: readonly string[],
): PdfItemAbsorbAction[] {
  const live = new Set(livePdfPaths.map(normalizeWorkspacePath));

  const byFingerprint = new Map<string, PdfItemManifest[]>();
  for (const item of manifests) {
    if (!item.fileFingerprint) {
      continue;
    }
    const group = byFingerprint.get(item.fileFingerprint) ?? [];
    group.push(item);
    byFingerprint.set(item.fileFingerprint, group);
  }

  const actions: PdfItemAbsorbAction[] = [];

  for (const [fingerprint, group] of byFingerprint) {
    if (group.length < 2) {
      continue;
    }

    const liveGroup = group.filter((item) => isPdfItemManifestLive(item, live));
    if (liveGroup.length === 0) {
      continue; // nothing live to reattach to
    }

    // Prefer a survivor whose primary pdfPath is live.
    const survivor =
      liveGroup.find((item) => live.has(normalizeWorkspacePath(item.pdfPath))) ??
      liveGroup[0];

    const survivorLivePath =
      live.has(normalizeWorkspacePath(survivor.pdfPath))
        ? normalizeWorkspacePath(survivor.pdfPath)
        : (survivor.knownPdfPaths
            .map(normalizeWorkspacePath)
            .find((path) => live.has(path)) ?? normalizeWorkspacePath(survivor.pdfPath));

    const absorbed = group.filter((item) => item.itemId !== survivor.itemId);

    for (const member of absorbed) {
      actions.push({
        kind: "absorb",
        fingerprint,
        survivorItemId: survivor.itemId,
        survivorItemFolderPath: normalizeWorkspacePath(survivor.itemFolderPath),
        survivorPdfPath: survivorLivePath,
        survivorKnownPdfPaths: Array.from(
          new Set([
            ...survivor.knownPdfPaths.map(normalizeWorkspacePath),
            ...member.knownPdfPaths.map(normalizeWorkspacePath),
            survivorLivePath,
          ]),
        ),
        absorbedItemId: member.itemId,
        absorbedItemFolderPath: normalizeWorkspacePath(member.itemFolderPath),
      });
    }
  }

  return actions;
}

export async function applyPdfItemReconciliation(
  actions: readonly PdfItemAbsorbAction[],
  ctx: PdfItemReconciliationContext,
): Promise<number> {
  let applied = 0;

  for (const action of actions) {
    const survivorManifest = await ctx.loadManifest(action.survivorItemFolderPath);
    if (!survivorManifest) {
      continue;
    }

    const absorbedFolder = normalizeWorkspacePath(action.absorbedItemFolderPath);
    const survivorFolder = normalizeWorkspacePath(action.survivorItemFolderPath);
    if (absorbedFolder !== survivorFolder) {
      await ctx.mergeFolder(absorbedFolder, survivorFolder);
      await ctx.removeFolder(absorbedFolder);
    }

    await ctx.saveManifest({
      ...survivorManifest,
      pdfPath: action.survivorPdfPath,
      knownPdfPaths: action.survivorKnownPdfPaths,
      updatedAt: Date.now(),
    });

    applied += 1;
  }

  return applied;
}
