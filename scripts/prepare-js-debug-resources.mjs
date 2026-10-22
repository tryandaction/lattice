import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const MAX_COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

export function resourceLayout(repoRoot = repositoryRoot) {
  const resourceRoot = path.resolve(repoRoot, "src-tauri", "resources", "vscode-js-debug");
  const runtimeRoot = path.join(resourceRoot, "js-debug");
  return {
    resourceRoot,
    runtimeRoot,
    adapterEntry: path.join(runtimeRoot, "src", "dapDebugServer.js"),
    license: path.join(runtimeRoot, "LICENSE"),
  };
}

export function validateDescriptor(descriptor) {
  const errors = [];
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    return ["js-debug descriptor must be a JSON object."];
  }
  if (descriptor.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1.");
  }
  if (!VERSION_PATTERN.test(descriptor.version ?? "")) {
    errors.push("version must be a semantic version.");
  }
  try {
    const assetUrl = new URL(descriptor.assetUrl);
    const expectedPrefix = `/microsoft/vscode-js-debug/releases/download/v${descriptor.version}/`;
    if (
      assetUrl.protocol !== "https:" ||
      assetUrl.hostname !== "github.com" ||
      !assetUrl.pathname.startsWith(expectedPrefix) ||
      !assetUrl.pathname.endsWith(`js-debug-dap-v${descriptor.version}.tar.gz`)
    ) {
      errors.push("assetUrl must reference an HTTPS microsoft/vscode-js-debug release asset.");
    }
  } catch {
    errors.push("assetUrl must be a valid URL.");
  }
  if (!Number.isInteger(descriptor.assetBytes) || descriptor.assetBytes <= 0) {
    errors.push("assetBytes must be a positive integer.");
  }
  if (!SHA256_PATTERN.test(descriptor.sha256 ?? "")) {
    errors.push("sha256 must be a lowercase SHA-256 digest.");
  }
  if (
    typeof descriptor.rootDirectory !== "string" ||
    !/^[A-Za-z0-9._-]+$/.test(descriptor.rootDirectory) ||
    descriptor.rootDirectory === "." ||
    descriptor.rootDirectory === ".."
  ) {
    errors.push("rootDirectory must be a single relative directory name.");
  }
  return errors;
}

export function validateArchiveEntries(entries, rootDirectory) {
  const errors = [];
  const prefix = `${rootDirectory}/`;
  const normalizedEntries = entries
    .filter((entry) => typeof entry === "string" && entry.length > 0)
    .map((entry) => entry.replace(/\\/g, "/").replace(/^\.\//, ""));
  const unsafe = normalizedEntries.some((entry) => {
    const pathSegments = entry.split("/").filter(Boolean);
    return (
      entry.startsWith("/") ||
      /^[A-Za-z]:\//.test(entry) ||
      pathSegments.includes("..") ||
      (entry !== rootDirectory && entry !== prefix && !entry.startsWith(prefix))
    );
  });
  if (unsafe) {
    errors.push(`Archive entries must stay inside ${rootDirectory}/.`);
  }
  const required = [
    `${rootDirectory}/src/dapDebugServer.js`,
    `${rootDirectory}/LICENSE`,
  ];
  for (const requiredEntry of required) {
    if (!normalizedEntries.includes(requiredEntry)) {
      errors.push(`Archive is missing ${requiredEntry}.`);
    }
  }
  return errors;
}

export function verifyArchiveBuffer(buffer, descriptor) {
  const errors = [];
  if (!Buffer.isBuffer(buffer) || buffer.length !== descriptor.assetBytes) {
    errors.push(`Archive size must be ${descriptor.assetBytes} bytes.`);
  }
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest !== descriptor.sha256) {
    errors.push("Archive SHA-256 does not match the pinned descriptor.");
  }
  return errors;
}

async function fileExists(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function runCommand(command, args, { captureOutput = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_COMMAND_OUTPUT_BYTES) target.push(chunk);
    };
    child.stdout?.on("data", collect(stdout));
    child.stderr?.on("data", collect(stderr));
    child.once("error", reject);
    child.once("exit", (code) => {
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}${errorText ? `: ${errorText}` : ""}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

async function inspectPreparedResource(layout, descriptor) {
  if (!(await fileExists(layout.adapterEntry)) || !(await fileExists(layout.license))) {
    return false;
  }
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(layout.resourceRoot, "resource-manifest.json"), "utf8"),
    );
    return (
      manifest.schemaVersion === descriptor.schemaVersion &&
      manifest.version === descriptor.version &&
      manifest.assetUrl === descriptor.assetUrl &&
      manifest.assetBytes === descriptor.assetBytes &&
      manifest.sha256 === descriptor.sha256
    );
  } catch {
    return false;
  }
}

