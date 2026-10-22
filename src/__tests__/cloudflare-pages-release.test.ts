/** @vitest-environment node */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporary: string[] = [];
const script = path.resolve("scripts/deploy-cloudflare-pages.mjs");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lattice-pages-"));
  temporary.push(root);
  await mkdir(path.join(root, "web-dist"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "3.1.0" }));
  await writeFile(path.join(root, "wrangler.json"), JSON.stringify({
    name: "lattice-apq", pages_build_output_dir: "./web-dist",
  }));
  await writeFile(path.join(root, "wrangler.deployment.json"), JSON.stringify({ account_id: "current-account", project: "lattice-apq", branch: "main" }));
  await writeFile(path.join(root, "web-dist/index.html"), "<html>current workbench</html>");
  await writeFile(path.join(root, "web-dist/library.html"), "<html>shared library</html>");
  return root;
}

function preview(root: string) {
  return spawnSync(process.execPath, [script, "--dry-run"], {
    cwd: root, encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "stale-account" },
  });
}

describe("Cloudflare Pages release preflight", () => {
  afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

  it("uses the configured production account and project despite stale CLI environment", async () => {
    const root = await fixture();
    const result = preview(root);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      accountId: "current-account", project: "lattice-apq", branch: "main", version: "3.1.0", dryRun: true,
    });
    await expect(readFile(path.join(root, "web-dist/build-info.json"))).rejects.toThrow();
  });

  it("refuses a partial export that has no shared-library entry", async () => {
    const root = await fixture();
    await rm(path.join(root, "web-dist/library.html"));
    const result = preview(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("library.html");
  });

  it("refuses a target whose project differs from the standard Pages config", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "wrangler.deployment.json"), JSON.stringify({ account_id: "current-account", project: "other-project", branch: "main" }));
    const result = preview(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid Pages production target");
  });
});
