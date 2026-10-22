/**
 * @vitest-environment node
 */

import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createBridgeServer } = require(
  path.resolve("src-tauri/resources/vscode-lattice-bridge/server.cjs"),
) as {
  createBridgeServer: (
    vscode: unknown,
    options: {
      host: string;
      port: number;
      token: string;
      workspacePath: string;
      maxBodyBytes: number;
    },
  ) => Promise<{ port: number; close: () => Promise<void> }>;
};

class MockRange {
  constructor(
    readonly startLine: number,
    readonly startColumn: number,
    readonly endLine: number,
    readonly endColumn: number,
  ) {}
}

describe("bundled VS Code Workbench bridge", () => {
  let workspacePath: string;
  let outsidePath: string;
  let bridge: { port: number; close: () => Promise<void> };

  const textDocument = { kind: "text" };
  const notebookDocument = { kind: "notebook" };
  const vscode = {
    Uri: { file: vi.fn((fsPath: string) => ({ fsPath })) },
    Range: MockRange,
    workspace: {
      openTextDocument: vi.fn(async () => textDocument),
      openNotebookDocument: vi.fn(async () => notebookDocument),
    },
    window: {
      showTextDocument: vi.fn(async () => undefined),
      showNotebookDocument: vi.fn(async () => undefined),
    },
    commands: {
      executeCommand: vi.fn(async () => undefined),
    },
  };

  it("activates eagerly when the remote Extension Host starts", async () => {
    const manifest = JSON.parse(await readFile(
      path.resolve("src-tauri/resources/vscode-lattice-bridge/package.json"),
      "utf8",
    ));
    expect(manifest.activationEvents).toEqual(["*"]);
    expect(manifest.main).toBe("./extension.js");
    expect(manifest.capabilities).toMatchObject({
      untrustedWorkspaces: { supported: true },
    });
    await expect(readFile(
      path.resolve("src-tauri/resources/vscode-lattice-bridge/extension.js"),
      "utf8",
    )).resolves.toContain('require("./extension.cjs")');
  });

  async function request(
    method: string,
    pathname: string,
    body?: unknown,
    token = "bridge-token",
  ) {
    // The desktop bridge is a native HTTP service. OS-assigned ports can be
    // blocked by Fetch's browser policy, which the native client does not use.
    const payload = body === undefined
      ? undefined
      : typeof body === "string" ? body : JSON.stringify(body);
    return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const call = httpRequest(`http://127.0.0.1:${bridge.port}${pathname}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload === undefined ? {} : {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          }),
        },
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch (error) { reject(error); }
        });
      });
      call.on("error", reject);
      call.end(payload);
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const root = await mkdtemp(path.join(tmpdir(), "lattice-vscode-bridge-"));
    workspacePath = path.join(root, "workspace");
    outsidePath = path.join(root, "outside.ts");
    await mkdir(workspacePath);
    await writeFile(path.join(workspacePath, "main.ts"), "const answer = 42;\n", "utf8");
    await writeFile(path.join(workspacePath, "analysis.ipynb"), "{}", "utf8");
    await writeFile(outsidePath, "outside", "utf8");
    bridge = await createBridgeServer(vscode, {
      host: "127.0.0.1",
      port: 0,
      token: "bridge-token",
      workspacePath,
      maxBodyBytes: 512,
    });
  });

  afterEach(async () => {
    await bridge.close();
  });

  it("requires the bridge token for health checks", async () => {
    expect(await request("GET", "/health", undefined, "wrong-token")).toMatchObject({
      status: 401,
    });
    expect(await request("GET", "/health")).toMatchObject({
      status: 200,
      body: { ok: true },
    });
  });

  it("rejects oversized bodies and resources outside the workspace", async () => {
    expect(await request("POST", "/open", "x".repeat(513))).toMatchObject({ status: 413 });
    expect(await request("POST", "/open", { path: outsidePath, kind: "text" })).toMatchObject({
      status: 403,
    });
    expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
  });

  it("opens text resources at the requested zero-based selection", async () => {
    const resourcePath = path.join(workspacePath, "main.ts");
    const canonicalResourcePath = await realpath(resourcePath);
    const response = await request("POST", "/open", {
      path: resourcePath,
      kind: "text",
      line: 4,
      column: 7,
    });

    expect(response).toMatchObject({ status: 200, body: { ok: true } });
    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({ fsPath: canonicalResourcePath });
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(textDocument, {
      preview: false,
      selection: new MockRange(4, 7, 4, 7),
    });
  });

  it("opens notebook resources with the native notebook editor", async () => {
    const resourcePath = path.join(workspacePath, "analysis.ipynb");
    const canonicalResourcePath = await realpath(resourcePath);
    expect(await request("POST", "/open", { path: resourcePath, kind: "notebook" })).toMatchObject({
      status: 200,
    });
    expect(vscode.workspace.openNotebookDocument).toHaveBeenCalledWith({ fsPath: canonicalResourcePath });
    expect(vscode.window.showNotebookDocument).toHaveBeenCalledWith(notebookDocument, {
      preview: false,
    });
  });

  it("allows only the two declared Workbench actions", async () => {
    expect(await request("POST", "/action", { action: "focusWorkbench" })).toMatchObject({ status: 200 });
    expect(await request("POST", "/action", { action: "closePrimarySidebar" })).toMatchObject({ status: 200 });
    expect(await request("POST", "/action", { action: "workbench.action.files.saveAll" })).toMatchObject({ status: 400 });
    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(1, "workbench.action.focusActiveEditorGroup");
    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(2, "workbench.action.closeSidebar");
    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(2);
  });
});
