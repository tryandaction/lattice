import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OFFICIAL_REPOSITORY = "https://github.com/microsoft/vscode.git";
const RELEASE_TAG_PATTERN = /^\d+\.\d+\.\d+$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export async function readSourceContract(sourcePath) {
  return JSON.parse(await fs.readFile(sourcePath, "utf8"));
}

export function validateSourceContract(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return ["Code OSS source contract must be a JSON object."];
  }

  const errors = [];
  if (source.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1.");
  }
  if (source.repository !== OFFICIAL_REPOSITORY) {
    errors.push(`repository must be "${OFFICIAL_REPOSITORY}".`);
  }
  if (!RELEASE_TAG_PATTERN.test(source.tag ?? "")) {
    errors.push("tag must be a numeric Code OSS release tag.");
  }
  if (!COMMIT_PATTERN.test(source.commit ?? "")) {
    errors.push("commit must be a lowercase 40-character Git commit.");
  }
  if (!RELEASE_TAG_PATTERN.test(source.buildNodeVersion ?? "")) {
    errors.push("buildNodeVersion must be a semantic Node version.");
  }
  try {
    const nodeUrl = new URL(source.buildNodeUrl);
    if (
      nodeUrl.protocol !== "https:" ||
      nodeUrl.hostname !== "nodejs.org" ||
      nodeUrl.pathname !==
        `/dist/v${source.buildNodeVersion}/node-v${source.buildNodeVersion}-win-x64.zip`
    ) {
      errors.push(
        "buildNodeUrl must reference the pinned official Windows x64 Node archive.",
      );
    }
  } catch {
    errors.push("buildNodeUrl must be a valid URL.");
  }
  if (!SHA256_PATTERN.test(source.buildNodeSha256 ?? "")) {
    errors.push("buildNodeSha256 must be a lowercase SHA-256 digest.");
  }

  const checkoutDirectory = source.checkoutDirectory;
  if (
    typeof checkoutDirectory !== "string" ||
    checkoutDirectory.length === 0 ||
    path.isAbsolute(checkoutDirectory) ||
    checkoutDirectory.split(/[\\/]+/).includes("..")
  ) {
    errors.push("checkoutDirectory must stay inside the repository root.");
  }
  return errors;
}

export function sourceLayout(repoRoot, source) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const checkoutRoot = path.resolve(
    resolvedRepoRoot,
    source.checkoutDirectory,
  );
  const relativeCheckout = path.relative(resolvedRepoRoot, checkoutRoot);
  if (
    relativeCheckout === ".." ||
    relativeCheckout.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeCheckout)
  ) {
    throw new Error("Code OSS checkout must stay inside the repository root.");
  }

  return {
    repoRoot: resolvedRepoRoot,
    checkoutRoot,
    overlayRoot: path.join(resolvedRepoRoot, "desktop", "code-oss"),
    stampPath: path.join(
      resolvedRepoRoot,
      ".lattice-build",
      "code-oss",
      "source-stamp.json",
    ),
  };
}

export function desktopLayout(repoRoot, source, { generatedRoot } = {}) {
  const sourcePaths = sourceLayout(repoRoot, source);
  const resolvedGeneratedRoot = path.resolve(
    generatedRoot ??
      path.join(sourcePaths.repoRoot, ".lattice-build", "code-oss"),
  );
  return {
    ...sourcePaths,
    generatedRoot: resolvedGeneratedRoot,
    buildRoot: path.join(resolvedGeneratedRoot, "build-source"),
    stagingRoot: path.join(resolvedGeneratedRoot, "staging"),
    overlayManifestPath: path.join(
      resolvedGeneratedRoot,
      "overlay-manifest.json",
    ),
  };
}

export function buildToolchainLayout(repoRoot, source, { generatedRoot } = {}) {
  const resolvedGeneratedRoot = path.resolve(
    generatedRoot ?? path.join(repoRoot, ".lattice-build", "code-oss"),
  );
  const archiveName = `node-v${source.buildNodeVersion}-win-x64.zip`;
  const runtimeName = `node-v${source.buildNodeVersion}-win-x64`;
  const runtimeRoot = path.join(resolvedGeneratedRoot, "tools", runtimeName);
  return {
    archivePath: path.join(resolvedGeneratedRoot, "tools", archiveName),
    runtimeRoot,
    nodeExecutable: path.join(runtimeRoot, "node.exe"),
    npmCommand: path.join(runtimeRoot, "npm.cmd"),
    npmCli: path.join(runtimeRoot, "node_modules", "npm", "bin", "npm-cli.js"),
    logRoot: path.join(resolvedGeneratedRoot, "logs"),
    distributionRoot: path.join(
      resolvedGeneratedRoot,
      "VSCode-win32-x64",
    ),
  };
}

