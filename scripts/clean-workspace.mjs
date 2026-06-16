import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(process.cwd());
const TARGETS = [
  ".next",
  "out",
  "output",
  "web-dist",
  "web-dist-dev",
  ".playwright-cli",
  "test-results",
  "tsconfig.codex.focus.tsbuildinfo",
  "tsconfig.tsbuildinfo",
];
const ROOT_NAME_PATTERNS = [
  /^web-dist-browser-regression(?:-|$)/,
  /^web-dist-probe$/,
  /^\.tmp-.*\.log$/,
  /^lattice-.*\.log$/,
];
const CODEX_TMP_LOG_PATTERN = /\.log$/;

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    includeCodexTmpLogs: argv.includes("--include-codex-tmp-logs"),
  };
}

function assertInsideRoot(absolutePath) {
  const normalizedRoot = ROOT_DIR.toLowerCase();
  const normalizedPath = path.resolve(absolutePath).toLowerCase();
  if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Refusing to clean path outside workspace: ${absolutePath}`);
  }
}

async function pathExists(absolutePath) {
  try {
    return await fs.stat(absolutePath);
  } catch {
    return null;
  }
}

async function collectPatternTargets() {
  const entries = await fs.readdir(ROOT_DIR, { withFileTypes: true });
  const rootMatches = entries
    .filter((entry) => ROOT_NAME_PATTERNS.some((pattern) => pattern.test(entry.name)))
    .map((entry) => entry.name);

  return [...new Set([...TARGETS, ...rootMatches])].sort((left, right) => left.localeCompare(right));
}

async function collectCodexTmpLogTargets() {
  const codexTmpPath = path.join(ROOT_DIR, ".codex_tmp");
  const stat = await pathExists(codexTmpPath);
  if (!stat?.isDirectory()) {
    return [];
  }

  const entries = await fs.readdir(codexTmpPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && CODEX_TMP_LOG_PATTERN.test(entry.name))
    .map((entry) => path.join(".codex_tmp", entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function removeTarget(relativePath, dryRun) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  assertInsideRoot(absolutePath);
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
  const targets = await collectPatternTargets();
  if (options.includeCodexTmpLogs) {
    targets.push(...await collectCodexTmpLogTargets());
  }

  for (const target of [...new Set(targets)].sort((left, right) => left.localeCompare(right))) {
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
