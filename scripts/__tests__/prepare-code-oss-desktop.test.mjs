// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCheckoutCommands,
  applyOverlayPlan,
  buildOverlayPlan,
  buildWorktreeCommand,
  desktopLayout,
  inspectCheckout,
  inspectAppliedOverlay,
  parseDesktopArguments,
  prepareCodeOSSBuildWorktree,
  prepareCodeOSSCheckout,
  readSourceContract,
  sourceLayout,
  validateOverlayPlan,
  validateSourceContract,
} from "../prepare-code-oss-desktop.mjs";

const PINNED_SOURCE = {
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

async function createSyntheticCheckout() {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "lattice-code-oss-desktop-"),
  );
  temporaryRoots.push(repoRoot);
  const layout = sourceLayout(repoRoot, PINNED_SOURCE);
  await fs.mkdir(
    path.join(layout.checkoutRoot, "src", "vs", "code", "electron-main"),
    { recursive: true },
  );
  await fs.writeFile(
    path.join(layout.checkoutRoot, "package.json"),
    JSON.stringify({ name: "code-oss-dev" }),
  );
  await fs.writeFile(
    path.join(
      layout.checkoutRoot,
      "src",
      "vs",
      "code",
      "electron-main",
      "main.ts",
    ),
    "export {};\n",
  );
  return layout;
}

