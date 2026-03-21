/**
 * @vitest-environment node
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lattice-release-"));
  tempDirs.push(dir);
  return dir;
}

describe("prepare-release script", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("supports dry-run metadata generation from an artifacts directory", async () => {
    const artifactsDir = await createTempDir();
    await writeFile(path.join(artifactsDir, "lattice.exe"), "binary");
    await writeFile(path.join(artifactsDir, "Lattice_2.0.0_x64_en-US.msi"), "msi");

    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "prepare-release.mjs"),
        "--version",
        "2.0.0",
        "--dry-run",
        "--artifacts-dir",
        artifactsDir,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.version).toBe("2.0.0");
    expect(payload.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: "lattice.exe" }),
        expect.objectContaining({ fileName: "Lattice_2.0.0_x64_en-US.msi" }),
      ]),
    );
    expect(payload.metadata.manifest.version).toBe("2.0.0");
    expect(payload.metadata.checksums).toContain("lattice.exe");
    expect(payload.metadata.summary).toContain("# Release Summary v2.0.0");
  });

  it("filters helper executables when scanning a target release tree", async () => {
    const artifactsDir = await createTempDir();
    await writeFile(path.join(artifactsDir, "lattice.exe"), "binary");
    await writeFile(path.join(artifactsDir, "build-script-build.exe"), "helper");
    await writeFile(path.join(artifactsDir, "build_script_build-abc123.exe"), "helper");
    await writeFile(path.join(artifactsDir, "MicrosoftEdgeWebview2Setup.exe"), "webview");

    const nsisDir = path.join(artifactsDir, "bundle", "nsis");
    const msiDir = path.join(artifactsDir, "bundle", "msi");
    await mkdir(nsisDir, { recursive: true });
    await mkdir(msiDir, { recursive: true });
    await writeFile(path.join(nsisDir, "Lattice_2.0.0_x64-setup.exe"), "setup");
    await writeFile(path.join(msiDir, "Lattice_2.0.0_x64_en-US.msi"), "msi");
    await writeFile(path.join(nsisDir, "MicrosoftEdgeWebview2Setup.exe"), "webview");

    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "prepare-release.mjs"),
        "--version",
        "2.0.0",
        "--dry-run",
        "--artifacts-dir",
        artifactsDir,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.artifacts.map((artifact: { fileName: string }) => artifact.fileName)).toEqual([
      "Lattice_2.0.0_x64_en-US.msi",
      "Lattice_2.0.0_x64-setup.exe",
      "lattice.exe",
    ]);
  });
});
