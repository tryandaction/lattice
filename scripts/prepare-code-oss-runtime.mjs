import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const NATIVE_BUILD_INTERMEDIATE_EXTENSIONS = new Set([
  ".exp",
  ".iobj",
  ".ipdb",
  ".lib",
  ".pdb",
]);
const WINDOWS_INSTALL_PATH_LIMIT = 250;
const CONSERVATIVE_WINDOWS_INSTALL_ROOT = path.win32.join(
  "C:\\Users",
  "x".repeat(32),
  "AppData",
  "Local",
  "Lattice",
  "code-oss-runtime",
);

export async function readRuntimeSource(sourcePath) {
  return JSON.parse(await fs.readFile(sourcePath, "utf8"));
}

export function validateRuntimeSource(source) {
  const errors = [];
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return ["Runtime source must be a JSON object."];
  }
  if (source.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1.");
  }
  if (source.distribution !== "code-server") {
    errors.push('distribution must be "code-server".');
  }
  if (!VERSION_PATTERN.test(source.runtimeVersion ?? "")) {
    errors.push("runtimeVersion must be a semantic version.");
  }
  if (!VERSION_PATTERN.test(source.codeOssVersion ?? "")) {
    errors.push("codeOssVersion must be a semantic version.");
  }
  if (!Number.isInteger(source.nodeMajor) || source.nodeMajor < 1) {
    errors.push("nodeMajor must be a positive integer.");
  }
  try {
    const packageUrl = new URL(source.packageUrl);
    if (
      packageUrl.protocol !== "https:" ||
      packageUrl.hostname !== "github.com" ||
      !packageUrl.pathname.startsWith("/coder/code-server/releases/download/")
    ) {
      errors.push("packageUrl must reference an HTTPS coder/code-server release.");
    }
  } catch {
    errors.push("packageUrl must be a valid URL.");
  }
  if (!SHA256_PATTERN.test(source.packageSha256 ?? "")) {
    errors.push("packageSha256 must be a lowercase SHA-256 digest.");
  }
  const entrypoint = source.entrypoint;
  if (
    typeof entrypoint !== "string" ||
    entrypoint.length === 0 ||
    path.isAbsolute(entrypoint) ||
    entrypoint.split(/[\\/]+/).includes("..")
  ) {
    errors.push("entrypoint must be a relative path inside the runtime root.");
  }
  return errors;
}

export function runtimeLayout(
  runtimeRoot,
  { platform = process.platform } = {},
) {
  const root = path.resolve(runtimeRoot);
  const vscodeNodeModules = path.join(
    root,
    "node_modules",
    "code-server",
    "lib",
    "vscode",
    "node_modules",
  );
  return {
    root,
    nodeExecutable: path.join(
      root,
      "bin",
      platform === "win32" ? "node.exe" : "node",
    ),
    entrypoint: path.join(
      root,
      "node_modules",
      "code-server",
      "out",
      "node",
      "entry.js",
    ),
    provisionManifest: path.join(root, "provision-manifest.json"),
    requiredModules: [
      path.join(root, "node_modules", "@vscode", "fs-copyfile", "package.json"),
    ],
    nativeBindings:
      platform === "win32"
        ? [
            path.join(
              vscodeNodeModules,
              "@vscode",
              "spdlog",
              "build",
              "Release",
              "spdlog.node",
            ),
            path.join(
              vscodeNodeModules,
              "@vscode",
              "deviceid",
              "build",
              "Release",
              "windows.node",
            ),
            path.join(
              vscodeNodeModules,
              "@vscode",
              "windows-registry",
              "build",
              "Release",
              "winregistry.node",
            ),
          ]
        : [],
  };
}