describe("prepare-code-oss-desktop source contract", () => {
  it("accepts the pinned official Code OSS source", async () => {
    const source = await readSourceContract(
      path.resolve("desktop/code-oss/source.json"),
    );

    expect(validateSourceContract(source)).toEqual([]);
    expect(source).toEqual(PINNED_SOURCE);
  });

  it("resolves generated paths outside tracked source", () => {
    const repoRoot = path.resolve("C:/repo");

    expect(sourceLayout(repoRoot, PINNED_SOURCE)).toEqual({
      repoRoot,
      checkoutRoot: path.join(
        repoRoot,
        ".lattice-build",
        "code-oss",
        "source",
      ),
      overlayRoot: path.join(repoRoot, "desktop", "code-oss"),
      stampPath: path.join(
        repoRoot,
        ".lattice-build",
        "code-oss",
        "source-stamp.json",
      ),
    });
  });

  it("rejects floating or non-official upstream sources", () => {
    expect(
      validateSourceContract({ ...PINNED_SOURCE, tag: "main" }),
    ).toContain("tag must be a numeric Code OSS release tag.");
    expect(
      validateSourceContract({
        ...PINNED_SOURCE,
        repository: "http://github.com/microsoft/vscode.git",
      }),
    ).toContain(
      'repository must be "https://github.com/microsoft/vscode.git".',
    );
  });

  it("rejects malformed commits and checkout path traversal", () => {
    expect(
      validateSourceContract({ ...PINNED_SOURCE, commit: "latest" }),
    ).toContain("commit must be a lowercase 40-character Git commit.");
    expect(
      validateSourceContract({
        ...PINNED_SOURCE,
        checkoutDirectory: "../code-oss",
      }),
    ).toContain(
      "checkoutDirectory must stay inside the repository root.",
    );
  });

  it("accepts a checkout at the pinned commit with desktop entry files", async () => {
    const layout = await createSyntheticCheckout();

    await expect(
      inspectCheckout(layout, PINNED_SOURCE, {
        head: PINNED_SOURCE.commit,
        tagCommit: PINNED_SOURCE.commit,
      }),
    ).resolves.toEqual({ ready: true, errors: [] });
  });

  it("rejects a checkout whose HEAD differs from the pinned commit", async () => {
    const layout = await createSyntheticCheckout();

    const result = await inspectCheckout(layout, PINNED_SOURCE, {
      head: "0".repeat(40),
      tagCommit: PINNED_SOURCE.commit,
    });

    expect(result.errors).toContain(
      "Code OSS checkout HEAD does not match the pinned commit.",
    );
  });

  it("rejects a checkout with missing or modified tracked files", async () => {
    const layout = await createSyntheticCheckout();

    const result = await inspectCheckout(layout, PINNED_SOURCE, {
      head: PINNED_SOURCE.commit,
      tagCommit: PINNED_SOURCE.commit,
      worktreeStatus: " D src/too-long.snap",
    });

    expect(result.errors).toContain(
      "Code OSS checkout has missing or modified tracked files.",
    );
  });

  it("reports missing upstream desktop entry files", async () => {
    const layout = await createSyntheticCheckout();
    await fs.rm(path.join(layout.checkoutRoot, "package.json"));
    await fs.rm(
      path.join(
        layout.checkoutRoot,
        "src",
        "vs",
        "code",
        "electron-main",
        "main.ts",
      ),
    );

    const result = await inspectCheckout(layout, PINNED_SOURCE, {
      head: PINNED_SOURCE.commit,
      tagCommit: PINNED_SOURCE.commit,
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Code OSS package.json is missing.",
        "Code OSS Electron main entry is missing.",
      ]),
    );
  });

  it("builds a shallow detached checkout command sequence", () => {
    const layout = sourceLayout("C:/repo", PINNED_SOURCE);

    expect(buildCheckoutCommands(layout, PINNED_SOURCE)).toEqual([
      {
        command: "git",
        args: ["init", layout.checkoutRoot],
        cwd: layout.repoRoot,
      },
      {
        command: "git",
        args: [
          "-C",
          layout.checkoutRoot,
          "config",
          "core.longpaths",
          "true",
        ],
        cwd: layout.repoRoot,
      },
      {
        command: "git",
        args: [
          "-C",
          layout.checkoutRoot,
          "remote",
          "add",
          "origin",
          PINNED_SOURCE.repository,
        ],
        cwd: layout.repoRoot,
      },
      {
        command: "git",
        args: [
          "-C",
          layout.checkoutRoot,
          "fetch",
          "--depth",
          "1",
          "origin",
          `refs/tags/${PINNED_SOURCE.tag}:refs/tags/${PINNED_SOURCE.tag}`,
        ],
        cwd: layout.repoRoot,
      },
      {
        command: "git",
        args: [
          "-C",
          layout.checkoutRoot,
          "checkout",
          "--detach",
          PINNED_SOURCE.commit,
        ],
        cwd: layout.repoRoot,
      },
    ]);
  });

  it("accepts exactly one non-mutating or preparing CLI mode", () => {
    expect(parseDesktopArguments(["--check"])).toEqual({ mode: "check" });
    expect(parseDesktopArguments(["--prepare"])).toEqual({ mode: "prepare" });
    expect(parseDesktopArguments(["--build"])).toEqual({ mode: "build" });
    expect(() => parseDesktopArguments([])).toThrow(
      "Use exactly one of --check, --prepare, or --build.",
    );
    expect(() => parseDesktopArguments(["--check", "--prepare"])).toThrow(
      "Use exactly one of --check, --prepare, or --build.",
    );
  });

  it("checks an existing checkout without writing a source stamp", async () => {
    const layout = await createSyntheticCheckout();
    await fs.mkdir(path.join(layout.checkoutRoot, ".git"));

    const result = await prepareCodeOSSCheckout({
      repoRoot: layout.repoRoot,
      source: PINNED_SOURCE,
      mode: "check",
      queryGit: async (args) =>
        args.includes("status") ? "" : PINNED_SOURCE.commit,
      runCommand: async () => {
        throw new Error("check mode must not run checkout commands");
      },
    });

    expect(result.ready).toBe(true);
    await expect(fs.stat(layout.stampPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("prepares an absent checkout and writes an atomic source stamp", async () => {
    const repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "lattice-code-oss-prepare-"),
    );
    temporaryRoots.push(repoRoot);
    const layout = sourceLayout(repoRoot, PINNED_SOURCE);
    const commands = [];

    const result = await prepareCodeOSSCheckout({
      repoRoot,
      source: PINNED_SOURCE,
      mode: "prepare",
      now: () => new Date("2026-07-17T00:00:00.000Z"),
      queryGit: async (args) =>
        args.includes("status") ? "" : PINNED_SOURCE.commit,
      runCommand: async (command) => {
        commands.push(command);
        if (commands.length === 5) {
          await fs.mkdir(
            path.join(
              layout.checkoutRoot,
              "src",
              "vs",
              "code",
              "electron-main",
            ),
            { recursive: true },
          );
          await fs.mkdir(path.join(layout.checkoutRoot, ".git"));
          await fs.writeFile(
            path.join(layout.checkoutRoot, "package.json"),
            "{}",
          );
          await fs.writeFile(
            path.join(
              layout.checkoutRoot,
              "src",
              "vs",
              "code",
              "electron-main",
              "main.ts",
            ),
            "export {};\n",
          );
        }
      },
    });

    expect(commands).toEqual(buildCheckoutCommands(layout, PINNED_SOURCE));
    expect(result.ready).toBe(true);
    await expect(
      fs.readFile(layout.stampPath, "utf8").then(JSON.parse),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      repository: PINNED_SOURCE.repository,
      tag: PINNED_SOURCE.tag,
      commit: PINNED_SOURCE.commit,
      generatedAt: "2026-07-17T00:00:00.000Z",
    });
  });

  it("refuses to overwrite an existing checkout at another commit", async () => {
    const layout = await createSyntheticCheckout();
    await fs.mkdir(path.join(layout.checkoutRoot, ".git"));
    let commandCount = 0;

    await expect(
      prepareCodeOSSCheckout({
        repoRoot: layout.repoRoot,
        source: PINNED_SOURCE,
        mode: "prepare",
        queryGit: async (args) =>
          args.includes("status")
            ? ""
            : args.includes("HEAD")
              ? "0".repeat(40)
              : PINNED_SOURCE.commit,
        runCommand: async () => {
          commandCount += 1;
        },
      }),
    ).rejects.toThrow(
      "Code OSS checkout HEAD does not match the pinned commit.",
    );
    expect(commandCount).toBe(0);
  });

  it("maps product and extension overlays only into the build worktree", () => {
    const repoRoot = path.resolve("C:/repo");
    const buildRoot = path.join(
      repoRoot,
      ".lattice-build",
      "code-oss",
      "build-source",
    );

    const plan = buildOverlayPlan(repoRoot, buildRoot);

    expect(plan).toEqual([
      {
        kind: "merge-json",
        source: path.join(
          repoRoot,
          "desktop",
          "code-oss",
          "product",
          "product.json",
        ),
        destination: path.join(buildRoot, "product.json"),
      },
      {
        kind: "copy-directory",
        source: path.join(
          repoRoot,
          "desktop",
          "code-oss",
          "extensions",
          "lattice-workbench",
        ),
        destination: path.join(
          buildRoot,
          "extensions",
          "lattice-workbench",
        ),
      },
      {
        kind: "replace-text",
        source: path.join(
          repoRoot,
          "desktop",
          "code-oss",
          "patches",
          "win32-package-pe-filter.json",
        ),
        destination: path.join(buildRoot, "build", "gulpfile.vscode.ts"),
      },
    ]);
    expect(validateOverlayPlan(plan, buildRoot)).toEqual([]);
  });

  it("rejects overlay destinations outside the build worktree or duplicated", () => {
    const buildRoot = path.resolve("C:/repo/.lattice-build/code-oss/build-source");
    const destination = path.join(buildRoot, "product.json");

    expect(
      validateOverlayPlan(
        [
          { kind: "merge-json", source: "a", destination },
          { kind: "merge-json", source: "b", destination },
          {
            kind: "copy-directory",
            source: "c",
            destination: path.resolve("C:/repo/product.json"),
          },
        ],
        buildRoot,
      ),
    ).toEqual(
      expect.arrayContaining([
        `Overlay destination is duplicated: ${destination}`,
        "Overlay destination must stay inside the build worktree.",
      ]),
    );
  });

  it("applies overlays while preserving upstream product fields", async () => {
    const repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "lattice-code-oss-overlay-"),
    );
    temporaryRoots.push(repoRoot);
    const buildRoot = path.join(
      repoRoot,
      ".lattice-build",
      "code-oss",
      "build-source",
    );
    await fs.mkdir(buildRoot, { recursive: true });
    await fs.writeFile(
      path.join(buildRoot, "product.json"),
      JSON.stringify({
        nameShort: "Code - OSS",
        builtInExtensions: [{ name: "upstream.extension" }],
        upstreamOnly: true,
      }),
    );
    await fs.mkdir(path.join(repoRoot, "desktop", "code-oss"), {
      recursive: true,
    });
    await fs.cp(
      path.resolve("desktop/code-oss/product"),
      path.join(repoRoot, "desktop", "code-oss", "product"),
      { recursive: true },
    );
    await fs.cp(
      path.resolve("desktop/code-oss/extensions"),
      path.join(repoRoot, "desktop", "code-oss", "extensions"),
      { recursive: true },
    );
    await fs.cp(
      path.resolve("desktop/code-oss/patches"),
      path.join(repoRoot, "desktop", "code-oss", "patches"),
      { recursive: true },
    );
    const textPatch = JSON.parse(
      await fs.readFile(
        path.resolve(
          "desktop/code-oss/patches/win32-package-pe-filter.json",
        ),
        "utf8",
      ),
    );
    await fs.mkdir(path.join(buildRoot, "build"), { recursive: true });
    await fs.writeFile(
      path.join(buildRoot, "build", "gulpfile.vscode.ts"),
      `before\n${textPatch.find}\nafter\n`,
    );
    const plan = buildOverlayPlan(repoRoot, buildRoot);
    const manifestPath = path.join(
      repoRoot,
      ".lattice-build",
      "code-oss",
      "overlay-manifest.json",
    );

    const manifest = await applyOverlayPlan(plan, {
      buildRoot,
      stagingRoot: path.join(
        repoRoot,
        ".lattice-build",
        "code-oss",
        "staging",
      ),
      manifestPath,
      now: () => new Date("2026-07-17T01:00:00.000Z"),
    });

    await expect(
      fs.readFile(path.join(buildRoot, "product.json"), "utf8").then(JSON.parse),
    ).resolves.toMatchObject({
      nameShort: "Lattice",
      upstreamOnly: true,
      builtInExtensions: [{ name: "upstream.extension" }],
    });
    await expect(
      fs.stat(
        path.join(
          buildRoot,
          "extensions",
          "lattice-workbench",
          "extension.js",
        ),
      ),
    ).resolves.toMatchObject({});
    await expect(
      fs.readFile(
        path.join(buildRoot, "build", "gulpfile.vscode.ts"),
        "utf8",
      ),
    ).resolves.toContain("signature[0] !== 0x4d");
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-07-17T01:00:00.000Z",
    });
    expect(manifest.entries).toHaveLength(3);
    await expect(
      fs.readFile(manifestPath, "utf8").then(JSON.parse),
    ).resolves.toEqual(manifest);
    await expect(
      inspectAppliedOverlay({
        buildRoot,
        overlayManifestPath: manifestPath,
      }),
    ).resolves.toEqual({ ready: true, errors: [] });
  });

  it("reports an absent or incomplete applied overlay", async () => {
    const repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "lattice-code-oss-overlay-check-"),
    );
    temporaryRoots.push(repoRoot);

    const result = await inspectAppliedOverlay({
      buildRoot: path.join(repoRoot, "build-source"),
      overlayManifestPath: path.join(repoRoot, "overlay-manifest.json"),
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Lattice Code OSS product overlay is missing or invalid.",
        "Lattice Workbench built-in extension is missing.",
        "Code OSS overlay manifest is missing or invalid.",
      ]),
    );
  });

  it("resolves generated source, build, staging, and manifest paths", () => {
    const layout = desktopLayout("C:/repo", PINNED_SOURCE);

    expect(layout).toMatchObject({
      checkoutRoot: path.resolve(
        "C:/repo/.lattice-build/code-oss/source",
      ),
      buildRoot: path.resolve(
        "C:/repo/.lattice-build/code-oss/build-source",
      ),
      stagingRoot: path.resolve("C:/repo/.lattice-build/code-oss/staging"),
      overlayManifestPath: path.resolve(
        "C:/repo/.lattice-build/code-oss/overlay-manifest.json",
      ),
    });
  });

  it("can place the generated build worktree outside the source repository", () => {
    const generatedRoot = path.resolve("C:/lb/LatticeCodeOSS");
    const layout = desktopLayout("C:/repo", PINNED_SOURCE, {
      generatedRoot,
    });

    expect(layout.checkoutRoot).toBe(
      path.resolve("C:/repo/.lattice-build/code-oss/source"),
    );
    expect(layout.buildRoot).toBe(path.join(generatedRoot, "build-source"));
    expect(layout.stagingRoot).toBe(path.join(generatedRoot, "staging"));
    expect(layout.overlayManifestPath).toBe(
      path.join(generatedRoot, "overlay-manifest.json"),
    );
  });

  it("creates a detached build worktree at the pinned commit", () => {
    const layout = desktopLayout("C:/repo", PINNED_SOURCE);

    expect(buildWorktreeCommand(layout, PINNED_SOURCE)).toEqual({
      command: "git",
      args: [
        "-C",
        layout.checkoutRoot,
        "worktree",
        "add",
        "--detach",
        layout.buildRoot,
        PINNED_SOURCE.commit,
      ],
      cwd: layout.repoRoot,
    });
  });

  it("prepares and validates a generated build worktree", async () => {
    const repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "lattice-code-oss-worktree-"),
    );
    temporaryRoots.push(repoRoot);
    const layout = desktopLayout(repoRoot, PINNED_SOURCE);
    const commands = [];

    const result = await prepareCodeOSSBuildWorktree({
      layout,
      source: PINNED_SOURCE,
      mode: "prepare",
      queryGit: async () => PINNED_SOURCE.commit,
      runCommand: async (command) => {
        commands.push(command);
        await fs.mkdir(
          path.join(
            layout.buildRoot,
            "src",
            "vs",
            "code",
            "electron-main",
          ),
          { recursive: true },
        );
        await fs.writeFile(path.join(layout.buildRoot, ".git"), "gitdir");
        await fs.writeFile(path.join(layout.buildRoot, "package.json"), "{}");
        await fs.writeFile(
          path.join(
            layout.buildRoot,
            "src",
            "vs",
            "code",
            "electron-main",
            "main.ts",
          ),
          "export {};\n",
        );
      },
    });

    expect(commands).toEqual([buildWorktreeCommand(layout, PINNED_SOURCE)]);
    expect(result).toEqual({ ready: true, errors: [] });
  });
});
