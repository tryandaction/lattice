import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cloudTestRuntimeReady } from "../prepare-cloud-test-runtime.mjs";

const temporaryRoots = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("cloud SQL fixture runtime preparation", () => {
  it("prepares the pinned local SQL runtime before the release test gate", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8"));
    expect(manifest.scripts["prepare:cloud-test-runtime"]).toBe("node scripts/prepare-cloud-test-runtime.mjs");
    expect(manifest.scripts["pretest:run"]).toBe("npm run prepare:cloud-test-runtime");
  });

  it("requires the pinned package and complete entry before reusing an existing install", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "lattice-cloud-sql-test-"));
    temporaryRoots.push(directory);
    const manifest = JSON.stringify({ dependencies: { "@electric-sql/pglite": "0.5.8" } });
    const lock = JSON.stringify({ lockfileVersion: 3 });
    expect(await cloudTestRuntimeReady(directory, manifest, lock)).toBe(false);
    const packageDirectory = path.join(directory, "node_modules", "@electric-sql", "pglite");
    await mkdir(path.join(packageDirectory, "dist"), { recursive: true });
    await writeFile(path.join(directory, "package.json"), manifest);
    await writeFile(path.join(directory, "package-lock.json"), lock);
    await writeFile(path.join(packageDirectory, "package.json"), JSON.stringify({ version: "0.5.8" }));
    expect(await cloudTestRuntimeReady(directory, manifest, lock)).toBe(false);
    await writeFile(path.join(packageDirectory, "dist", "index.js"), "export {}");
    expect(await cloudTestRuntimeReady(directory, manifest, lock)).toBe(true);
    await writeFile(path.join(packageDirectory, "package.json"), JSON.stringify({ version: "0.5.7" }));
    expect(await cloudTestRuntimeReady(directory, manifest, lock)).toBe(false);
  });
});