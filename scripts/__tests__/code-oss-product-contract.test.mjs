// @vitest-environment node

import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.resolve(relativePath), "utf8"));
}

describe("Lattice Code OSS product contract", () => {
  it("uses a distinct Lattice desktop identity", async () => {
    const product = await readJson("desktop/code-oss/product/product.json");

    expect(product).toMatchObject({
      nameShort: "Lattice",
      nameLong: "Lattice Scientific Workbench",
      applicationName: "lattice",
      dataFolderName: ".lattice-code",
      urlProtocol: "lattice",
      win32AppUserModelId: "Lattice.ScientificWorkbench",
    });
    expect(product.win32MutexName).not.toMatch(/code|vscode/i);
    expect(product.darwinBundleIdentifier).toBe("com.lattice.editor");
    expect(product.linuxIconName).toBe("lattice");
  });

  it("uses Open VSX without Microsoft product services", async () => {
    const product = await readJson("desktop/code-oss/product/product.json");
    const serialized = JSON.stringify(product);

    expect(product.extensionsGallery).toMatchObject({
      serviceUrl: "https://open-vsx.org/vscode/gallery",
      itemUrl: "https://open-vsx.org/vscode/item",
    });
    expect(serialized).not.toMatch(
      /Microsoft Visual Studio Code|marketplace\.visualstudio\.com/i,
    );
    expect(product).not.toHaveProperty("updateUrl");
    expect(product).not.toHaveProperty("commit");
  });

  it("registers the Lattice Workbench as a built-in extension", async () => {
    const builtIns = await readJson(
      "desktop/code-oss/product/builtInExtensions.json",
    );

    expect(builtIns).toEqual(["lattice.lattice-workbench"]);
  });

  it("contributes a permanent Lattice activity container and research view", async () => {
    const extension = await readJson(
      "desktop/code-oss/extensions/lattice-workbench/package.json",
    );

    expect(extension).toMatchObject({
      publisher: "lattice",
      name: "lattice-workbench",
      main: "./extension.js",
      engines: { vscode: "^1.128.0" },
      extensionKind: ["ui"],
    });
    expect(extension.contributes.viewsContainers.activitybar).toEqual([
      {
        id: "lattice",
        title: "Lattice",
        icon: "media/lattice-activity.svg",
      },
    ]);
    expect(
      extension.contributes.views.lattice.map((view) => view.id),
    ).toContain("lattice.research");
    expect(
      extension.contributes.commands.map((command) => command.command),
    ).toEqual(
      expect.arrayContaining([
        "lattice.openResearch",
        "lattice.importVSCodeProfile",
        "lattice.showMigrationStatus",
        "lattice.openExplorer",
        "lattice.openExtensions",
        "lattice.openTerminal",
        "lattice.openRunAndDebug",
      ]),
    );
  });

  it("registers working Workbench navigation commands and tool entries", async () => {
    const require = createRequire(import.meta.url);
    const extension = require(
      path.resolve(
        "desktop/code-oss/extensions/lattice-workbench/extension.js",
      ),
    );
    const handlers = new Map();
    const executed = [];
    const messages = [];
    const treeProviders = [];
    const context = { subscriptions: [] };
    class TreeItem {
      constructor(label, collapsibleState) {
        this.label = label;
        this.collapsibleState = collapsibleState;
      }
    }
    const vscode = {
      TreeItem,
      TreeItemCollapsibleState: { None: 0 },
      ThemeIcon: class ThemeIcon {
        constructor(id) {
          this.id = id;
        }
      },
      extensions: { all: [{ id: "publisher.demo" }] },
      workspace: { workspaceFolders: [{ name: "atom" }] },
      commands: {
        registerCommand(command, handler) {
          handlers.set(command, handler);
          return { dispose() {} };
        },
        async executeCommand(command) {
          executed.push(command);
        },
      },
      window: {
        registerTreeDataProvider(viewId, provider) {
          treeProviders.push({ viewId, provider });
          return { dispose() {} };
        },
        async showInformationMessage(message) {
          messages.push(message);
        },
      },
    };

    extension.activate(context, vscode, {
      importVSCodeExtensions: async () => ({ linked: 0, available: 1 }),
    });
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        "lattice.openResearch",
        "lattice.importVSCodeProfile",
        "lattice.showMigrationStatus",
        "lattice.openExplorer",
        "lattice.openExtensions",
        "lattice.openTerminal",
        "lattice.openRunAndDebug",
      ]),
    );
    await handlers.get("lattice.openResearch")();
    await handlers.get("lattice.openExplorer")();
    await handlers.get("lattice.openExtensions")();
    await handlers.get("lattice.openTerminal")();
    await handlers.get("lattice.openRunAndDebug")();
    await handlers.get("lattice.importVSCodeProfile")();
    await handlers.get("lattice.showMigrationStatus")();

    expect(executed).toEqual([
      "workbench.view.extension.lattice",
      "workbench.view.explorer",
      "workbench.view.extensions",
      "workbench.action.terminal.toggleTerminal",
      "workbench.view.debug",
      "workbench.view.extensions",
    ]);
    expect(messages).toHaveLength(2);
    expect(messages.join(" ")).toMatch(/1 VS Code extension/i);
    expect(messages.join(" ")).toMatch(/atom/i);
    expect(treeProviders).toHaveLength(1);
    expect(treeProviders[0].viewId).toBe("lattice.research");
    const children = await treeProviders[0].provider.getChildren();
    expect(children.map((item) => item.label)).toEqual([
      "Files",
      "Extensions",
      "Run and Debug",
      "Terminal",
      "Settings",
    ]);
    expect(children.map((item) => item.command.command)).toEqual([
      "lattice.openExplorer",
      "lattice.openExtensions",
      "lattice.openRunAndDebug",
      "lattice.openTerminal",
      "workbench.action.openSettings",
    ]);
    expect(context.subscriptions.length).toBeGreaterThanOrEqual(8);
  });

  it("discovers valid VS Code extensions and links only missing packages", async () => {
    const require = createRequire(import.meta.url);
    const extension = require(
      path.resolve("desktop/code-oss/extensions/lattice-workbench/extension.js"),
    );
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-profile-"));
    const sourceRoot = path.join(homeDir, ".vscode", "extensions");
    await fs.mkdir(path.join(sourceRoot, "publisher.good-1.0.0"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(sourceRoot, "publisher.good-1.0.0", "package.json"),
      "{}",
    );
    await fs.mkdir(path.join(sourceRoot, "publisher.invalid-1.0.0"), {
      recursive: true,
    });
    await fs.mkdir(path.join(sourceRoot, ".installing"), { recursive: true });
    const links = [];

    const result = await extension.importVSCodeExtensions({
      homeDir,
      linkDirectory: async (source, destination) => {
        links.push({ source, destination });
        await fs.mkdir(destination, { recursive: true });
      },
    });

    expect(result).toMatchObject({ linked: 1, available: 1 });
    expect(links).toEqual([
      {
        source: path.join(sourceRoot, "publisher.good-1.0.0"),
        destination: path.join(
          homeDir,
          ".lattice-code",
          "extensions",
          "publisher.good-1.0.0",
        ),
      },
    ]);
    await fs.rm(homeDir, { recursive: true, force: true });
  });
});