export function buildDesktopCommands(desktop, tools) {
  return [
    {
      command: tools.nodeExecutable,
      args: [tools.npmCli, "ci"],
      cwd: desktop.buildRoot,
      logPath: path.join(tools.logRoot, "npm-ci.log"),
    },
    {
      command: tools.nodeExecutable,
      args: [tools.npmCli, "run", "gulp", "vscode-win32-x64"],
      cwd: desktop.buildRoot,
      logPath: path.join(tools.logRoot, "vscode-win32-x64.log"),
    },
  ];
}

export function validateBuildPrerequisites(environment, source) {
  const errors = [];
  if (environment.platform !== "win32" || environment.arch !== "x64") {
    errors.push("Phase 1 Code OSS desktop builds require Windows x64.");
  }
  if (environment.nodeVersion !== source.buildNodeVersion) {
    errors.push(
      `Code OSS build requires portable Node ${source.buildNodeVersion}.`,
    );
  }
  if (!environment.gitAvailable) {
    errors.push("Git is required to build Code OSS.");
  }
  if (!/^3(?:\.|$)/.test(environment.pythonVersion ?? "")) {
    errors.push("Python 3 is required to build Code OSS native modules.");
  }
  if (!environment.msbuildAvailable) {
    errors.push("Visual Studio C++ Build Tools are required to build Code OSS.");
  }
  if (!environment.signtoolAvailable) {
    errors.push("Windows SDK signtool.exe is required to package Code OSS.");
  }
  if (!Number.isFinite(environment.freeBytes) || environment.freeBytes < 20 * 1024 ** 3) {
    errors.push("At least 20 GB of free disk space is required to build Code OSS.");
  }
  return errors;
}

export function createBuildEnvironment(tools, environment, baseEnvironment) {
  const currentPath =
    baseEnvironment.Path ?? baseEnvironment.PATH ?? baseEnvironment.path ?? "";
  const sanitizedEnvironment = Object.fromEntries(
    Object.entries(baseEnvironment).filter(
      ([key]) => key.toLowerCase() !== "path",
    ),
  );
  return {
    ...sanitizedEnvironment,
    Path: [tools.runtimeRoot, environment.windowsSdkBin, currentPath]
      .filter(Boolean)
      .join(path.delimiter),
    npm_config_python: environment.pythonExecutable,
    npm_config_msvs_version: environment.visualStudioVersion,
    GYP_MSVS_VERSION: environment.visualStudioVersion,
  };
}

export function selectWindowsSdkBin(signtoolPaths) {
  const candidates = signtoolPaths
    .map((signtoolPath) => {
      const resolvedPath = path.resolve(signtoolPath);
      const match = resolvedPath.match(
        /[\\/]bin[\\/](\d+\.\d+\.\d+\.\d+)[\\/]x64[\\/]signtool\.exe$/i,
      );
      if (!match) {
        return null;
      }
      return {
        directory: path.dirname(resolvedPath),
        version: match[1].split(".").map(Number),
      };
    })
    .filter(Boolean);
  candidates.sort((left, right) => {
    for (let index = 0; index < 4; index += 1) {
      const difference = right.version[index] - left.version[index];
      if (difference !== 0) {
        return difference;
      }
    }
    return 0;
  });
  return candidates[0]?.directory ?? null;
}

