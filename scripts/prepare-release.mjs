import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, "package.json");
const TAURI_CONFIG_PATH = path.join(ROOT_DIR, "src-tauri", "tauri.conf.json");
const CARGO_TOML_PATH = path.join(ROOT_DIR, "src-tauri", "Cargo.toml");
const DEFAULT_RELEASES_DIR = path.join(ROOT_DIR, "releases");
const DEFAULT_ARTIFACT_SEARCH_ROOT = path.join(ROOT_DIR, "src-tauri", "target", "release");
const PACKAGE_ARTIFACT_EXTENSIONS = new Set([".msi", ".dmg", ".appimage", ".deb"]);

function parseArgs(argv) {
  const options = {
    version: null,
    skipQa: false,
    dryRun: false,
    upload: false,
    artifactsDir: null,
    outputDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--version":
        options.version = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--skip-qa":
        options.skipQa = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--upload":
        options.upload = true;
        break;
      case "--artifacts-dir":
        options.artifactsDir = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--output-dir":
        options.outputDir = argv[index + 1] ?? null;
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readCargoVersion() {
  const cargoToml = await fs.readFile(CARGO_TOML_PATH, "utf8");
  const match = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

async function ensureVersionConsistency(explicitVersion) {
  const normalizedExplicitVersion = explicitVersion?.replace(/^v/, "") ?? null;
  const packageJson = await readJson(PACKAGE_JSON_PATH);
  const tauriConfig = await readJson(TAURI_CONFIG_PATH);
  const cargoVersion = await readCargoVersion();
  const expectedVersion = normalizedExplicitVersion ?? packageJson.version;

  const versions = [
    ["package.json", packageJson.version],
    ["tauri.conf.json", tauriConfig.version],
    ["Cargo.toml", cargoVersion],
  ];

  const mismatched = versions.filter(([, version]) => version !== expectedVersion);
  if (mismatched.length > 0) {
    throw new Error(
      `Version mismatch detected. Expected ${expectedVersion}, got ${mismatched
        .map(([name, version]) => `${name}=${version}`)
        .join(", ")}`,
    );
  }

  return expectedVersion;
}

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

function runCommandCapture(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}: ${stderr.trim()}`));
    });
  });
}

async function ensureArtifacts(options) {
  if (options.artifactsDir) {
    return path.resolve(ROOT_DIR, options.artifactsDir);
  }

  if (options.dryRun) {
    return DEFAULT_ARTIFACT_SEARCH_ROOT;
  }

  if (options.skipQa) {
    await runCommand("npm", ["run", "tauri:build"], "tauri:build");
  } else {
    await runCommand("npm", ["run", "qa:gate"], "qa:gate");
  }

  return DEFAULT_ARTIFACT_SEARCH_ROOT;
}

function normalizeRelativePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function isExcludedArtifactName(fileName) {
  const lowerName = fileName.toLowerCase();
  return (
    lowerName === "build-script-build.exe" ||
    lowerName.startsWith("build_script_build-") ||
    lowerName === "microsoftedgewebview2setup.exe"
  );
}

function isReleaseArtifact(root, filePath, expectedVersion) {
  const fileName = path.basename(filePath);
  const lowerName = fileName.toLowerCase();
  const extension = path.extname(fileName).toLowerCase();
  const relativePath = normalizeRelativePath(path.relative(root, filePath));

  if (isExcludedArtifactName(fileName)) {
    return false;
  }

  if (lowerName === "lattice.exe") {
    return relativePath === "lattice.exe" || relativePath.endsWith("/lattice.exe");
  }

  if (expectedVersion && !fileName.includes(expectedVersion)) {
    return false;
  }

  if (extension === ".exe") {
    return /-setup\.exe$/i.test(fileName);
  }

  return PACKAGE_ARTIFACT_EXTENSIONS.has(extension);
}

async function findArtifacts(directory, expectedVersion) {
  const root = path.resolve(directory);
  const candidates = [];

  async function walk(currentDirectory) {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (isReleaseArtifact(root, fullPath, expectedVersion)) {
        candidates.push(fullPath);
      }
    }
  }

  await walk(root);

  candidates.sort((left, right) => {
    const leftRelative = normalizeRelativePath(path.relative(root, left));
    const rightRelative = normalizeRelativePath(path.relative(root, right));
    const leftDepth = leftRelative.split("/").length;
    const rightDepth = rightRelative.split("/").length;
    return leftDepth - rightDepth || leftRelative.localeCompare(rightRelative);
  });

  const selected = [];
  const seenNames = new Set();
  for (const candidate of candidates) {
    const fileName = path.basename(candidate).toLowerCase();
    if (seenNames.has(fileName)) {
      continue;
    }
    seenNames.add(fileName);
    selected.push(candidate);
  }

  return selected.sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

async function prepareOutputDirectory(outputDir, sourceDirectory, dryRun) {
  if (dryRun) {
    return;
  }

  if (path.resolve(outputDir) !== path.resolve(sourceDirectory)) {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
  await fs.mkdir(outputDir, { recursive: true });
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

async function copyArtifacts(artifacts, outputDir, sourceDirectory, dryRun) {
  const copied = [];
  await prepareOutputDirectory(outputDir, sourceDirectory, dryRun);

  for (const filePath of artifacts) {
    const fileName = path.basename(filePath);
    const outputPath = path.join(outputDir, fileName);
    if (!dryRun) {
      await fs.copyFile(filePath, outputPath);
    }
    const stat = await fs.stat(filePath);
    copied.push({
      fileName,
      sourcePath: filePath,
      outputPath,
      size: stat.size,
      sha256: await sha256(filePath),
    });
  }

  return copied;
}

function buildReleaseSummary(version, artifacts, gitRevision) {
  return [
    `# Release Summary v${version}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Git Revision: ${gitRevision ?? "unknown"}`,
    "",
    "## Artifacts",
    "",
    "| File | Size (bytes) | SHA256 |",
    "|---|---:|---|",
    ...artifacts.map((artifact) => `| ${artifact.fileName} | ${artifact.size} | \`${artifact.sha256}\` |`),
    "",
  ].join("\n");
}

async function writeReleaseMetadata(outputDir, version, artifacts, gitRevision, dryRun) {
  const checksums = artifacts.map((artifact) => `${artifact.sha256}  ${artifact.fileName}`).join("\n");
  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    gitRevision: gitRevision ?? null,
    artifacts: artifacts.map((artifact) => ({
      fileName: artifact.fileName,
      size: artifact.size,
      sha256: artifact.sha256,
      sourcePath: path.relative(ROOT_DIR, artifact.sourcePath),
      outputPath: path.relative(ROOT_DIR, artifact.outputPath),
    })),
  };
  const summary = buildReleaseSummary(version, artifacts, gitRevision);

  if (dryRun) {
    return { manifest, checksums, summary };
  }

  await fs.writeFile(path.join(outputDir, "checksums.txt"), checksums, "utf8");
  await fs.writeFile(path.join(outputDir, "release-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(path.join(outputDir, "RELEASE_SUMMARY.md"), summary, "utf8");
  return { manifest, checksums, summary };
}

async function canUseGhCli() {
  try {
    await runCommand("gh", ["auth", "status"], "gh auth status");
    return true;
  } catch {
    return false;
  }
}

async function uploadDraftRelease(version, artifacts, outputDir) {
  const tag = `v${version}`;
  const files = artifacts.map((artifact) => artifact.outputPath);
  const summaryPath = path.join(outputDir, "RELEASE_SUMMARY.md");
  const manifestPath = path.join(outputDir, "release-manifest.json");
  const checksumPath = path.join(outputDir, "checksums.txt");

  try {
    await runCommand("gh", ["release", "view", tag], `gh release view ${tag}`);
  } catch {
    await runCommand("gh", ["release", "create", tag, "--draft", "--title", `Lattice ${tag}`, "--notes-file", summaryPath], `gh release create ${tag}`);
  }

  await runCommand(
    "gh",
    ["release", "upload", tag, ...files, summaryPath, manifestPath, checksumPath, "--clobber"],
    `gh release upload ${tag}`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const version = await ensureVersionConsistency(options.version);
  const gitRevision = await runCommandCapture("git", ["rev-parse", "HEAD"], "git rev-parse HEAD").catch(() => null);
  const artifactsRoot = await ensureArtifacts(options);
  const discoveredArtifacts = await findArtifacts(artifactsRoot, version);

  if (discoveredArtifacts.length === 0) {
    throw new Error(`No release artifacts found in ${artifactsRoot}`);
  }

  const outputDir = options.outputDir
    ? path.resolve(ROOT_DIR, options.outputDir)
    : path.join(DEFAULT_RELEASES_DIR, `v${version}`);
  const artifacts = await copyArtifacts(discoveredArtifacts, outputDir, artifactsRoot, options.dryRun);
  const metadata = await writeReleaseMetadata(outputDir, version, artifacts, gitRevision, options.dryRun);

  if (options.upload && !options.dryRun) {
    const canUpload = await canUseGhCli();
    if (!canUpload) {
      throw new Error("gh CLI is not authenticated. Run `gh auth login` first.");
    }
    await uploadDraftRelease(version, artifacts, outputDir);
  }

  console.log(
    JSON.stringify(
      {
        version,
        gitRevision,
        outputDir: path.relative(ROOT_DIR, outputDir),
        artifacts: artifacts.map((artifact) => ({
          fileName: artifact.fileName,
          size: artifact.size,
          sha256: artifact.sha256,
        })),
        dryRun: options.dryRun,
        metadata: options.dryRun
          ? metadata
          : {
              manifestPath: path.relative(ROOT_DIR, path.join(outputDir, "release-manifest.json")),
              checksumsPath: path.relative(ROOT_DIR, path.join(outputDir, "checksums.txt")),
              summaryPath: path.relative(ROOT_DIR, path.join(outputDir, "RELEASE_SUMMARY.md")),
            },
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
