import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = process.cwd();
const makensis = path.join(process.env.LOCALAPPDATA ?? "", "tauri", "NSIS", "makensis.exe");
const plugins = path.join(process.env.LOCALAPPDATA ?? "", "tauri", "NSIS", "Plugins", "x86-unicode", "additional");
let temporaryRoot;
beforeAll(async () => { temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-safe-installer-")); });
afterAll(async () => { if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true }); });

describe("Windows installer process safety", () => {
  it("connects the small no-termination NSIS override through the Tauri hook configuration", async () => {
    const config = JSON.parse(await fs.readFile(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
    expect(config.bundle.windows.nsis?.installerHooks).toBe("windows/installer-hooks.nsh");
    expect(config.bundle.windows.nsis?.template).toBeUndefined();
  });

  it.skipIf(process.platform !== "win32")("compiles both install and uninstall checks with abort-only process handling", async () => {
    const config = JSON.parse(await fs.readFile(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
    expect(config.bundle.windows.nsis?.installerHooks).toBe("windows/installer-hooks.nsh");
    const hookPath = path.join(root, "src-tauri", config.bundle.windows.nsis.installerHooks);
    const fixture = [
      "Unicode true",
      '!include "LogicLib.nsh"',
      "!macro CheckIfAppIsRunning executableName productName",
      '  nsis_tauri_utils::KillProcessCurrentUser "${executableName}"',
      "  Pop $R0",
      "!macroend",
      `!include "${hookPath}"`,
      `!addplugindir /x86-unicode "${plugins}"`,
      'Name "Lattice isolated safety compilation"',
      `OutFile "${path.join(temporaryRoot, "never-run-fixture.exe")}"`,
      "RequestExecutionLevel user",
      "Section Install",
      '  !insertmacro CheckIfAppIsRunning "lattice.exe" "Lattice"',
      "SectionEnd",
      "Section Uninstall",
      '  !insertmacro CheckIfAppIsRunning "lattice.exe" "Lattice"',
      "SectionEnd",
    ].join("\n");
    const fixturePath = path.join(temporaryRoot, "fixture.nsi");
    await fs.writeFile(fixturePath, fixture);
    const { stdout, stderr } = await promisify(execFile)(makensis, ["/V4", fixturePath], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const expandedCommands = (stdout + stderr).split(/\r?\n/u).filter(line => /^(?:Plugin command:|Abort:|SetErrorLevel:)/u.test(line)).join("\n");
    expect(expandedCommands.match(/Plugin command: FindProcessCurrentUser lattice.exe/gu)).toHaveLength(2);
    expect(expandedCommands).not.toMatch(/KillProcess|TerminateProcess/u);
    expect(expandedCommands.match(/Abort: .*close.*Lattice.*retry/giu)).toHaveLength(2);
    expect(expandedCommands.match(/SetErrorLevel: 2/gu)).toHaveLength(2);
  });
});
