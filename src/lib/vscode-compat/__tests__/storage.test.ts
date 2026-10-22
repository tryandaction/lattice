import { describe, expect, it } from "vitest";
import {
  mergeVSCodeSettingsFiles,
  parseVSCodeSettingsJsonText,
  readVSCodeConfigFromDirectory,
  readVSCodeExtensionConfigFromDirectory,
  readVSCodeExtensionsFromDirectory,
} from "../storage";

class MemoryFileHandle {
  readonly kind = "file" as const;

  constructor(
    readonly name: string,
    private readonly content: string,
  ) {}

  async getFile(): Promise<File> {
    return new File([this.content], this.name, { type: "application/json" });
  }
}

class MemoryDirectoryHandle {
  readonly kind = "directory" as const;
  private readonly files = new Map<string, MemoryFileHandle>();
  private readonly directories = new Map<string, MemoryDirectoryHandle>();

  constructor(readonly name: string) {}

  addFile(name: string, content: string): this {
    this.files.set(name, new MemoryFileHandle(name, content));
    return this;
  }

  addDirectory(directory: MemoryDirectoryHandle): this {
    this.directories.set(directory.name, directory);
    return this;
  }

  async getFileHandle(name: string): Promise<FileSystemFileHandle> {
    const file = this.files.get(name);
    if (!file) {
      throw new DOMException(`File not found: ${name}`, "NotFoundError");
    }
    return file as unknown as FileSystemFileHandle;
  }

  async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
    const directory = this.directories.get(name);
    if (!directory) {
      throw new DOMException(`Directory not found: ${name}`, "NotFoundError");
    }
    return directory as unknown as FileSystemDirectoryHandle;
  }

  async *values(): AsyncIterableIterator<FileSystemHandle> {
    for (const directory of this.directories.values()) {
      yield directory as unknown as FileSystemDirectoryHandle;
    }
    for (const file of this.files.values()) {
      yield file as unknown as FileSystemFileHandle;
    }
  }
}

class DesktopLikeDirectoryHandle extends MemoryDirectoryHandle {
  readonly __latticeDesktopHandle = true as const;

  constructor(name: string, readonly fullPath: string) {
    super(name);
  }
}

