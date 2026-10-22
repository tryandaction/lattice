import { beforeEach, describe, expect, it } from "vitest";
import { InMemorySharedLibraryRepository } from "../local-repository";
import { isSharedLibraryError } from "../errors";
import type { SyncOperation } from "../domain";

describe("shared library repository contract", () => {
  let repo: InMemorySharedLibraryRepository;

  beforeEach(() => {
    repo = new InMemorySharedLibraryRepository();
  });

  it("creates and lists libraries", async () => {
    const library = await repo.createLibrary({ name: "Research Lab" });
    expect(library.id).toBe("lib-1");
    expect(library.name).toBe("Research Lab");
    expect(library.visibility).toBe("private");
    expect(Number.isNaN(Date.parse(library.createdAt))).toBe(false);

    const all = await repo.listLibraries();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(library.id);
  });

  it("throws NOT_FOUND for a missing library", async () => {
    let caught: unknown = null;
    try {
      await repo.getLibrary("lib-missing");
    } catch (error) {
      caught = error;
    }
    if (!isSharedLibraryError(caught)) {
      throw new Error("expected a SharedLibraryError");
    }
    expect(caught.code).toBe("NOT_FOUND");
  });

  it("creates and reads items within a library", async () => {
    const library = await repo.createLibrary({ name: "Lab" });
    const item = await repo.createItem({
      libraryId: library.id,
      kind: "pdf",
      title: "paper.pdf",
      canonicalName: "paper.pdf",
    });
    expect(item.id).toBe("item-1");
    expect(item.kind).toBe("pdf");
    expect(item.status).toBe("active");

    const fetched = await repo.getItem(item.id);
    expect(fetched.id).toBe(item.id);

    const items = await repo.listItems({ libraryId: library.id });
    expect(items).toHaveLength(1);
  });

  it("filters items by collection", async () => {
    const library = await repo.createLibrary({ name: "Lab" });
    const item = await repo.createItem({
      libraryId: library.id,
      kind: "code",
      title: "main.ts",
      canonicalName: "main.ts",
      collectionId: "col-1",
    });
    await repo.createItem({
      libraryId: library.id,
      kind: "markdown",
      title: "notes.md",
      canonicalName: "notes.md",
    });

    const inCollection = await repo.listItems({
      libraryId: library.id,
      collectionId: "col-1",
    });
    expect(inCollection).toHaveLength(1);
    expect(inCollection[0].id).toBe(item.id);
  });

  it("updates item metadata", async () => {
    const library = await repo.createLibrary({ name: "Lab" });
    const item = await repo.createItem({
      libraryId: library.id,
      kind: "markdown",
      title: "notes.md",
      canonicalName: "notes.md",
    });
    const updated = await repo.updateItem({ itemId: item.id, title: "renamed.md" });
    expect(updated.title).toBe("renamed.md");
  });

  it("adds child items and lists them under the parent", async () => {
    const library = await repo.createLibrary({ name: "Lab" });
    const parent = await repo.createItem({
      libraryId: library.id,
      kind: "pdf",
      title: "paper.pdf",
      canonicalName: "paper.pdf",
    });
    const child = await repo.addItemChild({
      parentItemId: parent.id,
      relativePath: "notes.md",
      kind: "markdown",
    });
    expect(child.parentItemId).toBe(parent.id);
    expect(child.childItemId).toBe("item-2");
    expect(child.relativePath).toBe("notes.md");

    const children = await repo.listItemChildren(parent.id);
    expect(children).toHaveLength(1);
    expect(children[0].childItemId).toBe(child.childItemId);
  });

  it("creates versions and advances the item pointer", async () => {
    const library = await repo.createLibrary({ name: "Lab" });
    const item = await repo.createItem({
      libraryId: library.id,
      kind: "pdf",
      title: "paper.pdf",
      canonicalName: "paper.pdf",
    });
    const version = await repo.createVersion({
      itemId: item.id,
      manifest: { note: "v1" },
      contentHash: "abc123",
    });
    expect(version.versionNumber).toBe(1);

    const versions = await repo.listItemVersions(item.id);
    expect(versions).toHaveLength(1);

    const refreshed = await repo.getItem(item.id);
    expect(refreshed.currentVersionId).toBe(version.id);
    expect(refreshed.contentHash).toBe("abc123");
  });

  it("creates and lists annotations", async () => {
    const library = await repo.createLibrary({ name: "Lab" });
    const item = await repo.createItem({
      libraryId: library.id,
      kind: "pdf",
      title: "paper.pdf",
      canonicalName: "paper.pdf",
    });
    const version = await repo.createVersion({
      itemId: item.id,
      manifest: {},
      contentHash: "x",
    });
    const annotation = await repo.createAnnotation({
      itemId: item.id,
      versionId: version.id,
      kind: "highlight",
      target: { locatorType: "pdf-page", locator: { page: 2 } },
      style: { color: "#FFEB3B", type: "highlight" },
    });
    expect(annotation.revision).toBe(1);

    const list = await repo.listAnnotations(item.id);
    expect(list).toHaveLength(1);
    expect(list[0].target.locator.page).toBe(2);
  });

  it("trashes and restores items, hiding trashed items by default", async () => {
    const library = await repo.createLibrary({ name: "Lab" });
    const item = await repo.createItem({
      libraryId: library.id,
      kind: "markdown",
      title: "notes.md",
      canonicalName: "notes.md",
    });

    const trashed = await repo.trashItem(item.id);
    expect(trashed.status).toBe("trashed");

    expect(await repo.listItems({ libraryId: library.id })).toHaveLength(0);
    expect(
      await repo.listItems({ libraryId: library.id, includeTrashed: true }),
    ).toHaveLength(1);

    const restored = await repo.restoreItem(item.id);
    expect(restored.status).toBe("active");
    expect(await repo.listItems({ libraryId: library.id })).toHaveLength(1);
  });

  it("appends operations idempotently by idempotency key", async () => {
    const library = await repo.createLibrary({ name: "Lab" });
    const op: SyncOperation = {
      id: "op-1",
      libraryId: library.id,
      actorId: "user-1",
      deviceId: "d1",
      clientSequence: 1,
      operationType: "item.create",
      entityType: "item",
      entityId: "item-1",
      payload: {},
      idempotencyKey: "d1:1",
      createdAt: "2026-08-20T00:00:00.000Z",
    };
    await repo.appendOperation(op);
    await repo.appendOperation({ ...op, id: "op-2" });

    expect(await repo.listOperations()).toHaveLength(1);
    expect(await repo.listOperations()).toContainEqual(op);
  });
});
