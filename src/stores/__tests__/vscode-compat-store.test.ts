import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";

describe("vscode compat store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("normalizes persisted extension inventory and drops invalid legacy entries", async () => {
    localStorage.setItem("lattice-vscode-compat-workbench", JSON.stringify({
      settings: {},
      keybindings: [],
      snippets: [],
      tasks: [],
      launches: [],
      extensions: [
        {
          id: "publisher.good",
          source: "installed",
          path: "C:/Users/test/.vscode/extensions/publisher.good-1.0.0",
          main: "./extension.js",
          contributes: {
            commands: 1,
            commandItems: [{ command: "publisher.good.run", title: "Run Good" }],
          },
        },
        {
          id: "publisher.bad",
          source: "installed",
          path: "publisher.bad-1.0.0",
        },
        {
          id: " ",
          source: "installed",
        },
      ],
      importedAt: 1,
      sourceLabel: "VS Code",
      warnings: [],
    }));

    await useVSCodeCompatStore.getState().load();

    expect(useVSCodeCompatStore.getState().extensions).toEqual([
      expect.objectContaining({
        id: "publisher.good",
        path: "C:/Users/test/.vscode/extensions/publisher.good-1.0.0",
        main: "./extension.js",
      }),
    ]);
  });
});
