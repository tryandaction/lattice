/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createTab } from "@/lib/layout-utils";
import { loadWorkbenchSession, saveWorkbenchSession } from "@/lib/layout-persistence";

class FakeFileHandle {
  kind = "file" as const;

  constructor(public name: string) {}
}

class FakeDirectoryHandle {
  kind = "directory" as const;
  private readonly directories = new Map<string, FakeDirectoryHandle>();
  private readonly files = new Map<string, FakeFileHandle>();

  constructor(public name: string) {}

  addDirectory(dir: FakeDirectoryHandle) {
    this.directories.set(dir.name, dir);
    return dir;
  }

  addFile(file: FakeFileHandle) {
    this.files.set(file.name, file);
    return file;
  }

  async *values(): AsyncGenerator<FakeDirectoryHandle | FakeFileHandle> {
    for (const dir of this.directories.values()) {
      yield dir;
    }
    for (const file of this.files.values()) {
      yield file;
    }
  }

  async getDirectoryHandle(name: string) {
    const existing = this.directories.get(name);
    if (!existing) {
      throw new DOMException(`Directory not found: ${name}`, "NotFoundError");
    }
    return existing;
  }

  async getFileHandle(name: string) {
    const existing = this.files.get(name);
    if (!existing) {
      throw new DOMException(`File not found: ${name}`, "NotFoundError");
    }
    return existing;
  }
}

describe("workbench session persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("restores a split workbench layout per workspace", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const docs = root.addDirectory(new FakeDirectoryHandle("docs"));
    const notesHandle = root.addFile(new FakeFileHandle("notes.md"));
    const readmeHandle = docs.addFile(new FakeFileHandle("readme.md"));

    const layout = {
      root: {
        type: "split" as const,
        id: "split-root",
        direction: "horizontal" as const,
        sizes: [48, 52],
        children: [
          {
            type: "pane" as const,
            id: "pane-left",
            tabs: [createTab(notesHandle as unknown as FileSystemFileHandle, "workspace/notes.md")],
            activeTabIndex: 0,
          },
          {
            type: "pane" as const,
            id: "pane-right",
            tabs: [createTab(readmeHandle as unknown as FileSystemFileHandle, "workspace/docs/readme.md")],
            activeTabIndex: 0,
          },
        ],
      },
      activePaneId: "pane-right",
    };

    await saveWorkbenchSession("workspace", layout, true);
    const restored = await loadWorkbenchSession("workspace", root as unknown as FileSystemDirectoryHandle);

    expect(restored?.sidebarCollapsed).toBe(true);
    expect(restored?.layout.activePaneId).toBe("pane-right");
    expect(restored?.layout.root.type).toBe("split");
    if (restored?.layout.root.type !== "split") {
      throw new Error("Expected split layout");
    }
    expect(restored.layout.root.children[0].id).toBe("pane-left");
    expect(restored.layout.root.children[1].id).toBe("pane-right");
    if (restored.layout.root.children[0].type !== "pane" || restored.layout.root.children[1].type !== "pane") {
      throw new Error("Expected pane children");
    }
    expect(restored.layout.root.children[0].tabs[0]?.filePath).toBe("workspace/notes.md");
    expect(restored.layout.root.children[1].tabs[0]?.filePath).toBe("workspace/docs/readme.md");
  });

  it("filters missing files when restoring a saved session", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const notesHandle = root.addFile(new FakeFileHandle("notes.md"));

    const layout = {
      root: {
        type: "pane" as const,
        id: "pane-main",
        tabs: [
          createTab(notesHandle as unknown as FileSystemFileHandle, "workspace/notes.md"),
          {
            ...createTab(notesHandle as unknown as FileSystemFileHandle, "workspace/notes.md"),
            filePath: "workspace/missing.md",
            fileName: "missing.md",
          },
        ],
        activeTabIndex: 1,
      },
      activePaneId: "pane-main",
    };

    await saveWorkbenchSession("workspace", layout, false);
    const restored = await loadWorkbenchSession("workspace", root as unknown as FileSystemDirectoryHandle);

    expect(restored?.layout.root.type).toBe("pane");
    if (restored?.layout.root.type !== "pane") {
      throw new Error("Expected pane layout");
    }
    expect(restored.layout.root.tabs).toHaveLength(1);
    expect(restored.layout.root.tabs[0]?.filePath).toBe("workspace/notes.md");
    expect(restored.layout.root.activeTabIndex).toBe(0);
  });
});
