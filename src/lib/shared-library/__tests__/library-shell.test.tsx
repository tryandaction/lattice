/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { createSharedLibraryStore } from "@/stores/shared-library-store";
import { InMemorySharedLibraryRepository } from "@/lib/shared-library/local-repository";
import { InMemorySharedLibraryContentStore } from "@/lib/shared-library/content-store";
import {
  ItemWorkspaceRegistry,
  type ItemWorkspaceAdapter,
} from "@/lib/shared-library/item-workspace";
import { LibraryShell } from "@/components/shared-library/library-shell";
import { parseSharedLibraryPath } from "@/components/shared-library/library-shell";

beforeEach(() => setLocale("en-US"));
afterEach(() => { cleanup(); setLocale("zh-CN"); });

const pdfAdapter: ItemWorkspaceAdapter = {
  kind: "pdf",
  label: "PDF",
  renderViewer: () => <div data-testid="pdf-viewer" />,
};

const markdownAdapter: ItemWorkspaceAdapter = {
  kind: "markdown",
  label: "Markdown",
  renderViewer: () => <div data-testid="md-viewer" />,
};

async function seedRepository(): Promise<InMemorySharedLibraryRepository> {
  const repo = new InMemorySharedLibraryRepository();
  const library = await repo.createLibrary({
    name: "Research Lab",
    slug: "research-lab",
    organizationId: "org-1",
    createdBy: "user-1",
  });
  await repo.createItem({
    libraryId: library.id,
    kind: "markdown",
    title: "Meeting Notes",
    canonicalName: "meeting-notes",
  });
  await repo.createItem({
    libraryId: library.id,
    kind: "pdf",
    title: "Quantum Paper",
    canonicalName: "quantum-paper",
  });
  return repo;
}

