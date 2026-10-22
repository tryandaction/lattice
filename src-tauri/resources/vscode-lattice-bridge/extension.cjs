"use strict";

const vscode = require("vscode");
const { createBridgeServer } = require("./server.cjs");

let bridge = null;

async function activate(context) {
  const port = Number.parseInt(process.env.LATTICE_VSCODE_BRIDGE_PORT || "", 10);
  const token = process.env.LATTICE_VSCODE_BRIDGE_TOKEN || "";
  const workspacePath = process.env.LATTICE_VSCODE_WORKSPACE || "";
  if (!Number.isInteger(port) || port <= 0 || !token || !workspacePath) {
    return;
  }

  bridge = await createBridgeServer(vscode, {
    host: "127.0.0.1",
    port,
    token,
    workspacePath,
    maxBodyBytes: 16 * 1024,
  });
  context.subscriptions.push({
    dispose() {
      void bridge?.close();
      bridge = null;
    },
  });
}

async function deactivate() {
  const current = bridge;
  bridge = null;
  await current?.close();
}

module.exports = {
  activate,
  deactivate,
};
