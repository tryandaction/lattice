import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const TARGETS = [
  ".next",
  "out",
  "output",
  "web-dist",
  ".playwright-cli",
  "test-results",
  "tsconfig.codex.focus.tsbuildinfo",
  "tsconfig.tsbuildinfo",
];

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

async function removeTarget(relativePath, dryRun) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  try {
    const stat = await fs.stat(absolutePath);
    if (dryRun) {
      return {
        path: relativePath,
        existed: true,
        type: stat.isDirectory() ? "directory" : "file",
        removed: false,
      };
    }

    await fs.rm(absolutePath, { recursive: true, force: true });
    return {
      path: relativePath,
      existed: true,
      type: stat.isDirectory() ? "directory" : "file",
      removed: true,
    };
  } catch {
    return {
      path: relativePath,
      existed: false,
      type: "missing",
      removed: false,
    };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = [];

  for (const target of TARGETS) {
    results.push(await removeTarget(target, options.dryRun));
  }

  console.log(
    JSON.stringify(
      {
        dryRun: options.dryRun,
        cleaned: results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
