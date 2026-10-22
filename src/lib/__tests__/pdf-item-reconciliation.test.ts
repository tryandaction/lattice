import { describe, expect, it, vi } from "vitest";
import type { PdfItemManifest } from "@/lib/pdf-item";
import {
  applyPdfItemReconciliation,
  planPdfItemReconciliation,
  type PdfItemReconciliationContext,
} from "@/lib/pdf-item-reconciliation";

function manifest(overrides: Partial<PdfItemManifest> & { itemId: string; itemFolderPath: string }): PdfItemManifest {
  return {
    version: 4,
    itemId: overrides.itemId,
    pdfPath: overrides.pdfPath ?? "papers/a.pdf",
    itemFolderPath: overrides.itemFolderPath,
    annotationIndexPath: `${overrides.itemFolderPath}/_annotations.md`,
    fileFingerprint: overrides.fileFingerprint !== undefined ? overrides.fileFingerprint : "fp-1",
    versionFingerprint: overrides.versionFingerprint ?? null,
    knownPdfPaths: overrides.knownPdfPaths ?? [overrides.pdfPath ?? "papers/a.pdf"],
    createdAt: 1710000000000,
    updatedAt: 1710000000000,
  };
}

describe("planPdfItemReconciliation", () => {
  it("reattaches a dead item to its live sibling by fingerprint", () => {
    const dead = manifest({
      itemId: "atom-old-path.pdf",
      itemFolderPath: ".lattice/items/atom-old-path.pdf",
      pdfPath: "essay/old/paper.pdf",
      fileFingerprint: "fp-1",
      knownPdfPaths: ["essay/old/paper.pdf"],
    });
    const live = manifest({
      itemId: "atom-new-path.pdf",
      itemFolderPath: ".lattice/items/atom-new-path.pdf",
      pdfPath: "01_hardware/paper.pdf",
      fileFingerprint: "fp-1",
      knownPdfPaths: ["01_hardware/paper.pdf"],
    });

    const plan = planPdfItemReconciliation([dead, live], ["01_hardware/paper.pdf"]);

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      kind: "absorb",
      fingerprint: "fp-1",
      survivorItemId: "atom-new-path.pdf",
      survivorPdfPath: "01_hardware/paper.pdf",
      absorbedItemId: "atom-old-path.pdf",
      absorbedItemFolderPath: ".lattice/items/atom-old-path.pdf",
    });
    expect(plan[0].survivorKnownPdfPaths).toContain("01_hardware/paper.pdf");
    expect(plan[0].survivorKnownPdfPaths).toContain("essay/old/paper.pdf");
  });

  it("absorbs duplicate live items into a single survivor", () => {
    const first = manifest({
      itemId: "item-a",
      itemFolderPath: ".lattice/items/item-a",
      pdfPath: "a/paper.pdf",
      fileFingerprint: "fp-1",
    });
    const second = manifest({
      itemId: "item-b",
      itemFolderPath: ".lattice/items/item-b",
      pdfPath: "b/paper.pdf",
      fileFingerprint: "fp-1",
    });

    const plan = planPdfItemReconciliation([first, second], ["a/paper.pdf", "b/paper.pdf"]);

    expect(plan).toHaveLength(1);
    expect(plan[0].survivorItemId).toBe("item-a");
    expect(plan[0].absorbedItemId).toBe("item-b");
  });

  it("ignores manifests without a fingerprint", () => {
    const dead = manifest({
      itemId: "no-fp-dead",
      itemFolderPath: ".lattice/items/no-fp-dead",
      pdfPath: "gone/paper.pdf",
      fileFingerprint: null,
      knownPdfPaths: ["gone/paper.pdf"],
    });
    const live = manifest({
      itemId: "no-fp-live",
      itemFolderPath: ".lattice/items/no-fp-live",
      pdfPath: "here/paper.pdf",
      fileFingerprint: null,
      knownPdfPaths: ["here/paper.pdf"],
    });

    expect(planPdfItemReconciliation([dead, live], ["here/paper.pdf"])).toEqual([]);
  });

  it("leaves a group alone when every member is dead", () => {
    const deadA = manifest({
      itemId: "dead-a",
      itemFolderPath: ".lattice/items/dead-a",
      pdfPath: "gone-a/paper.pdf",
      fileFingerprint: "fp-1",
    });
    const deadB = manifest({
      itemId: "dead-b",
      itemFolderPath: ".lattice/items/dead-b",
      pdfPath: "gone-b/paper.pdf",
      fileFingerprint: "fp-1",
    });

    expect(planPdfItemReconciliation([deadA, deadB], [])).toEqual([]);
  });

  it("uses a live knownPdfPath when the survivor's primary pdfPath is dead", () => {
    const survivor = manifest({
      itemId: "survivor",
      itemFolderPath: ".lattice/items/survivor",
      pdfPath: "gone/paper.pdf",
      fileFingerprint: "fp-1",
      knownPdfPaths: ["gone/paper.pdf", "new/paper.pdf"],
    });
    const absorbed = manifest({
      itemId: "absorbed",
      itemFolderPath: ".lattice/items/absorbed",
      pdfPath: "other/paper.pdf",
      fileFingerprint: "fp-1",
    });

    const plan = planPdfItemReconciliation([survivor, absorbed], ["new/paper.pdf"]);

    expect(plan).toHaveLength(1);
    expect(plan[0].survivorItemId).toBe("survivor");
    expect(plan[0].survivorPdfPath).toBe("new/paper.pdf");
  });
});

