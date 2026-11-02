import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const descriptorDirectory = path.join(repositoryRoot, "scripts", "cloud-team-test-runtime");
const runtimeDirectory = path.join(repositoryRoot, ".lattice-build", "cloud-team-test-runtime");
const packageName = "@electric-sql/pglite";
const packageVersion = "0.5.8";

export async function cloudTestRuntimeReady(directory, expectedManifest, expectedLock) {
  try {
    const [manifest, lock, installed] = await Promise.all([
      readFile(path.join(directory, "package.json"), "utf8"),
      readFile(path.join(directory, "package-lock.json"), "utf8"),
      readFile(path.join(directory, "node_modules", packageName, "package.json"), "utf8"),
    ]);
    if (manifest !== expectedManifest || lock !== expectedLock || JSON.parse(installed).version !== packageVersion) return false;
    return (await stat(path.join(directory, "node_modules", packageName, "dist", "index.js"))).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

async function prepare() {
  const [manifest, lock] = await Promise.all([
    readFile(path.join(descriptorDirectory, "package.json"), "utf8"),
    readFile(path.join(descriptorDirectory, "package-lock.json"), "utf8"),
  ]);
  await mkdir(runtimeDirectory, { recursive: true });
  const resolvedRoot = await realpath(repositoryRoot);
  const resolvedRuntime = await realpath(runtimeDirectory);
  const relative = path.relative(resolvedRoot, resolvedRuntime);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Test runtime must stay inside this checkout.");
  try {
    if ((await lstat(path.join(runtimeDirectory, "node_modules"))).isSymbolicLink()) throw new Error("Test runtime node_modules must not be a link.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (await cloudTestRuntimeReady(runtimeDirectory, manifest, lock)) {
    console.log("[prepare-cloud-test-runtime] pinned local PostgreSQL fixture is ready.");
    return;
  }
  await writeFile(path.join(runtimeDirectory, "package.json"), manifest);
  await writeFile(path.join(runtimeDirectory, "package-lock.json"), lock);
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, "ci", "--ignore-scripts", "--registry=https://registry.npmjs.org"], {
      cwd: runtimeDirectory, stdio: "inherit", windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("Local PostgreSQL fixture install failed with exit code " + code)));
  });
  if (!await cloudTestRuntimeReady(runtimeDirectory, manifest, lock)) throw new Error("Pinned local PostgreSQL fixture verification failed.");
  console.log("[prepare-cloud-test-runtime] installed isolated PostgreSQL fixture; no hosted database was contacted.");
}

const invokedPath = process.argv[1] ? await realpath(path.resolve(process.argv[1])).catch(() => null) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  prepare().catch(error => { console.error("[prepare-cloud-test-runtime]", error.message); process.exitCode = 1; });
}