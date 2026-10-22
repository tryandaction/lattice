import { copyFile, mkdir, lstat, realpath, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = await realpath(path.resolve(scriptDirectory, ".."));

async function resolveBuildDirectory() {
  if (process.platform !== "win32") {
    return repositoryRoot;
  }

  const shortRoot = "C:/lb";
  const shortRepository = path.join(shortRoot, "Lattice");
  await mkdir(shortRoot, { recursive: true });

  try {
    await lstat(shortRepository);
    const existingTarget = await realpath(shortRepository);
    if (existingTarget.toLowerCase() !== repositoryRoot.toLowerCase()) {
      throw new Error(`Short build path '${shortRepository}' targets '${existingTarget}'.`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    await symlink(repositoryRoot, shortRepository, "junction");
  }

  return shortRepository;
}

async function prepareLocalWebViewBootstrapper(buildDirectory) {
  if (process.platform !== "win32") {
    return;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error("LOCALAPPDATA is required to prepare the WebView2 installer cache.");
  }

  const bootstrapperName = "MicrosoftEdgeWebview2Setup.exe";
  const sourcePath = path.join(localAppData, "tauri", bootstrapperName);
  const cacheDirectory = path.join(buildDirectory, "src-tauri", "target", ".tauri");
  const targetPath = path.join(cacheDirectory, bootstrapperName);

  let sourceStats;
  try {
    sourceStats = await stat(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Missing local WebView2 bootstrapper at '${sourcePath}'. ` +
          "Restore the verified local bootstrapper before building; the release build never downloads it.",
      );
    }
    throw error;
  }

  if (!sourceStats.isFile() || sourceStats.size < 100_000) {
    throw new Error(`Invalid local WebView2 bootstrapper at '${sourcePath}'.`);
  }

  await mkdir(cacheDirectory, { recursive: true });
  try {
    const targetStats = await stat(targetPath);
    if (targetStats.isFile() && targetStats.size === sourceStats.size) {
      console.log(`[tauri-build] using local WebView2 bootstrapper cache: ${targetPath}`);
      return;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await copyFile(sourcePath, targetPath);
  console.log(`[tauri-build] prepared local WebView2 bootstrapper cache: ${targetPath}`);
}

const buildDirectory = await resolveBuildDirectory();
await prepareLocalWebViewBootstrapper(buildDirectory);
const tauriEntrypoint = path.join(
  repositoryRoot,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);
const child = spawn(process.execPath, [tauriEntrypoint, "build", ...process.argv.slice(2)], {
  cwd: buildDirectory,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

child.on("error", (error) => {
  console.error(`[tauri-build] unable to start Tauri: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[tauri-build] Tauri exited after signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
