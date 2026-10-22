/**
 * @vitest-environment node
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../../package.json";

const tempDirs: string[] = [];
const APP_VERSION = packageJson.version;

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
    await writeFile(path.join(artifactsDir, `Lattice_${APP_VERSION}_x64_en-US.msi`), "msi");

    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "prepare-release.mjs"),
        "--version",
        APP_VERSION,
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
    expect(payload.version).toBe(APP_VERSION);
    expect(payload.verification).toBe("not-verified-dry-run");
    expect(payload.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: "lattice.exe" }),
        expect.objectContaining({ fileName: `Lattice_${APP_VERSION}_x64_en-US.msi` }),
      ]),
    );
    expect(payload.metadata.manifest.version).toBe(APP_VERSION);
    expect(typeof payload.gitDirty).toBe("boolean");
    expect(typeof payload.metadata.manifest.gitDirty).toBe("boolean");
    expect(payload.metadata.checksums).toContain("lattice.exe");
    expect(payload.metadata.summary).toContain(`# Release Summary v${APP_VERSION}`);
    expect(payload.metadata.summary).toContain("Git Dirty:");
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
    await writeFile(path.join(nsisDir, `Lattice_${APP_VERSION}_x64-setup.exe`), "setup");
    await writeFile(path.join(msiDir, `Lattice_${APP_VERSION}_x64_en-US.msi`), "msi");
    await writeFile(path.join(nsisDir, "MicrosoftEdgeWebview2Setup.exe"), "webview");
    for (const version of ["2.3.2", `1${APP_VERSION}`, `${APP_VERSION}1`, `${APP_VERSION}.1`, `${APP_VERSION}-beta`]) {
      await writeFile(path.join(msiDir, `Lattice_${version}_x64_en-US.msi`), "wrong-version");
    }

    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "prepare-release.mjs"),
        "--version",
        APP_VERSION,
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
      `Lattice_${APP_VERSION}_x64_en-US.msi`,
      `Lattice_${APP_VERSION}_x64-setup.exe`,
      "lattice.exe",
    ]);
  });

  it("rejects missing current-version installers before touching the output directory", async () => {
    const artifactsDir = await createTempDir();
    const outputDir = await createTempDir();
    await writeFile(path.join(artifactsDir, "lattice.exe"), "old-binary");
    await writeFile(path.join(artifactsDir, "Lattice_2.3.2_x64_en-US.msi"), "old-msi");
    await writeFile(path.join(outputDir, "sentinel.txt"), "preserve");
    const result = spawnSync(process.execPath, ["scripts/prepare-release.mjs", "--artifacts-dir", artifactsDir, "--output-dir", outputDir], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`No installer matching version ${APP_VERSION}`);
    expect(await readFile(path.join(outputDir, "sentinel.txt"), "utf8")).toBe("preserve");
  });

  it("rejects an unversioned executable before copying or clearing output", async () => {
    const artifactsDir = await createTempDir();
    const outputDir = await createTempDir();
    await writeFile(path.join(artifactsDir, "lattice.exe"), "not-a-PE-file");
    await writeFile(path.join(artifactsDir, `Lattice_${APP_VERSION}_x64_en-US.msi`), "msi");
    await writeFile(path.join(outputDir, "sentinel.txt"), "preserve");
    const result = spawnSync(process.execPath, ["scripts/prepare-release.mjs", "--artifacts-dir", artifactsDir, "--output-dir", outputDir], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ProductVersion mismatch|PE version verification failed|verification requires Windows/);
    expect(await readFile(path.join(outputDir, "sentinel.txt"), "utf8")).toBe("preserve");
  });
});