describe("applyPdfItemReconciliation", () => {
  it("merges the absorbed folder into the survivor and persists the updated manifest", async () => {
    const survivor = manifest({
      itemId: "item-a",
      itemFolderPath: ".lattice/items/item-a",
      pdfPath: "a/paper.pdf",
      fileFingerprint: "fp-1",
    });
    const actions = planPdfItemReconciliation(
      [
        survivor,
        manifest({
          itemId: "item-b",
          itemFolderPath: ".lattice/items/item-b",
          pdfPath: "b/paper.pdf",
          fileFingerprint: "fp-1",
        }),
      ],
      ["a/paper.pdf"],
    );

    const ctx: PdfItemReconciliationContext = {
      loadManifest: vi.fn(async () => survivor),
      saveManifest: vi.fn(async () => undefined),
      mergeFolder: vi.fn(async () => 3),
      removeFolder: vi.fn(async () => undefined),
    };

    const applied = await applyPdfItemReconciliation(actions, ctx);

    expect(applied).toBe(1);
    expect(ctx.mergeFolder).toHaveBeenCalledWith(
      ".lattice/items/item-b",
      ".lattice/items/item-a",
    );
    expect(ctx.removeFolder).toHaveBeenCalledWith(".lattice/items/item-b");
    expect(ctx.saveManifest).toHaveBeenCalledTimes(1);
    const saved = (ctx.saveManifest as ReturnType<typeof vi.fn>).mock.calls[0][0] as PdfItemManifest;
    expect(saved.itemId).toBe("item-a");
    expect(saved.pdfPath).toBe("a/paper.pdf");
  });

  it("skips an action when the survivor manifest cannot be loaded", async () => {
    const actions = [
      {
        kind: "absorb" as const,
        fingerprint: "fp-1",
        survivorItemId: "item-a",
        survivorItemFolderPath: ".lattice/items/item-a",
        survivorPdfPath: "a/paper.pdf",
        survivorKnownPdfPaths: ["a/paper.pdf"],
        absorbedItemId: "item-b",
        absorbedItemFolderPath: ".lattice/items/item-b",
      },
    ];

    const ctx: PdfItemReconciliationContext = {
      loadManifest: vi.fn(async () => null),
      saveManifest: vi.fn(async () => undefined),
      mergeFolder: vi.fn(async () => 0),
      removeFolder: vi.fn(async () => undefined),
    };

    const applied = await applyPdfItemReconciliation(actions, ctx);

    expect(applied).toBe(0);
    expect(ctx.mergeFolder).not.toHaveBeenCalled();
    expect(ctx.removeFolder).not.toHaveBeenCalled();
    expect(ctx.saveManifest).not.toHaveBeenCalled();
  });
});
