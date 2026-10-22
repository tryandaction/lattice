/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import type { StorageAdapter } from "@/lib/storage-adapter";
import {
  registerPdfItemLocation,
  removePdfItemLocation,
  resolvePdfItemLocation,
  resolvePdfItemLocationRoot,
  resolvePdfItemLocationCandidates,
} from "@/lib/pdf-item-location-registry";

class MemoryStorage implements StorageAdapter {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }

  async clear(): Promise<void> {
    this.values.clear();
  }
}

class TestDirectoryHandle {
  readonly kind = "directory" as const;

  constructor(readonly name: string) {}

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === (this as unknown as FileSystemHandle);
  }

  async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
    return possibleDescendant === (this as unknown as FileSystemHandle) ? [] : null;
  }
}

describe("pdf item location registry", () => {
  it('retains previous roots when a stable document is registered from a child workspace', async () => {
    const storage = new MemoryStorage();
    const original = { documentId: 'stable', fileFingerprint: 'fp', workspaceKey: 'web:parent', desktopRootPath: null,
      pdfPath: 'child/paper.pdf', itemFolderPath: '.lattice/items/original' };
    await registerPdfItemLocation(original, { storage });
    await registerPdfItemLocation({ ...original, workspaceKey: 'web:child', pdfPath: 'paper.pdf', itemFolderPath: '.lattice/items/child' }, { storage });
    expect((await resolvePdfItemLocationCandidates({ documentId: 'stable' }, { storage })).map(location => location.workspaceKey)).toEqual(['web:child', 'web:parent']);
    await removePdfItemLocation('stable', { storage });
    expect(await resolvePdfItemLocationCandidates({ documentId: 'stable' }, { storage })).toEqual([]);
  });
  it("preserves both child-workspace locations during concurrent PDF opens", async () => {
    const storage = new MemoryStorage();
    await Promise.all(['parallel-a', 'parallel-b'].map(documentId => registerPdfItemLocation({ documentId,
      fileFingerprint: documentId, workspaceKey: 'web:parallel', desktopRootPath: null,
      pdfPath: `${documentId}.pdf`, itemFolderPath: `.lattice/items/${documentId}`,
    }, { storage })));
    for (const documentId of ['parallel-a', 'parallel-b']) {
      await expect(resolvePdfItemLocation({ documentId }, { storage })).resolves.toMatchObject({ documentId });
    }
  });
  it("resolves a persisted item workspace by document id or unique content fingerprint", async () => {
    const storage = new MemoryStorage();
    await registerPdfItemLocation({
      documentId: "doc-1",
      fileFingerprint: "fingerprint-1",
      workspaceKey: "web:papers",
      desktopRootPath: null,
      pdfPath: "papers/paper.pdf",
      itemFolderPath: ".lattice/items/doc-1",
    }, { storage });

    await expect(resolvePdfItemLocation({ documentId: "doc-1" }, { storage }))
      .resolves.toMatchObject({ itemFolderPath: ".lattice/items/doc-1" });
    await expect(resolvePdfItemLocation({ fileFingerprint: "fingerprint-1" }, { storage }))
      .resolves.toMatchObject({ documentId: "doc-1" });
  });

  it("does not guess when one fingerprint belongs to multiple document ids", async () => {
    const storage = new MemoryStorage();
    await registerPdfItemLocation({
      documentId: "doc-1",
      fileFingerprint: "shared-fingerprint",
      workspaceKey: "web:first",
      desktopRootPath: null,
      pdfPath: "first/paper.pdf",
      itemFolderPath: ".lattice/items/doc-1",
    }, { storage });
    await registerPdfItemLocation({
      documentId: "doc-2",
      fileFingerprint: "shared-fingerprint",
      workspaceKey: "web:second",
      desktopRootPath: null,
      pdfPath: "second/paper.pdf",
      itemFolderPath: ".lattice/items/doc-2",
    }, { storage });

    await expect(resolvePdfItemLocation({ fileFingerprint: "shared-fingerprint" }, { storage }))
      .resolves.toBeNull();
  });

  it("removes a stale location after the final physical PDF is deleted", async () => {
    const storage = new MemoryStorage();
    await registerPdfItemLocation({
      documentId: "doc-delete",
      fileFingerprint: "fingerprint-delete",
      workspaceKey: "web:papers",
      desktopRootPath: null,
      pdfPath: "papers/deleted.pdf",
      itemFolderPath: ".lattice/items/doc-delete",
    }, { storage });

    await removePdfItemLocation("doc-delete", { storage });

    await expect(resolvePdfItemLocation({ documentId: "doc-delete" }, { storage })).resolves.toBeNull();
  });

  it("reopens a registered web workspace root for a moved pdf", async () => {
    const root = new TestDirectoryHandle("papers") as unknown as FileSystemDirectoryHandle;

    const resolved = await resolvePdfItemLocationRoot({
      documentId: "doc-1",
      fileFingerprint: "fingerprint-1",
      workspaceKey: "web:papers",
      desktopRootPath: null,
      pdfPath: "papers/paper.pdf",
      itemFolderPath: ".lattice/items/doc-1",
      updatedAt: 1,
    }, {
      loadWorkspaceRegistration: async () => ({ handle: root } as never),
    });

    expect(resolved).toBe(root);
  });

  it("requests a prompt-state web handle only during an explicit retry", async () => {
    let requestCount = 0;
    const root = {
      name: "papers",
      kind: "directory",
      queryPermission: async () => "prompt",
      requestPermission: async () => {
        requestCount += 1;
        return "granted";
      },
    } as unknown as FileSystemDirectoryHandle;
    const location = {
      documentId: "doc-1",
      fileFingerprint: "fingerprint-1",
      workspaceKey: "web:papers",
      desktopRootPath: null,
      pdfPath: "papers/paper.pdf",
      itemFolderPath: ".lattice/items/doc-1",
      updatedAt: 1,
    };
    const loadWorkspaceRegistration = async () => ({ handle: root } as never);

    await expect(resolvePdfItemLocationRoot(location, { loadWorkspaceRegistration }))
      .resolves.toBeNull();
    expect(requestCount).toBe(0);

    await expect(resolvePdfItemLocationRoot(location, {
      loadWorkspaceRegistration,
      requestPermission: true,
    })).resolves.toBe(root);
    expect(requestCount).toBe(1);
  });
});