async function replaceDirectory(stagingRoot, resourceRoot) {
  const backupRoot = `${resourceRoot}.backup-${randomUUID()}`;
  let hasBackup = false;
  try {
    await fs.rename(resourceRoot, backupRoot);
    hasBackup = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await fs.rename(stagingRoot, resourceRoot);
  } catch (error) {
    if (hasBackup) await fs.rename(backupRoot, resourceRoot);
    throw error;
  }
  if (hasBackup) await fs.rm(backupRoot, { recursive: true, force: true });
}

export async function prepareJsDebugResources({
  repoRoot = repositoryRoot,
  descriptorPath = path.join(scriptDirectory, "js-debug-runtime.json"),
  fetchImpl = fetch,
  tarCommand = process.platform === "win32" ? "tar.exe" : "tar",
} = {}) {
  const descriptor = JSON.parse(await fs.readFile(descriptorPath, "utf8"));
  const descriptorErrors = validateDescriptor(descriptor);
  if (descriptorErrors.length > 0) throw new Error(descriptorErrors.join(" "));

  const layout = resourceLayout(repoRoot);
  if (await inspectPreparedResource(layout, descriptor)) return { descriptor, layout, reused: true };

  const parentDirectory = path.dirname(layout.resourceRoot);
  const operationId = randomUUID();
  const archivePath = path.join(parentDirectory, `.js-debug-${operationId}.tar.gz`);
  const stagingRoot = path.join(parentDirectory, `.js-debug-${operationId}`);
  await fs.mkdir(parentDirectory, { recursive: true });
  try {
    const response = await fetchImpl(descriptor.assetUrl, {
      headers: { "User-Agent": "Lattice-js-debug-resource-preparer" },
    });
    if (!response.ok) throw new Error(`Unable to download js-debug DAP: HTTP ${response.status}.`);
    const archive = Buffer.from(await response.arrayBuffer());
    const archiveErrors = verifyArchiveBuffer(archive, descriptor);
    if (archiveErrors.length > 0) throw new Error(archiveErrors.join(" "));
    await fs.writeFile(archivePath, archive);

    const listing = await runCommand(tarCommand, ["-tzf", archivePath], { captureOutput: true });
    const entryErrors = validateArchiveEntries(listing.split(/\r?\n/), descriptor.rootDirectory);
    if (entryErrors.length > 0) throw new Error(entryErrors.join(" "));

    await fs.mkdir(stagingRoot, { recursive: true });
    await runCommand(tarCommand, ["-xzf", archivePath, "-C", stagingRoot]);
    const stagedRuntime = path.join(stagingRoot, descriptor.rootDirectory);
    const stagedEntry = path.join(stagedRuntime, "src", "dapDebugServer.js");
    const stagedLicense = path.join(stagedRuntime, "LICENSE");
    if (!(await fileExists(stagedEntry)) || !(await fileExists(stagedLicense))) {
      throw new Error("Extracted js-debug resource is missing its adapter entry or license.");
    }
    await fs.writeFile(
      path.join(stagingRoot, "resource-manifest.json"),
      `${JSON.stringify({ ...descriptor, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    await replaceDirectory(stagingRoot, layout.resourceRoot);
    return { descriptor, layout, reused: false };
  } finally {
    await fs.rm(archivePath, { force: true });
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

async function main() {
  const result = await prepareJsDebugResources();
  process.stdout.write(
    `[prepare-js-debug-resources] js-debug ${result.descriptor.version} ${result.reused ? "reused" : "prepared"} at ${result.layout.runtimeRoot}\n`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error("[prepare-js-debug-resources] failed:", error);
    process.exitCode = 1;
  });
}
