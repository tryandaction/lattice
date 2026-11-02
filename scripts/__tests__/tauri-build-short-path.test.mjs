import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let entry;
let temporaryRoot;
beforeAll(async () => {
  entry = await import("../tauri-build.mjs");
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lattice-tauri-short-path-"));
});
afterAll(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

async function repository(name) {
  const directory = path.join(temporaryRoot, name);
  await mkdir(directory, { recursive: true });
  return realpath(directory);
}

describe("Tauri Windows build directory", () => {
  it("preserves the default Windows short root and derives an isolated root from the explicit environment", () => {
    expect(typeof entry.windowsBuildPaths).toBe("function");
    expect(entry.windowsBuildPaths({})).toEqual({ shortRoot: path.resolve("C:/lb"), shortRepository: path.resolve("C:/lb/Lattice") });
    const isolated = path.join(temporaryRoot, "isolated-defaults");
    expect(entry.windowsBuildPaths({ LATTICE_WINDOWS_BUILD_ROOT: isolated })).toEqual({ shortRoot: isolated, shortRepository: path.join(isolated, "Lattice") });
  });

  it("creates and reuses a real isolated junction without changing the requested source repository", async () => {
    expect(typeof entry.resolveBuildDirectory).toBe("function");
    const source = await repository("source");
    const shortRoot = path.join(temporaryRoot, "isolated-build");
    const options = { repository: source, platform: "win32", env: { LATTICE_WINDOWS_BUILD_ROOT: shortRoot } };
    const first = await entry.resolveBuildDirectory(options);
    expect(first).toBe(path.join(shortRoot, "Lattice"));
    expect((await lstat(first)).isSymbolicLink()).toBe(true);
    expect(await realpath(first)).toBe(source);
    expect(await entry.resolveBuildDirectory(options)).toBe(first);
    expect(await realpath(first)).toBe(source);
  });

  it("rejects an existing junction aimed at another checkout and preserves its target", async () => {
    expect(typeof entry.resolveBuildDirectory).toBe("function");
    const original = await repository("original");
    const requested = await repository("requested");
    const shortRoot = path.join(temporaryRoot, "occupied-build");
    await mkdir(shortRoot);
    const junction = path.join(shortRoot, "Lattice");
    await symlink(original, junction, "junction");
    await expect(entry.resolveBuildDirectory({ repository: requested, platform: "win32", env: { LATTICE_WINDOWS_BUILD_ROOT: shortRoot } })).rejects.toThrow("targets");
    expect(await realpath(junction)).toBe(original);
  });

  it("uses the checkout directly outside Windows without creating a short root", async () => {
    expect(typeof entry.resolveBuildDirectory).toBe("function");
    const source = await repository("unix-source");
    const shortRoot = path.join(temporaryRoot, "unused-build");
    expect(await entry.resolveBuildDirectory({ repository: source, platform: "linux", env: { LATTICE_WINDOWS_BUILD_ROOT: shortRoot } })).toBe(source);
    await expect(lstat(shortRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.skipIf(process.platform !== "win32")("runs from a junction and passes the isolated root to the synthetic beforeBuild child", async () => {
    const source = await repository("cli-fixture");
    const scriptDirectory = path.join(source, "scripts");
    const cliDirectory = path.join(source, "node_modules", "@tauri-apps", "cli");
    const localAppData = path.join(temporaryRoot, "fixture-local-data");
    const shortRoot = path.join(temporaryRoot, "cli-build");
    const output = path.join(temporaryRoot, "child-environment.json");
    await Promise.all([mkdir(scriptDirectory, { recursive: true }), mkdir(cliDirectory, { recursive: true }), mkdir(path.join(source, "src-tauri", "target", ".tauri"), { recursive: true }), mkdir(path.join(localAppData, "tauri"), { recursive: true }), mkdir(shortRoot)]);
    await copyFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tauri-build.mjs"), path.join(scriptDirectory, "tauri-build.mjs"));
    await writeFile(path.join(localAppData, "tauri", "MicrosoftEdgeWebview2Setup.exe"), Buffer.alloc(100_001));
    await writeFile(path.join(cliDirectory, "tauri.js"), 'const fs = require("node:fs"); fs.writeFileSync(process.env.LATTICE_FIXTURE_OUTPUT, JSON.stringify({ root: process.env.LATTICE_WINDOWS_BUILD_ROOT, cwd: process.cwd(), args: process.argv.slice(2) }));');
    await symlink(source, path.join(shortRoot, "Lattice"), "junction");
    await promisify(execFile)(process.execPath, [path.join(shortRoot, "Lattice", "scripts", "tauri-build.mjs"), "--fixture-only"], {
      env: { ...process.env, LOCALAPPDATA: localAppData, LATTICE_WINDOWS_BUILD_ROOT: shortRoot, LATTICE_FIXTURE_OUTPUT: output },
      windowsHide: true,
    });
    const child = JSON.parse(await readFile(output, "utf8"));
    expect(child.root).toBe(shortRoot);
    expect(await realpath(child.cwd)).toBe(source);
    expect(child.args).toEqual(["build", "--fixture-only"]);
  });
});
