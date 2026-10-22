import { describe, expect, it } from "vitest";
import {
  classifyVSCodeExtensionCapability,
  getVSCodeActivityEntries,
  getRunnableVSCodeCommands,
  getRunnableVSCodeExtensions,
  normalizeVSCodeExtensionInventory,
  shouldRepairVSCodeExtensionImport,
} from "../extensions";
import type { VSCodeExtensionInventoryEntry } from "../types";

describe("vscode compat extensions", () => {
  it("classifies extension capabilities without promoting metadata-only inventory", () => {
    const runnable = {
      id: "publisher.runtime",
      source: "installed" as const,
      path: "C:/Users/test/.vscode/extensions/publisher.runtime-1.0.0",
      main: "./extension.js",
    };

    expect(classifyVSCodeExtensionCapability(runnable)).toMatchObject({
      primary: "runnable",
      runnable: true,
      commandCapable: false,
    });
    expect(classifyVSCodeExtensionCapability({
      ...runnable,
      contributes: {
        languages: [], snippets: [], commands: 1,
        commandItems: [{ command: "publisher.run", title: "Run" }], debuggers: 0, configuration: false,
        views: [], viewContainers: [], menus: 0, notebooks: [], notebookRenderers: [], grammars: [], themes: [],
      },
    })).toMatchObject({ primary: "command-capable", commandCapable: true });
    expect(classifyVSCodeExtensionCapability({
      ...runnable,
      contributes: {
        languages: [], snippets: [], commands: 0, commandItems: [], debuggers: 0, configuration: false,
        views: [{ container: "publisher", id: "publisher.view", name: "Publisher" }], viewContainers: ["publisher"], menus: 0,
        notebooks: [], notebookRenderers: [], grammars: [], themes: [],
      },
    })).toMatchObject({ primary: "view-capable", viewCapable: true });
    expect(classifyVSCodeExtensionCapability({
      id: "publisher.theme",
      source: "installed",
      contributes: {
        languages: [], snippets: [], commands: 0, commandItems: [], debuggers: 0, configuration: false,
        views: [], viewContainers: [], menus: 0, notebooks: [], notebookRenderers: [], grammars: [], themes: [{ id: "publisher.theme", label: "Theme", uiTheme: "vs-dark", path: "theme.json" }],
      },
    })).toMatchObject({ primary: "grammar-theme-only", grammarThemeOnly: true });
    expect(classifyVSCodeExtensionCapability({ id: "publisher.inventory", source: "installed" })).toMatchObject({
      primary: "inventory-only",
      inventoryOnly: true,
    });
  });

  it("prioritizes runnable extensions with actionable contributions", () => {
    const extensions: VSCodeExtensionInventoryEntry[] = [
      {
        id: "publisher.inventory-only",
        source: "installed",
        displayName: "Inventory Only",
      },
      {
        id: "publisher.views-first",
        source: "installed",
        displayName: "Views First",
        path: "C:/Users/test/.vscode/extensions/publisher.views-first-1.0.0",
        main: "./dist/extension.js",
        contributes: {
          languages: [],
          snippets: [],
          commands: 1,
          commandItems: [{ command: "views-first.open", title: "Open Views First" }],
          debuggers: 0,
          configuration: false,
          views: [{ container: "explorer", id: "views-first.panel", name: "Views First" }],
          viewContainers: [],
          menus: 0,
          notebooks: [],
          notebookRenderers: [],
          grammars: [],
          themes: [],
        },
      },
      {
        id: "publisher.commands-second",
        source: "installed",
        displayName: "Commands Second",
        path: "C:/Users/test/.vscode/extensions/publisher.commands-second-1.0.0",
        main: "./extension.js",
        contributes: {
          languages: [],
          snippets: [],
          commands: 2,
          commandItems: [
            { command: "commands-second.run", title: "Run Commands Second" },
            { command: "commands-second.debug", title: "Debug Commands Second" },
          ],
          debuggers: 0,
          configuration: false,
          views: [],
          viewContainers: [],
          menus: 0,
          notebooks: [],
          notebookRenderers: [],
          grammars: [],
          themes: [],
        },
      },
    ];

    expect(getRunnableVSCodeExtensions(extensions).map((entry) => entry.id)).toEqual([
      "publisher.views-first",
      "publisher.commands-second",
    ]);
    expect(getRunnableVSCodeCommands(extensions).map((entry) => entry.id)).toEqual([
      "commands-second.debug",
      "commands-second.run",
      "views-first.open",
    ]);
  });

  it("marks legacy imports for repair when installed extensions are missing absolute paths or runnable metadata", () => {
    expect(shouldRepairVSCodeExtensionImport([
      {
        id: "publisher.legacy",
        source: "installed",
        path: "publisher.legacy-1.0.0",
        main: "./extension.js",
      },
    ])).toBe(true);

    expect(shouldRepairVSCodeExtensionImport([
      {
        id: "publisher.modern",
        source: "installed",
        path: "C:/Users/test/.vscode/extensions/publisher.modern-1.0.0",
        main: "./extension.js",
      },
    ])).toBe(false);
  });

  it("marks bulk runnable imports for repair when every extension is missing manifest contributions", () => {
    const staleCache: VSCodeExtensionInventoryEntry[] = Array.from({ length: 8 }, (_, index) => ({
      id: `publisher.extension-${index}`,
      source: "installed",
      path: `C:/Users/test/.vscode/extensions/publisher.extension-${index}-1.0.0`,
      main: "./extension.js",
      displayName: `Extension ${index}`,
    }));

    expect(shouldRepairVSCodeExtensionImport(staleCache)).toBe(true);
  });

  it("keeps AI coding agent extensions ahead of generic extension noise", () => {
    const extensions: VSCodeExtensionInventoryEntry[] = [
      {
        id: "publisher.generic",
        source: "installed",
        displayName: "Generic Tooling",
        path: "C:/Users/test/.vscode/extensions/publisher.generic-1.0.0",
        main: "./extension.js",
        contributes: {
          languages: [],
          snippets: [],
          commands: 4,
          commandItems: [
            { command: "generic.one", title: "Generic One" },
            { command: "generic.two", title: "Generic Two" },
            { command: "generic.three", title: "Generic Three" },
            { command: "generic.four", title: "Generic Four" },
          ],
          debuggers: 0,
          configuration: false,
          views: [{ container: "generic", id: "generic.view", name: "Generic" }],
          viewContainers: ["generic"],
          viewContainerItems: [{ id: "generic", title: "Generic", location: "activitybar" }],
          menus: 0,
          notebooks: [],
          notebookRenderers: [],
          grammars: [],
          themes: [],
        },
      },
      {
        id: "openai.chatgpt",
        source: "installed",
        displayName: "Codex - OpenAI's coding agent",
        path: "C:/Users/test/.vscode/extensions/openai.chatgpt-1.0.0",
        main: "./extension.js",
        contributes: {
          languages: [],
          snippets: [],
          commands: 1,
          commandItems: [{ command: "chatgpt.open", title: "Open Codex" }],
          debuggers: 0,
          configuration: false,
          views: [{ container: "chatgpt", id: "chatgpt.view", name: "Codex" }],
          viewContainers: ["chatgpt"],
          viewContainerItems: [{ id: "chatgpt", title: "Codex", location: "activitybar" }],
          menus: 0,
          notebooks: [],
          notebookRenderers: [],
          grammars: [],
          themes: [],
        },
      },
    ];

    expect(getVSCodeActivityEntries(extensions).map((entry) => entry.extensionId)[0]).toBe("openai.chatgpt");
  });

  it("keeps the highest installed version when an extension has multiple directories", () => {
    const normalized = normalizeVSCodeExtensionInventory([
      {
        id: "openai.chatgpt",
        source: "installed",
        version: "26.715.61943",
        path: "C:/Users/test/.vscode/extensions/openai.chatgpt-26.715.61943-win32-x64",
        main: "./out/extension.js",
      },
      {
        id: "openai.chatgpt",
        source: "installed",
        version: "26.715.31925",
        path: "C:/Users/test/.vscode/extensions/openai.chatgpt-26.715.31925-win32-x64",
        main: "./out/extension.js",
      },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.version).toBe("26.715.61943");
    expect(normalized[0]?.path).toContain("26.715.61943");
  });

  it("resolves persisted relative extension icons against the installed extension path", () => {
    const normalized = normalizeVSCodeExtensionInventory([{
      id: "openai.chatgpt",
      source: "installed",
      path: "C:/Users/test/.vscode/extensions/openai.chatgpt-1.0.0",
      main: "./out/extension.js",
      icon: "resources/blossom.dark.png",
      contributes: {
        languages: [], snippets: [], commands: 0, commandItems: [], debuggers: 0, configuration: false,
        views: [{ container: "codex", id: "codex.view", name: "Codex" }],
        viewContainers: ["codex"],
        viewContainerItems: [{ id: "codex", title: "Codex", location: "activitybar", icon: "resources/blossom-white.svg" }],
        menus: 0, notebooks: [], notebookRenderers: [], grammars: [], themes: [],
      },
    }]);

    expect(normalized[0]?.icon).toBe("C:/Users/test/.vscode/extensions/openai.chatgpt-1.0.0/resources/blossom.dark.png");
    expect(normalized[0]?.contributes?.viewContainerItems?.[0]?.icon).toBe(
      "C:/Users/test/.vscode/extensions/openai.chatgpt-1.0.0/resources/blossom-white.svg",
    );
  });
});
