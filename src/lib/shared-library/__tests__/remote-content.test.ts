import { describe, expect, it } from "vitest";
import { InMemorySharedLibraryRepository } from "../local-repository";
import { loadRemoteSharedLibraryItemContent, RemoteSharedLibraryContentStore } from "../remote-content";

describe("remote shared-library content", () => {
  it("resolves the current version blob and decodes text content", async () => {
    const repository = new InMemorySharedLibraryRepository();
    const library = await repository.createLibrary({ name: "Remote Lab" });
    const item = await repository.createItem({ libraryId: library.id, kind: "markdown", title: "Notes", canonicalName: "notes.md" });
    await repository.createVersion({ itemId: item.id, blobId: "blob-1", manifest: { mimeType: "text/markdown" }, contentHash: "hash-1" });

    const transport = {
      request: async () => ({ status: 200, body: new TextEncoder().encode("# Remote notes").buffer }),
    };
    const content = await loadRemoteSharedLibraryItemContent(repository, transport, item.id);

    expect(content).toMatchObject({ kind: "text", mimeType: "text/markdown", text: "# Remote notes" });
    await expect(new RemoteSharedLibraryContentStore(repository, transport).get(item.id)).resolves.toMatchObject({ text: "# Remote notes" });
  });

  it("returns null when a remote version has no blob", async () => {
    const repository = new InMemorySharedLibraryRepository();
    const library = await repository.createLibrary({ name: "Metadata Lab" });
    const item = await repository.createItem({ libraryId: library.id, kind: "pdf", title: "Paper", canonicalName: "paper.pdf" });
    await repository.createVersion({ itemId: item.id, manifest: {}, contentHash: "hash-1" });
    const transport = { request: async () => ({ status: 200, body: new ArrayBuffer(0) }) };

    await expect(loadRemoteSharedLibraryItemContent(repository, transport, item.id)).resolves.toBeNull();
  });
});
