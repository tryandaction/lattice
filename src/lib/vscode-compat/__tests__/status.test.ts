import { describe, expect, it } from "vitest";
import { createDefaultVSCodeWorkbenchSettings } from "../mapper";
import { summarizeVSCodeCompat } from "../status";

describe("vscode compat status", () => {
  it("summarizes imported VS Code settings and extension capabilities", () => {
    const summary = summarizeVSCodeCompat({
      settings: {
        ...createDefaultVSCodeWorkbenchSettings(),
        colorTheme: "GitHub Dark Default",
        filesAssociations: {
          "*.vue": "vue",
        },
        filesExclude: {
          "**/dist": true,
        },
      },
      keybindings: [
        { key: "ctrl+b", command: "workbench.action.toggleSidebarVisibility" },
      ],
      snippets: [
        { name: "log", prefix: ["log"], body: "console.log($1)" },
      ],
      tasks: [
        { label: "build", type: "shell", command: "npm", args: ["run", "build"] },
      ],
      launches: [
        { name: "Launch API", type: "node", request: "launch", args: [] },
      ],
      extensions: [
        {
          id: "ms-python.python",
          source: "installed",
          displayName: "Python",
          contributes: {
            languages: [
              { id: "python", aliases: ["Python"], extensions: [".py"], filenames: [] },
            ],
            snippets: [
              { language: "python", path: "./snippets/python.json" },
            ],
            commands: 2,
            commandItems: [
              { command: "python.execInTerminal", title: "Run Python File", category: "Python" },
              { command: "python.createTerminal", title: "Create Python Terminal", category: "Python" },
            ],
            debuggers: 1,
            configuration: true,
            views: [
              { container: "explorer", id: "pythonEnvironments", name: "Python Environments" },
            ],
            viewContainers: [],
            menus: 3,
            notebooks: ["jupyter-notebook"],
            notebookRenderers: ["ms-python.python-renderer"],
            grammars: [
              { language: "python", scopeName: "source.python", path: "./syntaxes/MagicPython.tmLanguage.json" },
            ],
            themes: [
              { label: "GitHub Dark Default", uiTheme: "vs-dark", path: "./themes/github-dark.json" },
            ],
          },
        },
        { id: "unknown.extension", source: "installed", displayName: "Unknown Extension" },
      ],
      importedAt: 1,
      sourceLabel: "VS Code",
      warnings: [],
    });

    expect(summary.isImported).toBe(true);
    expect(summary.counts).toMatchObject({
      keybindings: 1,
      snippets: 1,
      tasks: 1,
      launches: 1,
      extensions: 2,
      fileAssociations: 1,
      excludes: 1,
      extensionLanguages: 1,
      extensionSnippets: 1,
      extensionCommands: 2,
      extensionDebuggers: 1,
      extensionViews: 1,
      extensionMenus: 3,
      extensionNotebooks: 1,
      extensionNotebookRenderers: 1,
      extensionGrammars: 1,
      extensionThemes: 1,
    });
    expect(summary.theme).toEqual({
      current: "GitHub Dark Default",
      contributed: [
        {
          extensionId: "ms-python.python",
          extensionLabel: "Python",
          label: "GitHub Dark Default",
          uiTheme: "vs-dark",
          path: "./themes/github-dark.json",
        },
      ],
    });
    expect(summary.capabilities[0]).toMatchObject({
      id: "ms-python.python",
      label: "Python",
      status: "mapped",
    });
    expect(summary.capabilities[1]).toMatchObject({
      label: "Unknown Extension",
      status: "external",
    });
  });
});