describe("LibraryShell", () => {
  it("searches the translated item type shown in the library", async () => {
    setLocale("zh-CN");
    const store = createSharedLibraryStore(await seedRepository());
    render(<LibraryShell store={store} registry={new ItemWorkspaceRegistry()} />);
    fireEvent.click(await screen.findByText("Research Lab"));
    await screen.findByText("Meeting Notes");
    fireEvent.change(screen.getByLabelText("搜索文件"), { target: { value: "笔记" } });
    expect(screen.getByText("Meeting Notes")).toBeTruthy();
    expect(screen.queryByText("Quantum Paper")).toBeNull();
  });
  it("keeps an item draft and user titles when switching the open library to Chinese", async () => {
    const repo = await seedRepository();
    const store = createSharedLibraryStore(repo);
    render(<LibraryShell store={store} registry={new ItemWorkspaceRegistry()} />);
    fireEvent.click(await screen.findByText("Research Lab"));
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "My draft 草稿" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Keep this text" } });
    act(() => setLocale("zh-CN"));
    expect((screen.getByLabelText("文件标题") as HTMLInputElement).value).toBe("My draft 草稿");
    expect((screen.getByLabelText("内容") as HTMLTextAreaElement).value).toBe("Keep this text");
    expect(screen.getByText("Research Lab")).toBeTruthy();
    expect(screen.getByText("Meeting Notes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建文件" })).toBeTruthy();
    expect(screen.queryByText(/^sync:/)).toBeNull();
    expect(await repo.listItems({ libraryId: "lib-1" })).toHaveLength(2);
  });
  it("parses encoded library and item ids from static-host deep links", () => {
    expect(parseSharedLibraryPath("/library/lib%2Fone/item/item%2Ftwo")).toEqual({
      libraryId: "lib/one",
      itemId: "item/two",
    });
    expect(parseSharedLibraryPath("/library/__index__")).toEqual({ libraryId: null, itemId: null });
  });
  it("lists libraries, opens one and mounts the item workspace viewer", async () => {
    const repo = await seedRepository();
    const store = createSharedLibraryStore(repo);
    const registry = new ItemWorkspaceRegistry()
      .register(pdfAdapter)
      .register(markdownAdapter);

    render(<LibraryShell store={store} registry={registry} />);

    await waitFor(() => {
      expect(screen.getByText("Research Lab")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Research Lab"));

    await waitFor(() => {
      expect(screen.getByText("Meeting Notes")).toBeTruthy();
    });
    expect(screen.getByText("Quantum Paper")).toBeTruthy();

    fireEvent.click(screen.getByText("Meeting Notes"));

    await waitFor(() => {
      expect(screen.getByTestId("md-viewer")).toBeTruthy();
    });
    expect(screen.queryByTestId("pdf-viewer")).toBeNull();
  });

  it("renders an empty state when the repository has no libraries", async () => {
    const repo = new InMemorySharedLibraryRepository();
    const store = createSharedLibraryStore(repo);

    render(
      <LibraryShell
        store={store}
        registry={new ItemWorkspaceRegistry().register(markdownAdapter)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no libraries/i)).toBeTruthy();
    });
  });

  it("opens an item directly from the route params", async () => {
    const repo = await seedRepository();
    const items = await repo.listItems({ libraryId: "lib-1" });
    const markdown = items.find((item) => item.kind === "markdown")!;
    const store = createSharedLibraryStore(repo);
    const registry = new ItemWorkspaceRegistry().register(markdownAdapter);

    render(
      <LibraryShell
        store={store}
        registry={registry}
        initialLibraryId="lib-1"
        initialItemId={markdown.id}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("md-viewer")).toBeTruthy();
    });
    expect(screen.getByText("Meeting Notes")).toBeTruthy();
  });

  it("creates a new library through the shell form", async () => {
    const repo = new InMemorySharedLibraryRepository();
    const store = createSharedLibraryStore(repo);

    render(
      <LibraryShell store={store} registry={new ItemWorkspaceRegistry()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no libraries/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /new library/i }));
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "Second Vault" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByText("Second Vault")).toBeTruthy();
    });
  });

  it("offers an item creation workflow inside an open library", async () => {
    const repo = new InMemorySharedLibraryRepository();
    const library = await repo.createLibrary({ name: "Research Lab" });
    const store = createSharedLibraryStore(repo);

    render(<LibraryShell store={store} registry={new ItemWorkspaceRegistry()} />);
    await waitFor(() => expect(screen.getByText("Research Lab")).toBeTruthy());
    fireEvent.click(screen.getByText("Research Lab"));

    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    fireEvent.change(screen.getByLabelText(/item title/i), { target: { value: "Methods" } });
    fireEvent.change(screen.getByLabelText(/content/i), { target: { value: "# Methods" } });
    fireEvent.click(screen.getByRole("button", { name: /create item/i }));

    await waitFor(() => expect(screen.getByText("Methods")).toBeTruthy());
  });

  it("shows a shared annotation panel for a PDF item after opening it", async () => {
    const repo = new InMemorySharedLibraryRepository();
    const library = await repo.createLibrary({ name: "Reading Lab" });
    const item = await repo.createItem({ libraryId: library.id, kind: "pdf", title: "Paper", canonicalName: "paper.pdf" });
    await repo.createVersion({ itemId: item.id, manifest: {}, contentHash: "pdf-hash" });
    const store = createSharedLibraryStore(repo, { contentStore: { get: async () => ({ kind: "binary", mimeType: "application/pdf", data: new ArrayBuffer(0), updatedAt: "2026-08-30T00:00:00.000Z" }), put: async () => {}, remove: async () => {} } });
    const registry = new ItemWorkspaceRegistry().register({
      kind: "pdf",
      label: "PDF",
      renderViewer: () => <div data-testid="pdf-content" />,
      renderTools: (workspaceItem) => <div data-testid="shared-annotation-panel">{String((workspaceItem.extras?.annotations as unknown[] | undefined)?.length ?? 0)}</div>,
    });

    render(<LibraryShell store={store} registry={registry} />);
    await waitFor(() => expect(screen.getByText("Reading Lab")).toBeTruthy());
    fireEvent.click(screen.getByText("Reading Lab"));
    await waitFor(() => expect(screen.getByText("Paper")).toBeTruthy());
    fireEvent.click(screen.getByText("Paper"));
    await waitFor(() => expect(screen.getByTestId("shared-annotation-panel")).toBeTruthy());
  });

  it("repairs a legacy content-only item before creating an annotation", async () => {
    const repo = new InMemorySharedLibraryRepository();
    const library = await repo.createLibrary({ name: "Legacy Lab" });
    const item = await repo.createItem({ libraryId: library.id, kind: "pdf", title: "Legacy PDF", canonicalName: "legacy.pdf" });
    const contentStore = new InMemorySharedLibraryContentStore();
    await contentStore.put(item.id, {
      kind: "binary",
      mimeType: "application/pdf",
      data: new ArrayBuffer(8),
      updatedAt: "2026-08-30T00:00:00.000Z",
    });
    const store = createSharedLibraryStore(repo, { contentStore });

    const versionId = await store.getState().ensureCurrentVersion(item.id);

    expect(versionId).toBeTruthy();
    expect((await repo.getItem(item.id)).currentVersionId).toBe(versionId);
    await expect(store.getState().createAnnotation({
      itemId: item.id,
      versionId,
      kind: "comment",
      target: { locatorType: "pdf-page", locator: { page: 1 } },
      style: {},
      body: { text: "Migrated note" },
    })).resolves.toMatchObject({ itemId: item.id, versionId });
  });
});
