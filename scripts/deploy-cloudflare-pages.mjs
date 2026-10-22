import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
if (process.argv.slice(2).some(arg => arg !== "--dry-run")) throw new Error("Usage: node scripts/deploy-cloudflare-pages.mjs [--dry-run]");
const config = JSON.parse(await readFile(path.join(root, "wrangler.json"), "utf8"));
const targetConfig = JSON.parse(await readFile(path.join(root, "wrangler.deployment.json"), "utf8"));
if (!/^[a-z0-9-]+$/.test(config.name) || !targetConfig.account_id || targetConfig.project !== config.name || targetConfig.branch !== "main" || config.pages_build_output_dir !== "./web-dist") throw new Error("Invalid Pages production target.");
const directory = path.join(root, "web-dist");
// A partial export must never replace the working production site.
const index = await readFile(path.join(directory, "index.html"));
await stat(path.join(directory, "library.html"));
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const release = {
  version,
  indexSha256: createHash("sha256").update(index).digest("hex"),
  builtAt: (await stat(path.join(directory, "index.html"))).mtime.toISOString(),
};
const target = { accountId: targetConfig.account_id, project: config.name, branch: targetConfig.branch, ...release, dryRun };
console.log(JSON.stringify(target, null, 2));

if (!dryRun) {
  await writeFile(path.join(directory, "build-info.json"), JSON.stringify(release, null, 2) + "\n");
  const run = args => new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", ...args], {
      cwd: root, stdio: "inherit", windowsHide: true, shell: process.platform === "win32",
      // Old global environment/cache values must not silently choose another account.
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: targetConfig.account_id },
    });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Wrangler exited with code ${code}.`)));
  });
  await run(["whoami"]);
  await run(["pages", "deploy", "web-dist", "--project-name", config.name, "--branch", targetConfig.branch, "--commit-dirty=true"]);
}
