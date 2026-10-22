// @vitest-environment node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDesktopCommands,
  buildToolchainLayout,
  createBuildEnvironment,
  inspectBuildNodeToolchain,
  prepareBuildNodeToolchain,
  ensureGeneratedBuildRoot,
  resolveGeneratedBuildRoot,
  selectWindowsSdkBin,
  validateBuildPrerequisites,
} from "../prepare-code-oss-desktop.mjs";

const SOURCE = {
  schemaVersion: 1,
  repository: "https://github.com/microsoft/vscode.git",
  tag: "1.128.0",
  commit: "fc3def6774c76082adf699d366f31a557ce5573f",
  checkoutDirectory: ".lattice-build/code-oss/source",
  buildNodeVersion: "24.17.0",
  buildNodeUrl:
    "https://nodejs.org/dist/v24.17.0/node-v24.17.0-win-x64.zip",
  buildNodeSha256:
    "f2aa33b35b75aca5f3f7b85675a6f6423201053e9381911e64961f3bda2528ab",
};

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("Lattice Code OSS desktop build scripts", () => {
  it("exposes stable root package commands", async () => {
    const pkg = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8"));

    expect(pkg.scripts["code-oss:check"]).toBe(
      "node scripts/prepare-code-oss-desktop.mjs --check",
    );
    expect(pkg.scripts["code-oss:prepare"]).toBe(
      "node scripts/prepare-code-oss-desktop.mjs --prepare",
    );
    expect(pkg.scripts["code-oss:build"]).toBe(
      "node scripts/prepare-code-oss-desktop.mjs --build",
    );
  });

  it("resolves the pinned portable Node and desktop output layout", () => {
    const layout = buildToolchainLayout("C:/repo", SOURCE);

    expect(layout).toMatchObject({
      archivePath: path.resolve(
        "C:/repo/.lattice-build/code-oss/tools/node-v24.17.0-win-x64.zip",
      ),
      runtimeRoot: path.resolve(
        "C:/repo/.lattice-build/code-oss/tools/node-v24.17.0-win-x64",
      ),
      nodeExecutable: path.resolve(
        "C:/repo/.lattice-build/code-oss/tools/node-v24.17.0-win-x64/node.exe",
      ),
      npmCommand: path.resolve(
        "C:/repo/.lattice-build/code-oss/tools/node-v24.17.0-win-x64/npm.cmd",
      ),
      npmCli: path.resolve(
        "C:/repo/.lattice-build/code-oss/tools/node-v24.17.0-win-x64/node_modules/npm/bin/npm-cli.js",
      ),
      logRoot: path.resolve("C:/repo/.lattice-build/code-oss/logs"),
      distributionRoot: path.resolve(
        "C:/repo/.lattice-build/code-oss/VSCode-win32-x64",
      ),
    });

    const shortLayout = buildToolchainLayout("C:/repo", SOURCE, {
      generatedRoot: "C:/lb/LatticeCodeOSS",
    });
    expect(shortLayout.runtimeRoot).toBe(
      path.resolve("C:/lb/LatticeCodeOSS/tools/node-v24.17.0-win-x64"),
    );
    expect(shortLayout.distributionRoot).toBe(
      path.resolve("C:/lb/LatticeCodeOSS/VSCode-win32-x64"),
    );
  });

  it("builds the official dependency and desktop packaging commands", () => {
    const desktop = {
      repoRoot: path.resolve("C:/repo"),
      buildRoot: path.resolve(
        "C:/repo/.lattice-build/code-oss/build-source",
      ),
    };
    const tools = buildToolchainLayout(desktop.repoRoot, SOURCE);

    expect(buildDesktopCommands(desktop, tools)).toEqual([
      {
        command: tools.nodeExecutable,
        args: [tools.npmCli, "ci"],
        cwd: desktop.buildRoot,
        logPath: path.join(tools.logRoot, "npm-ci.log"),
      },
      {
        command: tools.nodeExecutable,
        args: [tools.npmCli, "run", "gulp", "vscode-win32-x64"],
        cwd: desktop.buildRoot,
        logPath: path.join(tools.logRoot, "vscode-win32-x64.log"),
      },
    ]);
  });

  it("reports unsupported build prerequisites precisely", () => {
    expect(
      validateBuildPrerequisites(
        {
          platform: "win32",
          arch: "x64",
          nodeVersion: "22.18.0",
          gitAvailable: false,
          pythonVersion: null,
          msbuildAvailable: false,
          signtoolAvailable: false,
          freeBytes: 5 * 1024 ** 3,
        },
        SOURCE,
      ),
    ).toEqual(
      expect.arrayContaining([
        "Code OSS build requires portable Node 24.17.0.",
        "Git is required to build Code OSS.",
        "Python 3 is required to build Code OSS native modules.",
        "Visual Studio C++ Build Tools are required to build Code OSS.",
        "Windows SDK signtool.exe is required to package Code OSS.",
        "At least 20 GB of free disk space is required to build Code OSS.",
      ]),
    );
  });

  it("validates archive identity and the extracted Node runtime", () => {
    expect(
      inspectBuildNodeToolchain(
        {
          archiveExists: true,
          archiveSha256: SOURCE.buildNodeSha256,
          nodeExists: true,
          npmExists: true,
          npmCliExists: true,
          nodeVersion: SOURCE.buildNodeVersion,
        },
        SOURCE,
      ),
    ).toEqual({ ready: true, errors: [] });

    expect(
      inspectBuildNodeToolchain(
        {
          archiveExists: true,
          archiveSha256: "0".repeat(64),
          nodeExists: false,
          npmExists: false,
          npmCliExists: false,
          nodeVersion: "22.18.0",
        },
        SOURCE,
      ).errors,
    ).toEqual(
      expect.arrayContaining([
        "Portable Node archive checksum does not match the source contract.",
        "Portable Node executable is missing.",
        "Portable npm command is missing.",
        "Portable npm CLI is missing.",
        "Portable Node version must be 24.17.0.",
      ]),
    );
  });

  it("downloads, verifies, extracts, and checks the portable Node toolchain", async () => {
    const repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "lattice-code-oss-node-"),
    );
    temporaryRoots.push(repoRoot);
    const archive = Buffer.from("portable-node-archive");
    const source = {
      ...SOURCE,
      buildNodeSha256: createHash("sha256").update(archive).digest("hex"),
    };
    const tools = buildToolchainLayout(repoRoot, source);
    let downloadCount = 0;
    let extractCount = 0;

    const result = await prepareBuildNodeToolchain({
      tools,
      source,
      downloadArchive: async (url, destination) => {
        downloadCount += 1;
        expect(url).toBe(source.buildNodeUrl);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, archive);
      },
      extractArchive: async () => {
        extractCount += 1;
        await fs.mkdir(tools.runtimeRoot, { recursive: true });
        await fs.writeFile(tools.nodeExecutable, "node");
        await fs.writeFile(tools.npmCommand, "npm");
        await fs.mkdir(path.dirname(tools.npmCli), { recursive: true });
        await fs.writeFile(tools.npmCli, "npm-cli");
      },
      queryNodeVersion: async () => source.buildNodeVersion,
    });

    expect(result).toEqual({ ready: true, errors: [] });
    expect(downloadCount).toBe(1);
    expect(extractCount).toBe(1);
  });

  it("isolates the Code OSS build toolchain in child-process environment", () => {
    const tools = buildToolchainLayout("C:/repo", SOURCE);

    expect(
      createBuildEnvironment(
        tools,
        {
          pythonExecutable: "C:/Python313/python.exe",
          visualStudioVersion: "2022",
          windowsSdkBin: "C:/Windows Kits/10/bin/10.0.26100.0/x64",
        },
        {
          PATH: "C:/global/npm",
          Path: "C:/Windows/System32",
          EXISTING: "kept",
        },
      ),
    ).toMatchObject({
      Path: [
        tools.runtimeRoot,
        "C:/Windows Kits/10/bin/10.0.26100.0/x64",
        "C:/Windows/System32",
      ].join(path.delimiter),
      EXISTING: "kept",
      npm_config_python: "C:/Python313/python.exe",
      npm_config_msvs_version: "2022",
      GYP_MSVS_VERSION: "2022",
    });
    expect(
      Object.keys(
        createBuildEnvironment(
          tools,
          {
            pythonExecutable: "C:/Python313/python.exe",
            visualStudioVersion: "2022",
            windowsSdkBin: "C:/Windows Kits/10/bin/10.0.26100.0/x64",
          },
          { PATH: "C:/global/npm", Path: "C:/Windows/System32" },
        ),
      ).filter((key) => key.toLowerCase() === "path"),
    ).toEqual(["Path"]);
  });

  it("selects the newest x64 Windows SDK signing tools", () => {
    expect(
      selectWindowsSdkBin([
        "C:/Program Files (x86)/Windows Kits/10/bin/10.0.22621.0/x64/signtool.exe",
        "C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x86/signtool.exe",
        "C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64/signtool.exe",
      ]),
    ).toBe(
      path.resolve(
        "C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64",
      ),
    );
    expect(selectWindowsSdkBin([])).toBeNull();
  });

  it("uses a physical short generated root for Windows builds", () => {
    expect(
      resolveGeneratedBuildRoot("C:/long path/Lattice", {
        platform: "win32",
      }),
    ).toBe(path.resolve("C:/lb/LatticeCodeOSS"));
    expect(
      resolveGeneratedBuildRoot("/work/lattice", { platform: "linux" }),
    ).toBe(path.resolve("/work/lattice/.lattice-build/code-oss"));
  });

  it("owns the generated root and rejects whitespace or another repository", async () => {
    const parent = await fs.mkdtemp(
      path.join(os.tmpdir(), "lattice-code-oss-generated-"),
    );
    temporaryRoots.push(parent);
    const generatedRoot = path.join(parent, "LatticeCodeOSS");

    await expect(
      ensureGeneratedBuildRoot({
        repoRoot: "C:/repo/Lattice",
        generatedRoot,
      }),
    ).resolves.toBe(path.resolve(generatedRoot));
    await expect(
      fs.readFile(
        path.join(generatedRoot, ".lattice-code-oss-root.json"),
        "utf8",
      ).then(JSON.parse),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      repository: path.resolve("C:/repo/Lattice"),
    });
    await expect(
      ensureGeneratedBuildRoot({
        repoRoot: "C:/other/Lattice",
        generatedRoot,
      }),
    ).rejects.toThrow("Code OSS generated root belongs to another repository");

    await expect(
      ensureGeneratedBuildRoot({
        repoRoot: "C:/repo/Lattice",
        generatedRoot: path.join(parent, "root with spaces"),
      }),
    ).rejects.toThrow("Code OSS generated root physical path must not contain whitespace");
  });
});
