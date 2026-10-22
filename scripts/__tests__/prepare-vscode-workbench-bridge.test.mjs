import path from "node:path";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildBridgeVSIX } from "../prepare-vscode-workbench-bridge.mjs";

describe("prepare-vscode-workbench-bridge", () => {
  it("packages the bridge as an installable VSIX", async () => {
    const sourceDir = path.resolve("src-tauri/resources/vscode-lattice-bridge");
    const archive = await JSZip.loadAsync(await buildBridgeVSIX(sourceDir));

    expect(Object.keys(archive.files)).toEqual(expect.arrayContaining([
      "[Content_Types].xml",
      "extension.vsixmanifest",
      "extension/package.json",
      "extension/extension.js",
      "extension/extension.cjs",
      "extension/server.cjs",
    ]));
    const manifest = await archive.file("extension.vsixmanifest").async("string");
    const packageJson = JSON.parse(await archive.file("extension/package.json").async("string"));
    expect(manifest).toContain('Id="lattice-workbench-bridge"');
    expect(manifest).toContain('Publisher="lattice"');
    expect(packageJson).toMatchObject({
      name: "lattice-workbench-bridge",
      publisher: "lattice",
      version: "1.0.1",
      main: "./extension.js",
    });
  });
});