export function sourceFingerprint(source) {
  const canonical = JSON.stringify({
    schemaVersion: source.schemaVersion,
    distribution: source.distribution,
    runtimeVersion: source.runtimeVersion,
    codeOssVersion: source.codeOssVersion,
    nodeMajor: source.nodeMajor,
    packageUrl: source.packageUrl,
    packageSha256: source.packageSha256,
    entrypoint: source.entrypoint,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

async function fileExists(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readDirectoryIfPresent(directoryPath) {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function pruneRuntimeBuildArtifacts(runtimeRoot) {
  const nativeModulesRoot = path.join(
    path.resolve(runtimeRoot),
    "node_modules",
    "code-server",
    "lib",
    "vscode",
    "node_modules",
    "@vscode",
  );
  const packageEntries = await readDirectoryIfPresent(nativeModulesRoot);

  for (const packageEntry of packageEntries) {
    if (!packageEntry.isDirectory()) {
      continue;
    }
    const buildRoot = path.join(nativeModulesRoot, packageEntry.name, "build");
    await Promise.all([
      fs.rm(path.join(buildRoot, "node_modules"), {
        recursive: true,
        force: true,
      }),
      fs.rm(path.join(buildRoot, "Release", "obj"), {
        recursive: true,
        force: true,
      }),
      fs.rm(path.join(buildRoot, "Debug", "obj"), {
        recursive: true,
        force: true,
      }),
    ]);

    for (const configuration of ["Release", "Debug"]) {
      const configurationRoot = path.join(buildRoot, configuration);
      const buildEntries = await readDirectoryIfPresent(configurationRoot);
      await Promise.all(
        buildEntries
          .filter(
            (entry) =>
              entry.isFile() &&
              NATIVE_BUILD_INTERMEDIATE_EXTENSIONS.has(
                path.extname(entry.name).toLowerCase(),
              ),
          )
          .map((entry) =>
            fs.rm(path.join(configurationRoot, entry.name), { force: true }),
          ),
      );
    }
  }
}

export function findUnsafeRuntimeInstallPaths(
  relativePaths,
  {
    installRoot = CONSERVATIVE_WINDOWS_INSTALL_ROOT,
    maxPathLength = WINDOWS_INSTALL_PATH_LIMIT,
  } = {},
) {
  return relativePaths
    .map((relativePath) => {
      const targetPath = path.win32.join(
        installRoot,
        String(relativePath).replaceAll("/", "\\"),
      );
      return { relativePath, targetPath, pathLength: targetPath.length };
    })
    .filter(({ pathLength }) => pathLength > maxPathLength)
    .sort((left, right) => right.pathLength - left.pathLength);
}

async function collectRuntimeRelativeFiles(
  runtimeRoot,
  currentDirectory = runtimeRoot,
  collected = [],
) {
  const entries = await readDirectoryIfPresent(currentDirectory);
  for (const entry of entries) {
    const entryPath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      await collectRuntimeRelativeFiles(runtimeRoot, entryPath, collected);
    } else if (entry.isFile()) {
      collected.push(path.relative(runtimeRoot, entryPath));
    }
  }
  return collected;
}

async function assertRuntimeInstallPathsAreSafe(runtimeRoot) {
  const resolvedRoot = path.resolve(runtimeRoot);
  const relativePaths = await collectRuntimeRelativeFiles(resolvedRoot);
  const unsafePaths = findUnsafeRuntimeInstallPaths(relativePaths);
  if (unsafePaths.length === 0) {
    return;
  }
  const sample = unsafePaths
    .slice(0, 5)
    .map(({ pathLength, relativePath }) => `${pathLength}: ${relativePath}`)
    .join("; ");
  throw new Error(
    `Code OSS runtime contains ${unsafePaths.length} Windows installer path(s) longer than ${WINDOWS_INSTALL_PATH_LIMIT} characters. ${sample}`,
  );
}

export async function inspectProvisionedRuntime(
  runtimeRoot,
  source,
  { platform = process.platform, arch = process.arch } = {},
) {
  const layout = runtimeLayout(runtimeRoot, { platform });
  const errors = [];
  if (!(await fileExists(layout.nodeExecutable))) {
    errors.push("Bundled Node executable is missing.");
  }
  if (!(await fileExists(layout.entrypoint))) {
    errors.push("Code OSS server entrypoint is missing.");
  }
  for (const modulePath of layout.requiredModules) {
    if (!(await fileExists(modulePath))) {
      errors.push(
        `Code OSS runtime module is missing: ${path.relative(layout.root, modulePath)}.`,
      );
    }
  }
  for (const binding of layout.nativeBindings) {
    if (!(await fileExists(binding))) {
      errors.push(
        `Code OSS native binding is missing: ${path.relative(layout.root, binding)}.`,
      );
    }
  }

  const packageJson = await readJsonIfPresent(
    path.join(layout.root, "node_modules", "code-server", "package.json"),
  );
  if (!packageJson) {
    errors.push("Installed code-server package metadata is missing.");
  } else if (packageJson.version !== source.runtimeVersion) {
    errors.push(
      `Installed code-server version ${packageJson.version ?? "unknown"} does not match ${source.runtimeVersion}.`,
    );
  }

  const manifest = await readJsonIfPresent(layout.provisionManifest);
  if (!manifest) {
    errors.push("Provision manifest is missing.");
  } else {
    const expected = {
      schemaVersion: 1,
      sourceFingerprint: sourceFingerprint(source),
      distribution: source.distribution,
      runtimeVersion: source.runtimeVersion,
      codeOssVersion: source.codeOssVersion,
      platform,
      arch,
      entrypoint: source.entrypoint,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (manifest[key] !== value) {
        errors.push(`Provision manifest ${key} does not match the runtime source.`);
      }
    }
    const nodeMajor = Number.parseInt(String(manifest.nodeVersion).split(".")[0], 10);
    if (nodeMajor !== source.nodeMajor) {
      errors.push(`Provisioned Node major must be ${source.nodeMajor}.`);
    }
  }

  return { ready: errors.length === 0, errors, layout, manifest };
}

export function buildCommandInvocation(
  command,
  args,
  { platform = process.platform, comspec = process.env.ComSpec } = {},
) {
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    return {
      command: comspec || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }
  return { command, args };
}

export function buildProvisionCommands(runtimeRoot) {
  const root = path.resolve(runtimeRoot);
  const vscodeRoot = path.join(
    root,
    "node_modules",
    "code-server",
    "lib",
    "vscode",
  );
  return [
    {
      cwd: root,
      args: ["install", "--omit=dev", "--ignore-scripts"],
    },
    {
      cwd: root,
      args: ["rebuild", "argon2"],
    },
    {
      cwd: vscodeRoot,
      args: ["install", "--omit=dev"],
    },
    {
      cwd: vscodeRoot,
      args: [
        "rebuild",
        "@vscode/spdlog",
        "@vscode/deviceid",
        "@vscode/windows-registry",
      ],
    },
    {
      cwd: path.join(vscodeRoot, "extensions"),
      args: ["install", "--omit=dev"],
    },
  ];
}

function runCommand(command, args, options = {}) {
  const invocation = buildCommandInvocation(command, args, options);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      stdio: "inherit",
      windowsHide: true,
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}

async function verifySourceArchive(source) {
  const response = await fetch(source.packageUrl);
  if (!response.ok) {
    throw new Error(`Unable to download Code OSS runtime source: HTTP ${response.status}.`);
  }
  const digest = createHash("sha256")
    .update(Buffer.from(await response.arrayBuffer()))
    .digest("hex");
  if (digest !== source.packageSha256) {
    throw new Error(
      `Code OSS runtime source checksum mismatch: expected ${source.packageSha256}, got ${digest}.`,
    );
  }
}

export async function prepareCodeOSSRuntime({
  runtimeRoot = path.resolve("src-tauri/code-oss-runtime"),
  sourcePath = path.resolve("src-tauri/code-oss-runtime/runtime-source.json"),
  check = false,
  platform = process.platform,
  arch = process.arch,
  nodeExecutable = process.execPath,
} = {}) {
  const source = await readRuntimeSource(sourcePath);
  const sourceErrors = validateRuntimeSource(source);
  if (sourceErrors.length > 0) {
    throw new Error(sourceErrors.join(" "));
  }

  await pruneRuntimeBuildArtifacts(runtimeRoot);
  const current = await inspectProvisionedRuntime(runtimeRoot, source, {
    platform,
    arch,
  });
  if (current.ready) {
    if (platform === "win32") {
      await assertRuntimeInstallPathsAreSafe(runtimeRoot);
    }
    return current;
  }
  if (check) {
    throw new Error(current.errors.join(" "));
  }

  const nodeVersion = process.versions.node;
  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0], 10);
  if (nodeMajor !== source.nodeMajor) {
    throw new Error(
      `Code OSS runtime provisioning requires Node ${source.nodeMajor}; current Node is ${nodeVersion}.`,
    );
  }

  await verifySourceArchive(source);
  const npmCommand = platform === "win32" ? "npm.cmd" : "npm";
  for (const command of buildProvisionCommands(runtimeRoot)) {
    await runCommand(npmCommand, command.args, {
      cwd: command.cwd,
      platform,
    });
  }

  await pruneRuntimeBuildArtifacts(runtimeRoot);
  if (platform === "win32") {
    await assertRuntimeInstallPathsAreSafe(runtimeRoot);
  }

  const layout = runtimeLayout(runtimeRoot, { platform });
  await fs.mkdir(path.dirname(layout.nodeExecutable), { recursive: true });
  await fs.copyFile(nodeExecutable, layout.nodeExecutable);
  const manifest = {
    schemaVersion: 1,
    sourceFingerprint: sourceFingerprint(source),
    distribution: source.distribution,
    runtimeVersion: source.runtimeVersion,
    codeOssVersion: source.codeOssVersion,
    nodeVersion,
    platform,
    arch,
    entrypoint: source.entrypoint,
    generatedAt: new Date().toISOString(),
  };
  const temporaryManifest = `${layout.provisionManifest}.tmp`;
  await fs.writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.rename(temporaryManifest, layout.provisionManifest);

  const provisioned = await inspectProvisionedRuntime(runtimeRoot, source, {
    platform,
    arch,
  });
  if (!provisioned.ready) {
    throw new Error(provisioned.errors.join(" "));
  }
  return provisioned;
}

async function main() {
  const runtimeRoot = path.resolve("src-tauri/code-oss-runtime");
  const check = process.argv.includes("--check");
  const result = await prepareCodeOSSRuntime({
    runtimeRoot,
    sourcePath: path.join(runtimeRoot, "runtime-source.json"),
    check,
  });
  process.stdout.write(
    `[prepare-code-oss-runtime] code-server ${result.manifest.runtimeVersion} with Node ${result.manifest.nodeVersion} is ready\n`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error("[prepare-code-oss-runtime] failed:", error);
    process.exitCode = 1;
  });
}
