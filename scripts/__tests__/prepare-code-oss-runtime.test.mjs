import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCommandInvocation,
  buildProvisionCommands,
  findUnsafeRuntimeInstallPaths,
  inspectProvisionedRuntime,
  pruneRuntimeBuildArtifacts,
  readRuntimeSource,
  runtimeLayout,
  sourceFingerprint,
  validateRuntimeSource,
} from "../prepare-code-oss-runtime.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ),
  );
});

async function createTemporaryRuntime() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-code-oss-runtime-"));
  temporaryRoots.push(root);
  return root;
}

describe("prepare-code-oss-runtime", () => {
  it("accepts the pinned Code OSS runtime source", async () => {
    const source = await readRuntimeSource(
      path.resolve("src-tauri/code-oss-runtime/runtime-source.json"),
    );

    expect(validateRuntimeSource(source)).toEqual([]);
    expect(source).toMatchObject({
      distribution: "code-server",
      runtimeVersion: "4.128.0",
      codeOssVersion: "1.128.0",
      nodeMajor: 22,
    });
  });

  it("rejects a runtime source without a SHA-256 digest", () => {
    expect(
      validateRuntimeSource({
        schemaVersion: 1,
        distribution: "code-server",
        runtimeVersion: "4.128.0",
        codeOssVersion: "1.128.0",
        nodeMajor: 22,
        packageUrl:
          "https://github.com/coder/code-server/releases/download/v4.128.0/package.tar.gz",
        packageSha256: "",
        entrypoint: "node_modules/code-server/out/node/entry.js",
      }),
    ).toContain("packageSha256 must be a lowercase SHA-256 digest.");
  });

  it("resolves the self-contained Windows runtime layout", () => {
    expect(runtimeLayout("C:/runtime", { platform: "win32" })).toEqual({
      root: path.resolve("C:/runtime"),
      nodeExecutable: path.resolve("C:/runtime", "bin", "node.exe"),
      entrypoint: path.resolve(
        "C:/runtime",
        "node_modules",
        "code-server",
        "out",
        "node",
        "entry.js",
      ),
      provisionManifest: path.resolve("C:/runtime", "provision-manifest.json"),
      requiredModules: [
        path.resolve(
          "C:/runtime",
          "node_modules/@vscode/fs-copyfile/package.json",
        ),
      ],
      nativeBindings: [
        path.resolve(
          "C:/runtime",
          "node_modules/code-server/lib/vscode/node_modules/@vscode/spdlog/build/Release/spdlog.node",
        ),
        path.resolve(
          "C:/runtime",
          "node_modules/code-server/lib/vscode/node_modules/@vscode/deviceid/build/Release/windows.node",
        ),
        path.resolve(
          "C:/runtime",
          "node_modules/code-server/lib/vscode/node_modules/@vscode/windows-registry/build/Release/winregistry.node",
        ),
      ],
    });
  });

  it("reports every missing provisioned runtime artifact", async () => {
    const root = await createTemporaryRuntime();
    const source = await readRuntimeSource(
      path.resolve("src-tauri/code-oss-runtime/runtime-source.json"),
    );

    const result = await inspectProvisionedRuntime(root, source, {
      platform: "win32",
      arch: "x64",
    });

    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Bundled Node executable is missing.",
        "Code OSS server entrypoint is missing.",
        "Provision manifest is missing.",
      ]),
    );
  });

  it("accepts a complete provisioned runtime with a matching fingerprint", async () => {
    const root = await createTemporaryRuntime();
    const source = await readRuntimeSource(
      path.resolve("src-tauri/code-oss-runtime/runtime-source.json"),
    );
    const layout = runtimeLayout(root);
    await fs.mkdir(path.dirname(layout.nodeExecutable), { recursive: true });
    await fs.mkdir(path.dirname(layout.entrypoint), { recursive: true });
    await fs.writeFile(layout.nodeExecutable, "node");
    await fs.writeFile(layout.entrypoint, "entry");
    await Promise.all(
      layout.requiredModules.map(async (modulePath) => {
        await fs.mkdir(path.dirname(modulePath), { recursive: true });
        await fs.writeFile(modulePath, "{}");
      }),
    );
    await Promise.all(
      layout.nativeBindings.map(async (binding) => {
        await fs.mkdir(path.dirname(binding), { recursive: true });
        await fs.writeFile(binding, "native-binding");
      }),
    );
    await fs.writeFile(
      path.join(root, "node_modules", "code-server", "package.json"),
      JSON.stringify({ name: "code-server", version: source.runtimeVersion }),
    );
    await fs.writeFile(
      layout.provisionManifest,
      JSON.stringify({
        schemaVersion: 1,
        sourceFingerprint: sourceFingerprint(source),
        distribution: source.distribution,
        runtimeVersion: source.runtimeVersion,
        codeOssVersion: source.codeOssVersion,
        nodeVersion: "22.18.0",
        platform: "win32",
        arch: "x64",
        entrypoint: source.entrypoint,
      }),
    );

    await expect(
      inspectProvisionedRuntime(root, source, {
        platform: "win32",
        arch: "x64",
      }),
    ).resolves.toMatchObject({ ready: true, errors: [] });
  });

  it("prunes native build intermediates without removing runtime bindings", async () => {
    const root = await createTemporaryRuntime();
    const buildRoot = path.join(
      root,
      "node_modules/code-server/lib/vscode/node_modules/@vscode/windows-ca-certs/build",
    );
    const binding = path.join(buildRoot, "Release", "crypt32.node");
    const objectLog = path.join(
      buildRoot,
      "Release/obj/crypt32/crypt32.tlog/crypt32.lastbuildstate",
    );
    const nestedBuildLog = path.join(
      buildRoot,
      "node_modules/node-addon-api/Release/obj/node_addon_api_except/node_add.tlog/node_addon_api_except.lastbuildstate",
    );
    const debugSymbols = path.join(buildRoot, "Release", "crypt32.pdb");

    for (const filePath of [binding, objectLog, nestedBuildLog, debugSymbols]) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "fixture");
    }

    await pruneRuntimeBuildArtifacts(root);

    await expect(fs.stat(binding)).resolves.toMatchObject({ size: 7 });
    await expect(fs.stat(objectLog)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(nestedBuildLog)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(debugSymbols)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects runtime files that exceed the conservative Windows install path budget", () => {
    const unsafeRelativePath = path.join(
      "node_modules",
      "code-server",
      "lib",
      "vscode",
      "node_modules",
      "@vscode",
      "windows-ca-certs",
      "build",
      "node_modules",
      "node-addon-api",
      "Release",
      "obj",
      "x".repeat(120),
      "fixture.lastbuildstate",
    );

    expect(
      findUnsafeRuntimeInstallPaths(["bin/node.exe", unsafeRelativePath]),
    ).toEqual([
      expect.objectContaining({
        relativePath: unsafeRelativePath,
        pathLength: expect.any(Number),
      }),
    ]);
  });

  it("changes the source fingerprint when the pinned runtime changes", async () => {
    const source = await readRuntimeSource(
      path.resolve("src-tauri/code-oss-runtime/runtime-source.json"),
    );

    expect(
      sourceFingerprint({ ...source, runtimeVersion: "4.128.1" }),
    ).not.toBe(sourceFingerprint(source));
  });

  it("runs Windows command shims through ComSpec without showing a console", () => {
    expect(
      buildCommandInvocation("npm.cmd", ["ci", "--omit=dev"], {
        platform: "win32",
        comspec: "C:/Windows/System32/cmd.exe",
      }),
    ).toEqual({
      command: "C:/Windows/System32/cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "ci", "--omit=dev"],
    });
  });

  it("replaces the POSIX postinstall with locked Windows-compatible npm steps", () => {
    const root = path.resolve("C:/runtime");
    expect(buildProvisionCommands(root)).toEqual([
      {
        cwd: root,
        args: ["install", "--omit=dev", "--ignore-scripts"],
      },
      {
        cwd: root,
        args: ["rebuild", "argon2"],
      },
      {
        cwd: path.join(root, "node_modules", "code-server", "lib", "vscode"),
        args: ["install", "--omit=dev"],
      },
      {
        cwd: path.join(root, "node_modules", "code-server", "lib", "vscode"),
        args: [
          "rebuild",
          "@vscode/spdlog",
          "@vscode/deviceid",
          "@vscode/windows-registry",
        ],
      },
      {
        cwd: path.join(
          root,
          "node_modules",
          "code-server",
          "lib",
          "vscode",
          "extensions",
        ),
        args: ["install", "--omit=dev"],
      },
    ]);
  });
});