export async function findWindowsSdkBin(
  programFilesX86 =
    process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
) {
  const binRoot = path.join(programFilesX86, "Windows Kits", "10", "bin");
  let versions;
  try {
    versions = await fs.readdir(binRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const version of versions) {
    if (!version.isDirectory()) {
      continue;
    }
    const signtoolPath = path.join(
      binRoot,
      version.name,
      "x64",
      "signtool.exe",
    );
    if (await isFile(signtoolPath)) {
      candidates.push(signtoolPath);
    }
  }
  return selectWindowsSdkBin(candidates);
}

export function resolveGeneratedBuildRoot(
  repoRoot,
  { platform = process.platform } = {},
) {
  return platform === "win32"
    ? path.resolve("C:/lb/LatticeCodeOSS")
    : path.resolve(repoRoot, ".lattice-build", "code-oss");
}

export async function ensureGeneratedBuildRoot({ repoRoot, generatedRoot } = {}) {
  const resolvedRepository = path.resolve(repoRoot);
  const resolvedGeneratedRoot = path.resolve(generatedRoot);
  await fs.mkdir(resolvedGeneratedRoot, { recursive: true });

  const physicalGeneratedRoot = await fs.realpath(resolvedGeneratedRoot);
  if (/\s/.test(physicalGeneratedRoot)) {
    throw new Error(
      `Code OSS generated root physical path must not contain whitespace: ${physicalGeneratedRoot}`,
    );
  }

  const markerPath = path.join(
    physicalGeneratedRoot,
    ".lattice-code-oss-root.json",
  );
  const marker = await readJsonIfPresent(markerPath);
  if (marker) {
    if (path.resolve(marker.repository ?? "") !== resolvedRepository) {
      throw new Error(
        `Code OSS generated root belongs to another repository: ${marker.repository}`,
      );
    }
    return resolvedGeneratedRoot;
  }

  const existingEntries = await fs.readdir(physicalGeneratedRoot);
  if (existingEntries.length > 0) {
    throw new Error(
      "Code OSS generated root is not empty and has no ownership marker.",
    );
  }
  await writeAtomicFile(
    markerPath,
    `${JSON.stringify(
      { schemaVersion: 1, repository: resolvedRepository },
      null,
      2,
    )}\n`,
  );
  return resolvedGeneratedRoot;
}

export function inspectBuildNodeToolchain(state, source) {
  const errors = [];
  if (!state.archiveExists) {
    errors.push("Portable Node archive is missing.");
  } else if (state.archiveSha256 !== source.buildNodeSha256) {
    errors.push(
      "Portable Node archive checksum does not match the source contract.",
    );
  }
  if (!state.nodeExists) {
    errors.push("Portable Node executable is missing.");
  }
  if (!state.npmExists) {
    errors.push("Portable npm command is missing.");
  }
  if (!state.npmCliExists) {
    errors.push("Portable npm CLI is missing.");
  }
  if (state.nodeVersion !== source.buildNodeVersion) {
    errors.push(`Portable Node version must be ${source.buildNodeVersion}.`);
  }
  return { ready: errors.length === 0, errors };
}

async function defaultDownloadArchive(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Unable to download portable Node: HTTP ${response.status}.`,
    );
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, Buffer.from(await response.arrayBuffer()));
  await fs.rename(temporaryPath, destination);
}

async function defaultExtractArchive(tools) {
  await fs.mkdir(path.dirname(tools.runtimeRoot), { recursive: true });
  await runProcess(
    process.platform === "win32" ? "tar.exe" : "tar",
    ["-xf", tools.archivePath, "-C", path.dirname(tools.runtimeRoot)],
    { capture: true },
  );
}

async function defaultQueryNodeVersion(nodeExecutable) {
  const output = await runProcess(nodeExecutable, ["--version"], {
    capture: true,
  });
  return output.replace(/^v/, "").trim();
}

export async function prepareBuildNodeToolchain({
  tools,
  source,
  downloadArchive = defaultDownloadArchive,
  extractArchive = defaultExtractArchive,
  queryNodeVersion = defaultQueryNodeVersion,
} = {}) {
  let archiveExists = await pathExists(tools.archivePath);
  if (!archiveExists) {
    await downloadArchive(source.buildNodeUrl, tools.archivePath);
    archiveExists = true;
  }
  const archiveSha256 = archiveExists
    ? await hashPath(tools.archivePath)
    : null;
  if (archiveSha256 !== source.buildNodeSha256) {
    throw new Error(
      "Portable Node archive checksum does not match the source contract.",
    );
  }

  let nodeExists = await isFile(tools.nodeExecutable);
  let npmExists = await isFile(tools.npmCommand);
  let npmCliExists = await isFile(tools.npmCli);
  if (!nodeExists || !npmExists || !npmCliExists) {
    await extractArchive(tools);
    nodeExists = await isFile(tools.nodeExecutable);
    npmExists = await isFile(tools.npmCommand);
    npmCliExists = await isFile(tools.npmCli);
  }
  const nodeVersion = nodeExists
    ? await queryNodeVersion(tools.nodeExecutable)
    : null;
  const result = inspectBuildNodeToolchain(
    {
      archiveExists,
      archiveSha256,
      nodeExists,
      npmExists,
      npmCliExists,
      nodeVersion,
    },
    source,
  );
  if (!result.ready) {
    throw new Error(result.errors.join(" "));
  }
  return result;
}

async function tryRun(command, args) {
  try {
    return await runProcess(command, args, { capture: true });
  } catch {
    return null;
  }
}

async function inspectLocalBuildEnvironment(repoRoot, tools, source) {
  const gitVersion = await tryRun("git", ["--version"]);
  const pythonVersionOutput = await tryRun("python", ["--version"]);
  const pythonPathOutput = await tryRun("where.exe", ["python.exe"]);
  const pythonExecutable = pythonPathOutput?.split(/\r?\n/)[0]?.trim() ?? null;
  const vswhere = path.join(
    process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );
  const visualStudioPath = (await isFile(vswhere))
    ? await tryRun(vswhere, [
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property",
        "installationPath",
      ])
    : null;
  const windowsSdkBin = await findWindowsSdkBin();
  const fileSystem = await fs.statfs(repoRoot);
  const freeBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize);
  const nodeVersion = await defaultQueryNodeVersion(tools.nodeExecutable);
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion,
    gitAvailable: Boolean(gitVersion),
    pythonVersion:
      pythonVersionOutput?.match(/Python\s+(\d+(?:\.\d+){1,2})/i)?.[1] ?? null,
    pythonExecutable,
    msbuildAvailable: Boolean(visualStudioPath?.trim()),
    visualStudioPath: visualStudioPath?.trim() ?? null,
    visualStudioVersion: "2022",
    signtoolAvailable: Boolean(windowsSdkBin),
    windowsSdkBin,
    freeBytes,
  };
}

async function runLoggedBuildCommand(specification, environment) {
  await fs.mkdir(path.dirname(specification.logPath), { recursive: true });
  const log = await fs.open(specification.logPath, "w");
  const invocation =
    process.platform === "win32" && /\.(?:cmd|bat)$/i.test(specification.command)
      ? {
          command: process.env.ComSpec ?? "C:/Windows/System32/cmd.exe",
          args: [
            "/d",
            "/s",
            "/c",
            specification.command,
            ...specification.args,
          ],
        }
      : { command: specification.command, args: specification.args };
  await log.writeFile(
    `[lattice-code-oss-build] ${specification.command} ${specification.args.join(" ")}\n`,
  );
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: specification.cwd,
        env: environment,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", log.fd, log.fd],
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `${specification.command} exited with code ${code ?? "unknown"}. See ${specification.logPath}`,
            ),
          );
        }
      });
    });
  } finally {
    await log.close();
  }
}

export async function buildCodeOSSDesktop({ repoRoot = process.cwd() } = {}) {
  const generatedRoot = await ensureGeneratedBuildRoot({
    repoRoot,
    generatedRoot: resolveGeneratedBuildRoot(repoRoot),
  });
  const prepared = await prepareCodeOSSDesktop({
    repoRoot,
    generatedRoot,
    mode: "prepare",
  });
  const tools = buildToolchainLayout(repoRoot, prepared.checkout.source, {
    generatedRoot,
  });
  await prepareBuildNodeToolchain({ tools, source: prepared.checkout.source });
  const localEnvironment = await inspectLocalBuildEnvironment(
    repoRoot,
    tools,
    prepared.checkout.source,
  );
  const prerequisiteErrors = validateBuildPrerequisites(
    localEnvironment,
    prepared.checkout.source,
  );
  if (prerequisiteErrors.length > 0) {
    throw new Error(prerequisiteErrors.join(" "));
  }
  const environment = createBuildEnvironment(
    tools,
    localEnvironment,
    process.env,
  );
  for (const command of buildDesktopCommands(prepared.layout, tools)) {
    process.stdout.write(
      `[prepare-code-oss-desktop] running ${command.command} ${command.args.join(" ")}\n`,
    );
    await runLoggedBuildCommand(command, environment);
  }
  if (!(await isDirectory(tools.distributionRoot))) {
    throw new Error(
      `Code OSS desktop distribution is missing after build: ${tools.distributionRoot}`,
    );
  }
  return { ...prepared, tools, localEnvironment };
}

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function inspectCheckout(
  layout,
  source,
  { head, tagCommit, worktreeStatus = "" } = {},
) {
  const errors = [];
  if (head !== source.commit) {
    errors.push("Code OSS checkout HEAD does not match the pinned commit.");
  }
  if (tagCommit !== source.commit) {
    errors.push("Code OSS release tag does not resolve to the pinned commit.");
  }
  if (worktreeStatus.trim().length > 0) {
    errors.push("Code OSS checkout has missing or modified tracked files.");
  }
  if (!(await isFile(path.join(layout.checkoutRoot, "package.json")))) {
    errors.push("Code OSS package.json is missing.");
  }
  if (
    !(await isFile(
      path.join(
        layout.checkoutRoot,
        "src",
        "vs",
        "code",
        "electron-main",
        "main.ts",
      ),
    ))
  ) {
    errors.push("Code OSS Electron main entry is missing.");
  }
  return { ready: errors.length === 0, errors };
}

export function buildCheckoutCommands(layout, source) {
  return [
    {
      command: "git",
      args: ["init", layout.checkoutRoot],
      cwd: layout.repoRoot,
    },
    {
      command: "git",
      args: [
        "-C",
        layout.checkoutRoot,
        "config",
        "core.longpaths",
        "true",
      ],
      cwd: layout.repoRoot,
    },
    {
      command: "git",
      args: [
        "-C",
        layout.checkoutRoot,
        "remote",
        "add",
        "origin",
        source.repository,
      ],
      cwd: layout.repoRoot,
    },
    {
      command: "git",
      args: [
        "-C",
        layout.checkoutRoot,
        "fetch",
        "--depth",
        "1",
        "origin",
        `refs/tags/${source.tag}:refs/tags/${source.tag}`,
      ],
      cwd: layout.repoRoot,
    },
    {
      command: "git",
      args: [
        "-C",
        layout.checkoutRoot,
        "checkout",
        "--detach",
        source.commit,
      ],
      cwd: layout.repoRoot,
    },
  ];
}

export function buildWorktreeCommand(layout, source) {
  return {
    command: "git",
    args: [
      "-C",
      layout.checkoutRoot,
      "worktree",
      "add",
      "--detach",
      layout.buildRoot,
      source.commit,
    ],
    cwd: layout.repoRoot,
  };
}

export function parseDesktopArguments(args) {
  const selected = args.filter(
    (argument) =>
      argument === "--check" ||
      argument === "--prepare" ||
      argument === "--build",
  );
  if (selected.length !== 1 || selected.length !== args.length) {
    throw new Error("Use exactly one of --check, --prepare, or --build.");
  }
  return { mode: selected[0].slice(2) };
}

export function buildOverlayPlan(repoRoot, buildRoot) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedBuildRoot = path.resolve(buildRoot);
  return [
    {
      kind: "merge-json",
      source: path.join(
        resolvedRepoRoot,
        "desktop",
        "code-oss",
        "product",
        "product.json",
      ),
      destination: path.join(resolvedBuildRoot, "product.json"),
    },
    {
      kind: "copy-directory",
      source: path.join(
        resolvedRepoRoot,
        "desktop",
        "code-oss",
        "extensions",
        "lattice-workbench",
      ),
      destination: path.join(
        resolvedBuildRoot,
        "extensions",
        "lattice-workbench",
      ),
    },
    {
      kind: "replace-text",
      source: path.join(
        resolvedRepoRoot,
        "desktop",
        "code-oss",
        "patches",
        "win32-package-pe-filter.json",
      ),
      destination: path.join(
        resolvedBuildRoot,
        "build",
        "gulpfile.vscode.ts",
      ),
    },
  ];
}

export function validateOverlayPlan(plan, buildRoot) {
  const errors = [];
  const resolvedBuildRoot = path.resolve(buildRoot);
  const destinations = new Set();
  for (const entry of plan) {
    const destination = path.resolve(entry.destination);
    const relative = path.relative(resolvedBuildRoot, destination);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      errors.push("Overlay destination must stay inside the build worktree.");
    }
    if (destinations.has(destination)) {
      errors.push(`Overlay destination is duplicated: ${destination}`);
    }
    destinations.add(destination);
    if (
      entry.kind !== "merge-json" &&
      entry.kind !== "copy-directory" &&
      entry.kind !== "replace-text"
    ) {
      errors.push(`Unsupported overlay kind: ${entry.kind}`);
    }
  }
  return errors;
}

async function hashFile(filePath, hash) {
  hash.update(await fs.readFile(filePath));
}

async function hashDirectory(directoryPath, hash, relativeRoot = "") {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    const absolutePath = path.join(directoryPath, entry.name);
    hash.update(relativePath);
    hash.update("\0");
    if (entry.isDirectory()) {
      await hashDirectory(absolutePath, hash, relativePath);
    } else if (entry.isFile()) {
      await hashFile(absolutePath, hash);
    }
    hash.update("\0");
  }
}

async function hashPath(targetPath) {
  const hash = createHash("sha256");
  const stat = await fs.stat(targetPath);
  if (stat.isDirectory()) {
    await hashDirectory(targetPath, hash);
  } else {
    await hashFile(targetPath, hash);
  }
  return hash.digest("hex");
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeAtomicFile(destination, contents) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, contents);
  await fs.rename(temporaryPath, destination);
}

async function replaceDirectory(stagedDirectory, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const backup = `${destination}.${process.pid}.backup`;
  const destinationExists = await isDirectory(destination);
  if (destinationExists) {
    await fs.rename(destination, backup);
  }
  try {
    await fs.rename(stagedDirectory, destination);
  } catch (error) {
    if (destinationExists) {
      await fs.rename(backup, destination);
    }
    throw error;
  }
  if (destinationExists) {
    await fs.rm(backup, { recursive: true, force: true });
  }
}

export async function applyOverlayPlan(
  plan,
  { buildRoot, stagingRoot, manifestPath, now = () => new Date() },
) {
  const errors = validateOverlayPlan(plan, buildRoot);
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }

  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.mkdir(stagingRoot, { recursive: true });
  const manifestEntries = [];
  for (const [index, entry] of plan.entries()) {
    if (entry.kind === "merge-json") {
      const upstream = JSON.parse(await fs.readFile(entry.destination, "utf8"));
      const overlay = JSON.parse(await fs.readFile(entry.source, "utf8"));
      const merged = `${JSON.stringify({ ...upstream, ...overlay }, null, 2)}\n`;
      await writeAtomicFile(entry.destination, merged);
    } else if (entry.kind === "copy-directory") {
      const stagedDirectory = path.join(stagingRoot, `entry-${index}`);
      await fs.cp(entry.source, stagedDirectory, { recursive: true });
      await replaceDirectory(stagedDirectory, entry.destination);
    } else {
      const patch = JSON.parse(await fs.readFile(entry.source, "utf8"));
      const contents = await fs.readFile(entry.destination, "utf8");
      if (
        typeof patch.find !== "string" ||
        patch.find.length === 0 ||
        typeof patch.replace !== "string" ||
        patch.replace.length === 0
      ) {
        throw new Error(`Invalid text overlay patch: ${entry.source}`);
      }
      if (!contents.includes(patch.replace)) {
        const occurrenceCount = contents.split(patch.find).length - 1;
        if (occurrenceCount !== 1) {
          throw new Error(
            `Text overlay anchor must occur exactly once: ${entry.destination}`,
          );
        }
        await writeAtomicFile(
          entry.destination,
          contents.replace(patch.find, patch.replace),
        );
      }
    }
    manifestEntries.push({
      kind: entry.kind,
      source: entry.source,
      destination: entry.destination,
      sourceSha256: await hashPath(entry.source),
      destinationSha256: await hashPath(entry.destination),
    });
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    entries: manifestEntries,
  };
  await writeAtomicFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export async function inspectAppliedOverlay({
  buildRoot,
  overlayManifestPath,
}) {
  const errors = [];
  const product = await readJsonIfPresent(path.join(buildRoot, "product.json"));
  if (
    product?.nameShort !== "Lattice" ||
    product?.applicationName !== "lattice" ||
    product?.extensionsGallery?.serviceUrl !==
      "https://open-vsx.org/vscode/gallery"
  ) {
    errors.push("Lattice Code OSS product overlay is missing or invalid.");
  }

  const extension = await readJsonIfPresent(
    path.join(
      buildRoot,
      "extensions",
      "lattice-workbench",
      "package.json",
    ),
  );
  if (
    extension?.publisher !== "lattice" ||
    extension?.name !== "lattice-workbench"
  ) {
    errors.push("Lattice Workbench built-in extension is missing.");
  }

  const manifest = await readJsonIfPresent(overlayManifestPath);
  if (
    manifest?.schemaVersion !== 1 ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length === 0
  ) {
    errors.push("Code OSS overlay manifest is missing or invalid.");
  } else {
    for (const entry of manifest.entries) {
      try {
        const digest = await hashPath(entry.destination);
        if (digest !== entry.destinationSha256) {
          errors.push(
            `Code OSS overlay destination hash does not match: ${entry.destination}`,
          );
        }
      } catch {
        errors.push(`Code OSS overlay destination is missing: ${entry.destination}`);
      }
    }
  }
  return { ready: errors.length === 0, errors };
}

async function isDirectory(directoryPath) {
  try {
    return (await fs.stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

async function pathExists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function runProcess(command, args, { cwd, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    const stdout = [];
    const stderr = [];
    if (capture) {
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
    }
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(capture ? Buffer.concat(stdout).toString("utf8").trim() : "");
        return;
      }
      const detail = capture
        ? Buffer.concat(stderr).toString("utf8").trim()
        : "";
      reject(
        new Error(
          `${command} exited with code ${code ?? "unknown"}${detail ? `: ${detail}` : "."}`,
        ),
      );
    });
  });
}

async function defaultRunCommand(specification) {
  await runProcess(specification.command, specification.args, {
    cwd: specification.cwd,
  });
}

async function defaultQueryGit(args, layout) {
  return runProcess("git", args, { cwd: layout.repoRoot, capture: true });
}

async function readCheckoutState(layout, source, queryGit) {
  if (!(await isDirectory(path.join(layout.checkoutRoot, ".git")))) {
    return { head: undefined, tagCommit: undefined };
  }
  const head = await queryGit(
    ["-C", layout.checkoutRoot, "rev-parse", "HEAD"],
    layout,
  );
  const tagCommit = await queryGit(
    [
      "-C",
      layout.checkoutRoot,
      "rev-list",
      "-n",
      "1",
      `refs/tags/${source.tag}`,
    ],
    layout,
  );
  const worktreeStatus = await queryGit(
    ["-C", layout.checkoutRoot, "status", "--porcelain"],
    layout,
  );
  return {
    head: head.trim(),
    tagCommit: tagCommit.trim(),
    worktreeStatus: worktreeStatus.trim(),
  };
}

async function writeSourceStamp(layout, source, now) {
  const stamp = {
    schemaVersion: 1,
    repository: source.repository,
    tag: source.tag,
    commit: source.commit,
    generatedAt: now().toISOString(),
  };
  await fs.mkdir(path.dirname(layout.stampPath), { recursive: true });
  const temporaryPath = `${layout.stampPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(stamp, null, 2)}\n`);
  await fs.rename(temporaryPath, layout.stampPath);
}

export async function prepareCodeOSSCheckout({
  repoRoot = process.cwd(),
  source,
  sourcePath = path.resolve(repoRoot, "desktop", "code-oss", "source.json"),
  mode,
  runCommand = defaultRunCommand,
  queryGit = defaultQueryGit,
  now = () => new Date(),
} = {}) {
  const contract = source ?? (await readSourceContract(sourcePath));
  const contractErrors = validateSourceContract(contract);
  if (contractErrors.length > 0) {
    throw new Error(contractErrors.join(" "));
  }
  if (mode !== "check" && mode !== "prepare") {
    throw new Error('Code OSS checkout mode must be "check" or "prepare".');
  }

  const layout = sourceLayout(repoRoot, contract);
  const checkoutExists = await isDirectory(
    path.join(layout.checkoutRoot, ".git"),
  );
  if (!checkoutExists && mode === "prepare") {
    await fs.mkdir(path.dirname(layout.checkoutRoot), { recursive: true });
    for (const command of buildCheckoutCommands(layout, contract)) {
      await runCommand(command);
    }
  } else if (checkoutExists && mode === "prepare") {
    const currentState = await readCheckoutState(layout, contract, queryGit);
    const current = await inspectCheckout(layout, contract, currentState);
    if (!current.ready) {
      throw new Error(current.errors.join(" "));
    }
  }

  const checkoutState = await readCheckoutState(layout, contract, queryGit);
  const result = await inspectCheckout(layout, contract, checkoutState);
  if (!result.ready) {
    throw new Error(result.errors.join(" "));
  }
  if (mode === "prepare") {
    await writeSourceStamp(layout, contract, now);
  }
  return { ...result, layout, source: contract };
}

async function inspectBuildWorktree(layout, source, head) {
  const errors = [];
  if (head !== source.commit) {
    errors.push("Code OSS build worktree HEAD does not match the pinned commit.");
  }
  if (!(await isFile(path.join(layout.buildRoot, "package.json")))) {
    errors.push("Code OSS build worktree package.json is missing.");
  }
  if (
    !(await isFile(
      path.join(
        layout.buildRoot,
        "src",
        "vs",
        "code",
        "electron-main",
        "main.ts",
      ),
    ))
  ) {
    errors.push("Code OSS build worktree Electron main entry is missing.");
  }
  return { ready: errors.length === 0, errors };
}

export async function prepareCodeOSSBuildWorktree({
  layout,
  source,
  mode,
  runCommand = defaultRunCommand,
  queryGit = defaultQueryGit,
} = {}) {
  if (mode !== "check" && mode !== "prepare") {
    throw new Error('Code OSS build worktree mode must be "check" or "prepare".');
  }
  const worktreeExists = await pathExists(path.join(layout.buildRoot, ".git"));
  if (!worktreeExists && mode === "prepare") {
    await fs.mkdir(path.dirname(layout.buildRoot), { recursive: true });
    await runCommand(buildWorktreeCommand(layout, source));
  }
  if (!(await pathExists(path.join(layout.buildRoot, ".git")))) {
    throw new Error("Code OSS build worktree is missing.");
  }

  const head = await queryGit(
    ["-C", layout.buildRoot, "rev-parse", "HEAD"],
    layout,
  );
  const result = await inspectBuildWorktree(layout, source, head.trim());
  if (!result.ready) {
    throw new Error(result.errors.join(" "));
  }
  return result;
}

export async function prepareCodeOSSDesktop({
  repoRoot = process.cwd(),
  generatedRoot,
  mode,
} = {}) {
  const resolvedGeneratedRoot = await ensureGeneratedBuildRoot({
    repoRoot,
    generatedRoot: generatedRoot ?? resolveGeneratedBuildRoot(repoRoot),
  });
  const checkout = await prepareCodeOSSCheckout({ repoRoot, mode });
  const layout = desktopLayout(repoRoot, checkout.source, {
    generatedRoot: resolvedGeneratedRoot,
  });
  const buildWorktree = await prepareCodeOSSBuildWorktree({
    layout,
    source: checkout.source,
    mode,
  });
  if (mode === "prepare") {
    await applyOverlayPlan(buildOverlayPlan(repoRoot, layout.buildRoot), {
      buildRoot: layout.buildRoot,
      stagingRoot: layout.stagingRoot,
      manifestPath: layout.overlayManifestPath,
    });
  }
  const overlay = await inspectAppliedOverlay({
    buildRoot: layout.buildRoot,
    overlayManifestPath: layout.overlayManifestPath,
  });
  if (!overlay.ready) {
    throw new Error(overlay.errors.join(" "));
  }
  return { checkout, buildWorktree, overlay, layout };
}

async function main() {
  const { mode } = parseDesktopArguments(process.argv.slice(2));
  const result =
    mode === "build"
      ? await buildCodeOSSDesktop()
      : await prepareCodeOSSDesktop({ mode });
  process.stdout.write(
    `[prepare-code-oss-desktop] Lattice Code OSS ${result.checkout.source.tag} at ${result.checkout.source.commit} is ready\n`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error("[prepare-code-oss-desktop] failed:", error.message);
    process.exitCode = 1;
  });
}
