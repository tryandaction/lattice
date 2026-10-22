import { describe, expect, it, vi } from "vitest";
import { createSharedLibraryStore } from "@/stores/shared-library-store";
import { InMemorySharedLibraryContentStore } from "../content-store";
import { InMemorySharedLibraryRepository } from "../local-repository";

describe("shared library store content saves", () => {
  it("commits each edit as a version and serializes concurrent saves", async () => {
    const repository = new InMemorySharedLibraryRepository();
    const contentStore = new InMemorySharedLibraryContentStore();
    const library = await repository.createLibrary({ name: "Editing Lab" });
    const item = await repository.createItem({ libraryId: library.id, kind: "markdown", title: "Notes", canonicalName: "notes.md" });
    await repository.createVersion({ itemId: item.id, manifest: { mimeType: "text/markdown" }, contentHash: "initial" });
    await contentStore.put(item.id, { kind: "text", mimeType: "text/markdown", text: "initial", updatedAt: "2026-08-30T00:00:00.000Z" });
    const store = createSharedLibraryStore(repository, { contentStore });
    await store.getState().openLibrary(library.id);

    await Promise.all([
      store.getState().saveItemContent(item.id, { kind: "text", mimeType: "text/markdown", text: "first", updatedAt: "2026-08-30T00:00:01.000Z" }),
      store.getState().saveItemContent(item.id, { kind: "text", mimeType: "text/markdown", text: "second", updatedAt: "2026-08-30T00:00:02.000Z" }),
    ]);

    expect((await repository.listItemVersions(item.id)).length).toBe(3);
    const savedContent = await contentStore.get(item.id);
    expect(savedContent?.kind === "text" ? savedContent.text : null).toBe("second");
    expect(store.getState().items.find((entry) => entry.id === item.id)?.currentVersionId).toBe((await repository.listItemVersions(item.id)).at(-1)?.id);
  });

  it("deduplicates concurrent comment loads for the same annotation", async () => {
    const repository = new InMemorySharedLibraryRepository();
    const library = await repository.createLibrary({ name: "Comments" });
    const item = await repository.createItem({ libraryId: library.id, kind: "pdf", title: "Paper", canonicalName: "paper.pdf" });
    const version = await repository.createVersion({ itemId: item.id, manifest: { mimeType: "application/pdf" }, contentHash: "pdf" });
    const annotation = await repository.createAnnotation({ itemId: item.id, versionId: version.id, kind: "comment", target: { locatorType: "pdf-page", locator: { page: 1 } }, style: {}, body: { text: "Note" } });
    const listComments = vi.spyOn(repository, "listComments");
    const store = createSharedLibraryStore(repository);

    await Promise.all([
      store.getState().loadComments(annotation.id),
      store.getState().loadComments(annotation.id),
      store.getState().loadComments(annotation.id),
    ]);

    expect(listComments).toHaveBeenCalledTimes(1);
  });
});
