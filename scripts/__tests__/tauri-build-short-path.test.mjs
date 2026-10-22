import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Tauri build entrypoint", () => {
  it("uses a hidden short-path junction for Windows WiX builds", async () => {
    const source = await readFile(path.join(root, "scripts/tauri-build.mjs"), "utf8");

    expect(source).toContain('const shortRoot = "C:/lb"');
    expect(source).toContain('path.join(shortRoot, "Lattice")');
    expect(source).toContain('await symlink(repositoryRoot, shortRepository, "junction")');
    expect(source).toContain('windowsHide: true');
  });
});