describe("vscode compat storage", () => {
  it("parses regular VS Code settings.json with comments and trailing commas", async () => {
    const parsed = await parseVSCodeSettingsJsonText(`{
      // common VS Code JSONC shape
      "editor.tabSize": 2,
      "files.exclude": {
        "**/dist": true,
      },
    }`);

    expect(parsed.settings?.["editor.tabSize"]).toBe(2);
    expect(parsed.settings?.["files.exclude"]).toEqual({ "**/dist": true });
  });

  it("discovers settings, keybindings, snippets, and tasks from a selected project folder", async () => {
    const vscode = new MemoryDirectoryHandle(".vscode")
      .addFile("settings.json", JSON.stringify({
        "editor.tabSize": 4,
        "files.associations": {
          "*.vue": "html",
        },
      }))
      .addFile("tasks.json", JSON.stringify({
        version: "2.0.0",
        tasks: [
          {
            label: "Build",
            type: "shell",
            command: "npm run build",
          },
        ],
      }))
      .addFile("launch.json", JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            name: "Launch API",
            type: "node",
            request: "launch",
            program: "${workspaceFolder}/src/index.js",
          },
        ],
      }))
      .addFile("extensions.json", JSON.stringify({
        recommendations: [
          "dbaeumer.vscode-eslint",
          "esbenp.prettier-vscode",
        ],
      }));
    const snippets = new MemoryDirectoryHandle("snippets")
      .addFile("javascript.json", JSON.stringify({
        Log: {
          prefix: "log",
          body: "console.log($1)",
        },
      }));
    const user = new MemoryDirectoryHandle("User")
      .addFile("keybindings.json", JSON.stringify([
        {
          key: "ctrl+b",
          command: "workbench.action.toggleSidebarVisibility",
        },
      ]))
      .addDirectory(snippets);
    const root = new MemoryDirectoryHandle("project")
      .addDirectory(vscode)
      .addDirectory(user);

    const result = await readVSCodeConfigFromDirectory(root as unknown as FileSystemDirectoryHandle);

    expect(result.discoveredFiles).toContain(".vscode/settings.json");
    expect(result.discoveredFiles).toContain(".vscode/tasks.json");
    expect(result.discoveredFiles).toContain(".vscode/launch.json");
    expect(result.discoveredFiles).toContain(".vscode/extensions.json");
    expect(result.discoveredFiles).toContain("User/keybindings.json");
    expect(result.discoveredFiles).toContain("User/snippets/*.json");
    expect(result.config.settings?.["editor.tabSize"]).toBe(4);
    expect(result.config.settings?.["files.associations"]).toEqual({ "*.vue": "html" });
    expect(result.config.keybindings).toHaveLength(1);
    expect(result.config.tasks?.tasks).toHaveLength(1);
    expect(result.config.launch?.configurations).toHaveLength(1);
    expect(result.config.extensions).toEqual([
      { id: "dbaeumer.vscode-eslint", source: "recommended" },
      { id: "esbenp.prettier-vscode", source: "recommended" },
    ]);
    expect(result.config.snippets?.["User:Log"]).toEqual({
      prefix: "log",
      body: "console.log($1)",
    });
  });

  it("imports when the selected folder is the .vscode folder itself", async () => {
    const vscode = new MemoryDirectoryHandle(".vscode")
      .addFile("settings.json", JSON.stringify({
        "editor.wordWrap": "on",
      }));

    const result = await readVSCodeConfigFromDirectory(vscode as unknown as FileSystemDirectoryHandle);

    expect(result.discoveredFiles).toEqual([".vscode/settings.json"]);
    expect(result.config.settings?.["editor.wordWrap"]).toBe("on");
  });

  it("reads installed extensions from a VS Code extensions directory", async () => {
    const extensions = new MemoryDirectoryHandle("extensions")
      .addDirectory(new MemoryDirectoryHandle("ms-python.python-2026.1.0").addFile("package.json", JSON.stringify({
        publisher: "ms-python",
        name: "python",
        displayName: "Python",
        version: "2026.1.0",
        categories: ["Programming Languages"],
        main: "./out/client/extension",
        browser: "./dist/web/extension",
        activationEvents: ["onCommand:python.execInTerminal"],
        extensionKind: ["workspace"],
        engines: { vscode: "^1.90.0" },
      })))
      .addDirectory(new MemoryDirectoryHandle("Vue.volar-3.0.0").addFile("package.json", JSON.stringify({
        publisher: "Vue",
        name: "volar",
      })));

    const result = await readVSCodeExtensionsFromDirectory(extensions as unknown as FileSystemDirectoryHandle);

    expect(result).toEqual([
      {
        id: "ms-python.python",
        source: "installed",
        path: "ms-python.python-2026.1.0",
        displayName: "Python",
        version: "2026.1.0",
        categories: ["Programming Languages"],
        main: "./out/client/extension",
        browser: "./dist/web/extension",
        activationEvents: ["onCommand:python.execInTerminal"],
        extensionKind: ["workspace"],
        engines: { vscode: "^1.90.0" },
      },
      { id: "vue.volar", source: "installed", path: "Vue.volar-3.0.0" },
    ]);
  });

  it("imports VS Code extension language and snippet contributions", async () => {
    const vueSnippets = new MemoryDirectoryHandle("snippets")
      .addFile("vue.json", JSON.stringify({
        "Vue setup": {
          prefix: "vsetup",
          body: ["<script setup>", "$1", "</script>"],
        },
      }));
    const volar = new MemoryDirectoryHandle("Vue.volar-3.0.0")
      .addFile("package.json", JSON.stringify({
        publisher: "Vue",
        name: "volar",
        displayName: "Vue - Official",
        main: "./dist/node/extension.js",
        browser: "./dist/web/extension.js",
        activationEvents: ["onCommand:volar.restartServer"],
        extensionKind: ["workspace"],
        contributes: {
          languages: [
            {
              id: "vue",
              aliases: ["Vue"],
              extensions: [".vue"],
              filenames: ["vue.config.js"],
            },
          ],
          snippets: [
            {
              language: "vue",
              path: "./snippets/vue.json",
            },
          ],
          commands: [
            { command: "volar.restartServer", title: "Restart Vue Server" },
          ],
          views: {
            explorer: [
              { id: "volar.projects", name: "Vue Projects" },
            ],
          },
          menus: {
            "editor/title": [
              { command: "volar.restartServer" },
            ],
          },
          notebooks: [
            { type: "vue-notebook", displayName: "Vue Notebook" },
          ],
          notebookRenderer: [
            { id: "volar.renderer", displayName: "Vue Renderer" },
          ],
          grammars: [
            { language: "vue", scopeName: "source.vue", path: "./syntaxes/vue.tmLanguage.json" },
          ],
          themes: [
            { label: "Vue Dark", uiTheme: "vs-dark", path: "./themes/vue-dark.json" },
          ],
        },
      }))
      .addDirectory(vueSnippets);
    const extensions = new MemoryDirectoryHandle("extensions").addDirectory(volar);

    const result = await readVSCodeExtensionConfigFromDirectory(extensions as unknown as FileSystemDirectoryHandle);

    expect(result.settings?.["files.associations"]).toEqual({
      "*.vue": "vue",
      "vue.config.js": "vue",
    });
    expect(result.snippets?.["vue.volar:vue"]).toEqual({
      "Vue setup": {
        prefix: "vsetup",
        body: ["<script setup>", "$1", "</script>"],
      },
    });
    expect(result.extensions?.[0]).toMatchObject({
      id: "vue.volar",
      source: "installed",
      displayName: "Vue - Official",
      contributes: {
        languages: [
          {
            id: "vue",
            aliases: ["Vue"],
            extensions: [".vue"],
            filenames: ["vue.config.js"],
          },
        ],
        snippets: [
          {
            language: "vue",
            path: "./snippets/vue.json",
          },
        ],
        commands: 1,
        commandItems: [
          { command: "volar.restartServer", title: "Restart Vue Server" },
        ],
        views: [
          { container: "explorer", id: "volar.projects", name: "Vue Projects" },
        ],
        menus: 1,
        notebooks: ["vue-notebook"],
        notebookRenderers: ["volar.renderer"],
        grammars: [
          { language: "vue", scopeName: "source.vue", path: "./syntaxes/vue.tmLanguage.json" },
        ],
        themes: [
          { label: "Vue Dark", uiTheme: "vs-dark", path: "./themes/vue-dark.json" },
        ],
      },
    });
  });

  it("resolves package.nls labels and extension icon assets from installed manifests", async () => {
    const agent = new MemoryDirectoryHandle("openai.chatgpt-1.0.0")
      .addFile("package.nls.json", JSON.stringify({
        "extension.displayName": "Codex - OpenAI coding agent",
        "command.open.title": "Open Codex",
        "view.container.title": "Codex",
        "view.chat.name": "Codex Chat",
      }))
      .addFile("package.json", JSON.stringify({
        publisher: "openai",
        name: "chatgpt",
        displayName: "%extension.displayName%",
        icon: "media/icon.png",
        main: "./out/extension.js",
        contributes: {
          commands: [
            { command: "chatgpt.open", title: "%command.open.title%" },
          ],
          viewsContainers: {
            activitybar: [
              { id: "codex", title: "%view.container.title%", icon: "media/activity.svg" },
            ],
          },
          views: {
            codex: [
              { id: "codex.chat", name: "%view.chat.name%" },
            ],
          },
        },
      }));
    const extensions = new MemoryDirectoryHandle("extensions").addDirectory(agent);

    const result = await readVSCodeExtensionConfigFromDirectory(extensions as unknown as FileSystemDirectoryHandle);

    expect(result.extensions?.[0]).toMatchObject({
      id: "openai.chatgpt",
      displayName: "Codex - OpenAI coding agent",
      icon: "openai.chatgpt-1.0.0/media/icon.png",
      contributes: {
        commandItems: [{ command: "chatgpt.open", title: "Open Codex" }],
        viewContainerItems: [{ id: "codex", title: "Codex", icon: "openai.chatgpt-1.0.0/media/activity.svg" }],
        views: [{ container: "codex", id: "codex.chat", name: "Codex Chat" }],
      },
    });
  });

  it("preserves normalized command and view contributions when profile results are merged", async () => {
    const agent = new MemoryDirectoryHandle("openai.chatgpt-1.0.0")
      .addFile("package.json", JSON.stringify({
        publisher: "openai",
        name: "chatgpt",
        main: "./out/extension.js",
        contributes: {
          commands: [{ command: "chatgpt.open", title: "Open Codex" }],
          viewsContainers: {
            activitybar: [{ id: "codex", title: "Codex" }],
          },
          views: {
            codex: [{ id: "codex.chat", name: "Codex Chat" }],
          },
        },
      }));
    const extensions = new MemoryDirectoryHandle("extensions").addDirectory(agent);
    const discovered = await readVSCodeExtensionConfigFromDirectory(
      extensions as unknown as FileSystemDirectoryHandle,
    );

    const merged = mergeVSCodeSettingsFiles({}, discovered);

    expect(merged.extensions?.[0]?.contributes).toMatchObject({
      commandItems: [{ command: "chatgpt.open", title: "Open Codex" }],
      viewContainerItems: [{ id: "codex", title: "Codex", location: "activitybar" }],
      views: [{ container: "codex", id: "codex.chat", name: "Codex Chat" }],
    });
  });

  it("keeps desktop auto-discovered extension paths absolute for the extension host", async () => {
    const extension = new DesktopLikeDirectoryHandle(
      "openai.chatgpt-1.0.0",
      "C:/Users/test/.vscode/extensions/openai.chatgpt-1.0.0",
    )
      .addFile("package.json", JSON.stringify({
        publisher: "openai",
        name: "chatgpt",
        displayName: "Codex",
        icon: "resources/blossom.dark.png",
        main: "./out/extension.js",
        contributes: {
          commands: [
            { command: "chatgpt.open", title: "Open Codex" },
          ],
          viewsContainers: {
            activitybar: [
              { id: "codex", title: "Codex", icon: "resources/activity.svg" },
            ],
          },
          views: {
            codex: [
              { id: "codex.chat", name: "Codex Chat" },
            ],
          },
        },
      }));
    const extensions = new DesktopLikeDirectoryHandle("extensions", "C:/Users/test/.vscode/extensions")
      .addDirectory(extension);

    const result = await readVSCodeExtensionConfigFromDirectory(extensions as unknown as FileSystemDirectoryHandle);

    expect(result.extensions?.[0]).toMatchObject({
      id: "openai.chatgpt",
      path: "C:/Users/test/.vscode/extensions/openai.chatgpt-1.0.0",
      icon: "C:/Users/test/.vscode/extensions/openai.chatgpt-1.0.0/resources/blossom.dark.png",
      main: "./out/extension.js",
      contributes: {
        commandItems: [{ command: "chatgpt.open", title: "Open Codex" }],
        viewContainerItems: [{
          id: "codex",
          title: "Codex",
          location: "activitybar",
          icon: "C:/Users/test/.vscode/extensions/openai.chatgpt-1.0.0/resources/activity.svg",
        }],
        views: [{ container: "codex", id: "codex.chat", name: "Codex Chat" }],
      },
    });
  });

  it("imports when the selected folder is the extensions folder itself", async () => {
    const extensions = new MemoryDirectoryHandle("extensions")
      .addDirectory(new MemoryDirectoryHandle("rust-lang.rust-analyzer-1.0.0").addFile("package.json", JSON.stringify({
        publisher: "rust-lang",
        name: "rust-analyzer",
        main: "./dist/node.js",
        activationEvents: ["onCommand:rust-analyzer.run"],
        contributes: {
          languages: [
            {
              id: "rust",
              extensions: [".rs"],
            },
          ],
        },
      })));

    const result = await readVSCodeConfigFromDirectory(extensions as unknown as FileSystemDirectoryHandle);

    expect(result.discoveredFiles).toEqual(["extensions/*/package.json", "extensions/*/contributes.languages"]);
    expect(result.config.settings?.["files.associations"]).toEqual({ "*.rs": "rust" });
    expect(result.config.extensions).toEqual([
      {
        id: "rust-lang.rust-analyzer",
        source: "installed",
        path: "rust-lang.rust-analyzer-1.0.0",
        main: "./dist/node.js",
        activationEvents: ["onCommand:rust-analyzer.run"],
        contributes: {
          languages: [
            {
              id: "rust",
              aliases: [],
              extensions: [".rs"],
              filenames: [],
            },
          ],
          snippets: [],
          commands: 0,
          commandItems: [],
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
    ]);
  });

  it("skips bad extension directories instead of inventing installed inventory entries", async () => {
    const extensions = new MemoryDirectoryHandle("extensions")
      .addDirectory(new MemoryDirectoryHandle("publisher.good-1.0.0").addFile("package.json", JSON.stringify({
        publisher: "publisher",
        name: "good",
        main: "./extension.js",
      })))
      .addDirectory(new MemoryDirectoryHandle("publisher.bad-1.0.0"))
      .addDirectory(new MemoryDirectoryHandle(".publisher-temp"))
      .addDirectory(new MemoryDirectoryHandle("not-an-extension"));

    const warnings: string[] = [];
    const result = await readVSCodeExtensionConfigFromDirectory(
      extensions as unknown as FileSystemDirectoryHandle,
      warnings,
    );

    expect(result.extensions).toEqual([
      {
        id: "publisher.good",
        source: "installed",
        path: "publisher.good-1.0.0",
        main: "./extension.js",
      },
    ]);
    expect(warnings.some((warning) => warning.includes("publisher.bad-1.0.0"))).toBe(true);
  });
});
