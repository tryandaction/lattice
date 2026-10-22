"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RESEARCH_VIEW_COMMAND = "workbench.view.extension.lattice";
const TOOL_ITEMS = [
  {
    label: "Files",
    description: "Browse and open workspace files",
    icon: "files",
    command: "lattice.openExplorer",
  },
  {
    label: "Extensions",
    description: "Use VS Code compatible extensions",
    icon: "extensions",
    command: "lattice.openExtensions",
  },
  {
    label: "Run and Debug",
    description: "Run tasks and debug code",
    icon: "debug-alt",
    command: "lattice.openRunAndDebug",
  },
  {
    label: "Terminal",
    description: "Run commands in the workspace",
    icon: "terminal",
    command: "lattice.openTerminal",
  },
  {
    label: "Settings",
    description: "Configure the Workbench",
    icon: "settings-gear",
    command: "workbench.action.openSettings",
  },
];

function createToolItem(vscode, item) {
  const treeItem = new vscode.TreeItem(
    item.label,
    vscode.TreeItemCollapsibleState.None,
  );
  treeItem.description = item.description;
  treeItem.iconPath = new vscode.ThemeIcon(item.icon);
  treeItem.command = {
    command: item.command,
    title: item.label,
  };
  return treeItem;
}

async function importVSCodeExtensions({
  homeDir = os.homedir(),
  platform = process.platform,
  fsApi = fs.promises,
  linkDirectory = (source, destination, type) =>
    fsApi.symlink(source, destination, type),
} = {}) {
  const sourceRoot = path.join(homeDir, ".vscode", "extensions");
  const targetRoot = path.join(homeDir, ".lattice-code", "extensions");
  let entries;
  try {
    entries = await fsApi.readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return { linked: 0, available: 0, sourceRoot, targetRoot };
  }

  await fsApi.mkdir(targetRoot, { recursive: true });
  let linked = 0;
  let available = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const source = path.join(sourceRoot, entry.name);
    try {
      await fsApi.stat(path.join(source, "package.json"));
    } catch {
      continue;
    }
    available += 1;
    const destination = path.join(targetRoot, entry.name);
    try {
      await fsApi.lstat(destination);
      continue;
    } catch {
      // The directory is not linked yet.
    }
    await linkDirectory(source, destination, platform === "win32" ? "junction" : "dir");
    linked += 1;
  }
  return { linked, available, sourceRoot, targetRoot };
}

function workspaceLabel(vscode) {
  const folders = vscode.workspace?.workspaceFolders ?? [];
  return folders.length > 0
    ? folders.map((folder) => folder.name).join(", ")
    : "No folder open";
}

function formatVSCodeExtensionCount(count) {
  return `${count} VS Code extension${count === 1 ? "" : "s"}`;
}

async function showImportResult(vscode, result) {
  await vscode.commands.executeCommand("workbench.view.extensions");
  if (result.linked > 0) {
    await vscode.window.showInformationMessage(
      `Imported ${result.linked} VS Code extension${result.linked === 1 ? "" : "s"}. Reloading the Workbench to activate them.`,
    );
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
    return;
  }
  await vscode.window.showInformationMessage(
    `${formatVSCodeExtensionCount(result.available)} ready.`,
  );
}

function activate(context, vscodeApi, runtime = {}) {
  const vscode = vscodeApi ?? require("vscode");
  const importExtensions =
    runtime.importVSCodeExtensions ?? importVSCodeExtensions;
  const researchProvider = {
    getTreeItem(element) {
      return element;
    },
    getChildren() {
      return TOOL_ITEMS.map((item) => createToolItem(vscode, item));
    },
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "lattice.research",
      researchProvider,
    ),
    vscode.commands.registerCommand("lattice.openResearch", () =>
      vscode.commands.executeCommand(RESEARCH_VIEW_COMMAND),
    ),
    vscode.commands.registerCommand("lattice.openExplorer", () =>
      vscode.commands.executeCommand("workbench.view.explorer"),
    ),
    vscode.commands.registerCommand("lattice.openExtensions", () =>
      vscode.commands.executeCommand("workbench.view.extensions"),
    ),
    vscode.commands.registerCommand("lattice.openTerminal", () =>
      vscode.commands.executeCommand("workbench.action.terminal.toggleTerminal"),
    ),
    vscode.commands.registerCommand("lattice.openRunAndDebug", () =>
      vscode.commands.executeCommand("workbench.view.debug"),
    ),
    vscode.commands.registerCommand("lattice.importVSCodeProfile", async () => {
      await showImportResult(vscode, await importExtensions());
    }),
    vscode.commands.registerCommand("lattice.showMigrationStatus", () =>
      vscode.window.showInformationMessage(
        `Lattice Workbench active. Workspace: ${workspaceLabel(vscode)}. ${formatVSCodeExtensionCount(vscode.extensions?.all?.length ?? 0)}.`,
      ),
    ),
  );

  void importExtensions()
    .then(async (result) => {
      if (result.linked > 0) {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    })
    .catch((error) => {
      if (typeof vscode.window.showWarningMessage === "function") {
        void vscode.window.showWarningMessage(
          `VS Code extension import skipped: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  importVSCodeExtensions,
};
