"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

function sendJson(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    "cache-control": "no-store",
  });
  response.end(payload);
}

function authorized(request, token) {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }

  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function readJsonBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let oversized = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (oversized) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
      }
    });
  });
}

function canonicalPath(resourcePath) {
  return fs.realpathSync.native(path.resolve(resourcePath));
}

function isPathInsideWorkspace(resourcePath, workspacePath) {
  const relative = path.relative(workspacePath, resourcePath);
  if (!relative) {
    return true;
  }
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validateResourcePath(value, workspacePath) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new Error("A resource path is required."), { statusCode: 400 });
  }

  let resourcePath;
  try {
    resourcePath = canonicalPath(value);
  } catch {
    throw Object.assign(new Error("The requested resource does not exist."), { statusCode: 404 });
  }

  const normalizedResource = process.platform === "win32" ? resourcePath.toLowerCase() : resourcePath;
  const normalizedWorkspace = process.platform === "win32" ? workspacePath.toLowerCase() : workspacePath;
  if (!isPathInsideWorkspace(normalizedResource, normalizedWorkspace) || !fs.statSync(resourcePath).isFile()) {
    throw Object.assign(new Error("The requested resource is outside the active workspace."), { statusCode: 403 });
  }
  return resourcePath;
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

async function openResource(vscode, workspacePath, body) {
  const resourcePath = validateResourcePath(body.path, workspacePath);
  const uri = vscode.Uri.file(resourcePath);

  if (body.kind === "notebook") {
    const document = await vscode.workspace.openNotebookDocument(uri);
    await vscode.window.showNotebookDocument(document, { preview: false });
    return;
  }
  if (body.kind !== "text") {
    throw Object.assign(new Error("Resource kind must be text or notebook."), { statusCode: 400 });
  }

  const document = await vscode.workspace.openTextDocument(uri);
  const options = { preview: false };
  if (body.line !== undefined || body.column !== undefined) {
    const line = nonNegativeInteger(body.line, 0);
    const column = nonNegativeInteger(body.column, 0);
    options.selection = new vscode.Range(line, column, line, column);
  }
  await vscode.window.showTextDocument(document, options);
}

async function runAction(vscode, body) {
  if (body.action === "focusWorkbench") {
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    return;
  }
  if (body.action === "closePrimarySidebar") {
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    return;
  }
  throw Object.assign(new Error("Unsupported Workbench action."), { statusCode: 400 });
}

async function createBridgeServer(vscode, options) {
  const host = options.host === "127.0.0.1" ? options.host : "127.0.0.1";
  const port = Number.isInteger(options.port) ? options.port : 0;
  const token = String(options.token || "");
  const maxBodyBytes = Number.isInteger(options.maxBodyBytes) ? options.maxBodyBytes : 16 * 1024;
  const workspacePath = canonicalPath(options.workspacePath);
  if (!token) {
    throw new Error("A bridge token is required.");
  }

  const server = http.createServer(async (request, response) => {
    if (!authorized(request, token)) {
      sendJson(response, 401, { ok: false, error: "Unauthorized." });
      return;
    }

    try {
      const url = new URL(request.url || "/", `http://${host}`);
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && (url.pathname === "/open" || url.pathname === "/action")) {
        const body = await readJsonBody(request, maxBodyBytes);
        if (url.pathname === "/open") {
          await openResource(vscode, workspacePath, body);
        } else {
          await runAction(vscode, body);
        }
        sendJson(response, 200, { ok: true });
        return;
      }
      sendJson(response, 404, { ok: false, error: "Not found." });
    } catch (error) {
      const status = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
      sendJson(response, status, {
        ok: false,
        error: status === 500 ? "VS Code bridge request failed." : error.message,
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to inspect the VS Code bridge address.");
  }

  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

module.exports = {
  createBridgeServer,
};
