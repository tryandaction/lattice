/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { buildFileFingerprint } from "@/lib/file-identity";

class FakeFileHandle {
  constructor(
    public name: string,
    private readonly content: string,
    private readonly lastModified: number,
  ) {}

  async getFile() {
    return new File([this.content], this.name, { lastModified: this.lastModified });
  }
}

describe("file-identity fingerprints", () => {
  it("keeps content fingerprint stable across rename when bytes stay the same", async () => {
    const first = await buildFileFingerprint(new FakeFileHandle("paper-v1.pdf", "same content", 1000) as unknown as FileSystemFileHandle);
    const renamed = await buildFileFingerprint(new FakeFileHandle("paper-renamed.pdf", "same content", 1000) as unknown as FileSystemFileHandle);

    expect(first.fingerprint).toBe(renamed.fingerprint);
    expect(first.versionFingerprint).not.toBe(renamed.versionFingerprint);
  });

  it("changes content fingerprint when file bytes change", async () => {
    const first = await buildFileFingerprint(new FakeFileHandle("paper.pdf", "same content", 1000) as unknown as FileSystemFileHandle);
    const updated = await buildFileFingerprint(new FakeFileHandle("paper.pdf", "changed content", 2000) as unknown as FileSystemFileHandle);

    expect(first.fingerprint).not.toBe(updated.fingerprint);
    expect(first.versionFingerprint).not.toBe(updated.versionFingerprint);
  });
});
