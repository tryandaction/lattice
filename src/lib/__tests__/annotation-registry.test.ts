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
    await registerAnnotationLocation("fingerprint-v1", {
      sourcePath: ".lattice/annotations/paper-id.json",
      canonicalPath: "desktop:C:/Course/docs/paper.pdf",
      relativePathFromRoot: "docs/paper.pdf",
      fileId: "paper-id",
      workspaceKey: "desktop:C:/Course",
      versionFingerprint: "version-v1",
      updatedAt: 1,
    }, {
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
    await registerAnnotationLocation("fingerprint-a", {
      sourcePath: ".lattice/annotations/paper-a.json",
      canonicalPath: "desktop:C:/Course/docs/paper.pdf",
      relativePathFromRoot: "docs/paper.pdf",
      fileId: "paper-a",
      workspaceKey: "desktop:C:/Course",
      versionFingerprint: "version-a",
      updatedAt: 1,
    }, {
      versionFingerprint: "version-a",
    });

    await registerAnnotationLocation("fingerprint-b", {
      sourcePath: ".lattice/annotations/paper-b.json",
      canonicalPath: "desktop:C:/Course/docs/paper.pdf",
      relativePathFromRoot: "docs/paper.pdf",
      fileId: "paper-b",
      workspaceKey: "desktop:C:/Archive",
      versionFingerprint: "version-b",
      updatedAt: 2,
    }, {
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
    expect(match.conflict?.contenderFingerprints.sort()).toEqual(["fingerprint-a", "fingerprint-b"]);
  });
});
