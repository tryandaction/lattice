import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareTypeScriptHostResources } from "../prepare-typescript-host-resources.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ),
  );
});

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-typescript-runtime-"));
  temporaryRoots.push(root);
  const sourceDir = path.join(root, "source");
  const targetDir = path.join(root, "target");
  await fs.mkdir(path.join(sourceDir, "lib"), { recursive: true });
  await fs.writeFile(path.join(sourceDir, "package.json"), '{"version":"1.0.0"}');
  await fs.writeFile(path.join(sourceDir, "LICENSE.txt"), "license");
  await fs.writeFile(path.join(sourceDir, "lib", "typescript.js"), "runtime");
  await fs.writeFile(path.join(sourceDir, "lib", "lib.es2024.d.ts"), "types");
  await fs.writeFile(path.join(sourceDir, "lib", "ignored.js"), "ignored");
  return { sourceDir, targetDir };
}

describe("prepare-typescript-host-resources", () => {
  it("does not rewrite unchanged prepared resources", async () => {
    const fixture = await createFixture();
    await prepareTypeScriptHostResources(fixture);
    const target = path.join(fixture.targetDir, "lib", "typescript.js");
    const stableTime = new Date("2026-01-02T03:04:05.000Z");
    await fs.utimes(target, stableTime, stableTime);

    const result = await prepareTypeScriptHostResources(fixture);

    expect(result.copied).toBe(0);
    expect((await fs.stat(target)).mtime.toISOString()).toBe(stableTime.toISOString());
  });

  it("updates a prepared resource when its source changes", async () => {
    const fixture = await createFixture();
    await prepareTypeScriptHostResources(fixture);
    await fs.writeFile(
      path.join(fixture.sourceDir, "lib", "typescript.js"),
      "updated runtime",
    );

    const result = await prepareTypeScriptHostResources(fixture);

    expect(result.copied).toBe(1);
    await expect(
      fs.readFile(path.join(fixture.targetDir, "lib", "typescript.js"), "utf8"),
    ).resolves.toBe("updated runtime");
  });
});
