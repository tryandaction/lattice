import { describe, expect, it } from "vitest";
import { PersistentSharedLibraryRepository } from "../local-repository";
import type { StorageAdapter } from "@/lib/storage-adapter";

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

describe("PersistentSharedLibraryRepository", () => {
  it("restores libraries and items after a new repository instance is created", async () => {
    const storage = new MemoryStorage();
    const first = new PersistentSharedLibraryRepository({ storage, key: "test-library" });
    const library = await first.createLibrary({ name: "Persistent Lab" });
    await first.createItem({
      libraryId: library.id,
      kind: "markdown",
      title: "Notes",
      canonicalName: "notes.md",
    });

    const second = new PersistentSharedLibraryRepository({ storage, key: "test-library" });
    await expect(second.listLibraries()).resolves.toHaveLength(1);
    await expect(second.listItems({ libraryId: library.id })).resolves.toHaveLength(1);
  });

  it("creates a version when content is created through the store", async () => {
    const library = new PersistentSharedLibraryRepository({ storage: new MemoryStorage(), key: "versioned" });
    const created = await library.createLibrary({ name: "Version Lab" });
    const item = await library.createItem({ libraryId: created.id, kind: "markdown", title: "Notes", canonicalName: "notes.md" });
    const version = await library.createVersion({ itemId: item.id, manifest: {}, contentHash: "hash-1" });
    expect(version.itemId).toBe(item.id);
    expect((await library.getItem(item.id)).currentVersionId).toBe(version.id);
  });

  it("persists annotation comments and supports replies/edit/delete", async () => {
    const storage = new MemoryStorage();
    const library = new PersistentSharedLibraryRepository({ storage, key: "comments" });
    const created = await library.createLibrary({ name: "Comments Lab" });
    const item = await library.createItem({ libraryId: created.id, kind: "markdown", title: "Notes", canonicalName: "notes.md" });
    const version = await library.createVersion({ itemId: item.id, manifest: {}, contentHash: "hash" });
    const annotation = await library.createAnnotation({ itemId: item.id, versionId: version.id, kind: "comment", target: { locatorType: "markdown-heading", locator: { heading: "Notes" } }, style: {}, body: { text: "Question" } });
    const root = await library.createComment({ annotationId: annotation.id, body: "First comment" });
    const reply = await library.createComment({ annotationId: annotation.id, parentId: root.id, body: "Reply" });
    expect((await library.listComments(annotation.id)).map((entry) => entry.body)).toEqual(["First comment", "Reply"]);
    await expect(library.updateComment({ commentId: reply.id, body: "Edited reply" })).resolves.toMatchObject({ body: "Edited reply" });
    await library.deleteComment(root.id);
    expect((await library.listComments(annotation.id)).find((entry) => entry.id === root.id)?.deletedAt).toBeTruthy();

    const restored = new PersistentSharedLibraryRepository({ storage, key: "comments" });
    expect((await restored.listComments(annotation.id)).map((entry) => entry.body)).toEqual(["First comment", "Edited reply"]);
    expect((await restored.listComments(annotation.id))[0].deletedAt).toBeTruthy();
  });
});
