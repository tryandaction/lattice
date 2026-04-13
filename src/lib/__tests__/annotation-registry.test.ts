/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = {
  get: vi.fn(async (key: string) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }),
  set: vi.fn(async (key: string, value: unknown) => {
    localStorage.setItem(key, JSON.stringify(value));
  }),
  remove: vi.fn(async (key: string) => {
    localStorage.removeItem(key);
  }),
  clear: vi.fn(async () => {
    localStorage.clear();
  }),
};

vi.mock("@/lib/storage-adapter", () => ({
  getStorageAdapter: () => storage,
}));

import {
  loadAnnotationRegistry,
  registerAnnotationLocation,
  resolveAnnotationRegistryMatch,
} from "@/lib/annotation-registry";

describe("annotation-registry", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("rebinding by canonical path works when there is a single historical owner", async () => {
    await registerAnnotationLocation({
      documentId: "paper-id",
      alias: {
        sourcePath: ".lattice/annotations/paper-id.json",
        canonicalPath: "desktop:C:/Course/docs/paper.pdf",
        relativePathFromRoot: "docs/paper.pdf",
        fileId: "paper-id",
        workspaceKey: "desktop:C:/Course",
        versionFingerprint: "version-v1",
        updatedAt: 1,
      },
      fileFingerprint: "fingerprint-v1",
      versionFingerprint: "version-v1",
    });

    const match = await resolveAnnotationRegistryMatch({
      fileFingerprint: "fingerprint-v2",
      versionFingerprint: "version-v2",
      canonicalPath: "desktop:C:/Course/docs/paper.pdf",
    });

    expect(match.strategy).toBe("canonical-path");
    expect(match.conflict).toBeNull();
    expect(match.aliases[0]?.fileId).toBe("paper-id");
  });

  it("marks canonical path reuse as conflict and blocks silent auto-binding", async () => {
    await registerAnnotationLocation({
      documentId: "paper-a",
      alias: {
        sourcePath: ".lattice/annotations/paper-a.json",
        canonicalPath: "desktop:C:/Course/docs/paper.pdf",
        relativePathFromRoot: "docs/paper.pdf",
        fileId: "paper-a",
        workspaceKey: "desktop:C:/Course",
        versionFingerprint: "version-a",
        updatedAt: 1,
      },
      fileFingerprint: "fingerprint-a",
      versionFingerprint: "version-a",
    });

    await registerAnnotationLocation({
      documentId: "paper-b",
      alias: {
        sourcePath: ".lattice/annotations/paper-b.json",
        canonicalPath: "desktop:C:/Course/docs/paper.pdf",
        relativePathFromRoot: "docs/paper.pdf",
        fileId: "paper-b",
        workspaceKey: "desktop:C:/Archive",
        versionFingerprint: "version-b",
        updatedAt: 2,
      },
      fileFingerprint: "fingerprint-b",
      versionFingerprint: "version-b",
    });

    const registry = await loadAnnotationRegistry();
    expect(registry.conflictsByCanonicalPath["desktop:C:/Course/docs/paper.pdf"]?.status).toBe("open");

    const match = await resolveAnnotationRegistryMatch({
      fileFingerprint: "fingerprint-c",
      versionFingerprint: "version-c",
      canonicalPath: "desktop:C:/Course/docs/paper.pdf",
    });

    expect(match.strategy).toBe("none");
    expect(match.aliases).toHaveLength(0);
    expect(match.conflict?.contenderDocumentIds.sort()).toEqual(["paper-a", "paper-b"]);
  });

  it("does not auto-bind by fingerprint when copied PDFs branch into multiple document ids", async () => {
    await registerAnnotationLocation({
      documentId: "paper-origin",
      alias: {
        sourcePath: ".lattice/annotations/paper-origin.json",
        canonicalPath: "desktop:C:/Course/docs/paper.pdf",
        relativePathFromRoot: "docs/paper.pdf",
        fileId: "paper-origin",
        workspaceKey: "desktop:C:/Course",
        updatedAt: 1,
      },
      fileFingerprint: "shared-fingerprint",
      versionFingerprint: "version-a",
    });

    await registerAnnotationLocation({
      documentId: "paper-copy",
      alias: {
        sourcePath: ".lattice/annotations/paper-copy.json",
        canonicalPath: "desktop:C:/Course/archive/paper-copy.pdf",
        relativePathFromRoot: "archive/paper-copy.pdf",
        fileId: "paper-copy",
        workspaceKey: "desktop:C:/Course",
        updatedAt: 2,
      },
      fileFingerprint: "shared-fingerprint",
      versionFingerprint: "version-a",
    });

    const match = await resolveAnnotationRegistryMatch({
      fileFingerprint: "shared-fingerprint",
      versionFingerprint: "version-a",
      canonicalPath: "desktop:C:/Course/elsewhere/paper.pdf",
    });

    expect(match.strategy).toBe("none");
    expect(match.documentId).toBeNull();
    expect(match.aliases).toHaveLength(0);
  });
});
