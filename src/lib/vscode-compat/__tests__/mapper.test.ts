import { describe, expect, it } from "vitest";
import { importVSCodeSettingsFile, makeKeymapIndex } from "../mapper";

describe("vscode compat mapper", () => {
  it("imports editor, files, snippets, tasks, and keybindings", () => {
    const result = importVSCodeSettingsFile({
      settings: {
        "editor.tabSize": 4,
        "editor.insertSpaces": false,
        "editor.wordWrap": "bounded",
        "editor.lineNumbers": "relative",
        "editor.formatOnSave": true,
        "editor.minimap.enabled": false,
        "files.exclude": {
          "**/dist": true,
        },
        "search.exclude": {
          "**/build": true,
        },
        "files.associations": {
          "*.spec": "typescript",
        },
        "editor.defaultFormatter": "prettier",
        "workbench.colorTheme": "GitHub Dark Default",
      },
      keybindings: [
        { key: "ctrl+k ctrl+s", command: "workbench.action.showAllCommands" },
      ],
      snippets: {
        typescript: {
          hello: {
            prefix: ["log"],
            body: ["console.log($1);"],
            description: "Log output",
          },
        },
      },
      tasks: {
        version: "2.0.0",
        tasks: [
          {
            label: "build",
            type: "shell",
            command: "npm",
            args: ["run", "build"],
            options: {
              cwd: ".",
            },
          },
        ],
      },
      launch: {
        version: "0.2.0",
        configurations: [
          {
            name: "Launch API",
            type: "node",
            request: "launch",
            program: "${workspaceFolder}/src/index.js",
            args: ["--watch"],
          },
        ],
      },
    });

    expect(result.settings.tabSize).toBe(4);
    expect(result.settings.insertSpaces).toBe(false);
    expect(result.settings.wordWrap).toBe("bounded");
    expect(result.settings.lineNumbers).toBe("relative");
    expect(result.settings.minimapEnabled).toBe(false);
    expect(result.settings.filesExclude["**/dist"]).toBe(true);
    expect(result.settings.searchExclude["**/build"]).toBe(true);
    expect(result.settings.filesAssociations["*.spec"]).toBe("typescript");
    expect(result.keybindings).toHaveLength(1);
    expect(result.settings.colorTheme).toBe("GitHub Dark Default");
    expect(result.keymap["ctrl+k ctrl+s"]).toBe("workbench.action.showAllCommands");
    expect(result.snippets).toHaveLength(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.launches).toEqual([
      expect.objectContaining({
        name: "Launch API",
        type: "node",
        request: "launch",
        program: "${workspaceFolder}/src/index.js",
        args: ["--watch"],
      }),
    ]);
    expect(result.warnings[0]).toContain("formatter routing");
  });

  it("builds a stable keymap index", () => {
    expect(makeKeymapIndex([
      { key: "ctrl+shift+p", command: "workbench.action.showCommands" },
    ])).toEqual({
      "ctrl+shift+p": "workbench.action.showCommands",
    });
  });

  it("preserves allowlisted Python debug launch options", () => {
    const result = importVSCodeSettingsFile({
      launch: {
        version: "0.2.0",
        configurations: [{
          name: "Debug current Python file",
          type: "debugpy",
          request: "launch",
          program: "${file}",
          cwd: "${fileDirname}",
          args: ["--mode", "test"],
          env: { LATTICE_DEBUG: "1" },
          python: "C:/Python313/python.exe",
          justMyCode: false,
          stopOnEntry: true,
          subProcess: false,
        }],
      },
    });

    expect(result.launches).toEqual([{
      name: "Debug current Python file",
      type: "debugpy",
      request: "launch",
      program: "${file}",
      cwd: "${fileDirname}",
      args: ["--mode", "test"],
      env: { LATTICE_DEBUG: "1" },
      python: "C:/Python313/python.exe",
      justMyCode: false,
      stopOnEntry: true,
      subProcess: false,
    }]);
  });

  it("preserves allowlisted Node js-debug launch options", () => {
    const result = importVSCodeSettingsFile({
      launch: {
        version: "0.2.0",
        configurations: [{
          name: "Debug current Node file",
          type: "pwa-node",
          request: "launch",
          program: "${file}",
          cwd: "${workspaceFolder}",
          runtimeExecutable: "node",
          runtimeArgs: ["--enable-source-maps"],
          args: ["--mode", "test"],
          env: { NODE_ENV: "development" },
          console: "internalConsole",
          stopOnEntry: true,
          sourceMaps: true,
          smartStep: true,
          skipFiles: ["<node_internals>/**"],
          outFiles: ["${workspaceFolder}/dist/**/*.js"],
        }],
      },
    });

    expect(result.launches).toEqual([{
      name: "Debug current Node file",
      type: "pwa-node",
      request: "launch",
      program: "${file}",
      cwd: "${workspaceFolder}",
      runtimeExecutable: "node",
      runtimeArgs: ["--enable-source-maps"],
      args: ["--mode", "test"],
      env: { NODE_ENV: "development" },
      console: "internalConsole",
      stopOnEntry: true,
      sourceMaps: true,
      smartStep: true,
      skipFiles: ["<node_internals>/**"],
      outFiles: ["${workspaceFolder}/dist/**/*.js"],
    }]);
  });

  it("preserves extension contribution metadata in the workbench import", () => {
    const result = importVSCodeSettingsFile({
      extensions: [
        {
          id: "vue.volar",
          source: "installed",
          displayName: "Vue - Official",
          contributes: {
            languages: [
              { id: "vue", aliases: ["Vue"], extensions: [".vue"], filenames: [] },
            ],
            snippets: [
              { language: "vue", path: "./snippets/vue.json" },
            ],
            commands: 1,
            commandItems: [
              { command: "volar.restartServer", title: "Restart Vue Server" },
            ],
            debuggers: 0,
            configuration: true,
            views: [
              { container: "explorer", id: "volar.projects", name: "Vue Projects" },
            ],
            viewContainers: [],
            menus: 1,
            notebooks: [],
            notebookRenderers: [],
            grammars: [
              { language: "vue", scopeName: "source.vue", path: "./syntaxes/vue.tmLanguage.json" },
            ],
            themes: [
              { label: "Vue Dark", uiTheme: "vs-dark", path: "./themes/vue-dark.json" },
            ],
          },
        },
      ],
    });

    expect(result.extensions[0]).toMatchObject({
      id: "vue.volar",
      displayName: "Vue - Official",
      contributes: {
        languages: [
          { id: "vue", aliases: ["Vue"], extensions: [".vue"], filenames: [] },
        ],
        snippets: [
          { language: "vue", path: "./snippets/vue.json" },
        ],
        commands: 1,
        commandItems: [
          { command: "volar.restartServer", title: "Restart Vue Server" },
        ],
        configuration: true,
        views: [
          { container: "explorer", id: "volar.projects", name: "Vue Projects" },
        ],
        grammars: [
          { language: "vue", scopeName: "source.vue", path: "./syntaxes/vue.tmLanguage.json" },
        ],
        themes: [
          { label: "Vue Dark", uiTheme: "vs-dark", path: "./themes/vue-dark.json" },
        ],
      },
    });
  });
});
