import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = process.cwd();
const defaultSourceDir = path.join(rootDir, "node_modules", "typescript");
const defaultTargetDir = path.join(
  rootDir,
  "src-tauri",
  "resources",
  "vscode-typescript",
  "typescript",
);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyIfChanged(sourcePath, targetPath) {
  await ensureDir(path.dirname(targetPath));
  try {
    const [source, target] = await Promise.all([
      fs.readFile(sourcePath),
      fs.readFile(targetPath),
    ]);
    if (source.equals(target)) {
      return false;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  await fs.copyFile(sourcePath, targetPath);
  return true;
}

async function copyLibFiles(sourceDir, targetLibDir) {
  let copied = 0;
  const entries = await fs.readdir(path.join(sourceDir, "lib"), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      continue;
    }
    const keep =
      entry.name === "typescript.js" ||
      entry.name === "tsserverlibrary.js" ||
      entry.name.startsWith("lib.") && entry.name.endsWith(".d.ts");
    if (!keep) {
      continue;
    }
    if (await copyIfChanged(
      path.join(sourceDir, "lib", entry.name),
      path.join(targetLibDir, entry.name),
    )) {
      copied += 1;
    }
  }
  return copied;
}

export async function prepareTypeScriptHostResources({
  sourceDir = defaultSourceDir,
  targetDir = defaultTargetDir,
} = {}) {
  const targetLibDir = path.join(targetDir, "lib");
  await ensureDir(targetLibDir);
  let copied = 0;
  if (
    await copyIfChanged(
      path.join(sourceDir, "package.json"),
      path.join(targetDir, "package.json"),
    )
  ) {
    copied += 1;
  }
  if (
    await copyIfChanged(
      path.join(sourceDir, "LICENSE.txt"),
      path.join(targetDir, "LICENSE.txt"),
    )
  ) {
    copied += 1;
  }
  copied += await copyLibFiles(sourceDir, targetLibDir);
  return { copied, targetDir };
}

async function main() {
  const result = await prepareTypeScriptHostResources();
  process.stdout.write(
    `[prepare-typescript-host-resources] TypeScript runtime ready at ${result.targetDir} (${result.copied} files updated)\n`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error("[prepare-typescript-host-resources] failed:", error);
    process.exit(1);
  });
}
