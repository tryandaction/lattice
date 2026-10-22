import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";

const ARCHIVE_DATE = new Date("1980-01-01T00:00:00.000Z");
const BRIDGE_FILES = ["package.json", "extension.js", "extension.cjs", "server.cjs"];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function buildBridgeVSIX(sourceDir) {
  const packageJson = JSON.parse(await fs.readFile(path.join(sourceDir, "package.json"), "utf8"));
  const zip = new JSZip();
  const fileOptions = { date: ARCHIVE_DATE };

  for (const fileName of BRIDGE_FILES) {
    zip.file(
      `extension/${fileName}`,
      await fs.readFile(path.join(sourceDir, fileName)),
      fileOptions,
    );
  }

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="cjs" ContentType="application/javascript" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>`, fileOptions);
  zip.file("extension.vsixmanifest", `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapeXml(packageJson.name)}" Version="${escapeXml(packageJson.version)}" Publisher="${escapeXml(packageJson.publisher)}" />
    <DisplayName>${escapeXml(packageJson.displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(packageJson.description)}</Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(packageJson.engines.vscode)}" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>`, fileOptions);

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

async function main() {
  const rootDir = process.cwd();
  const sourceDir = path.join(rootDir, "src-tauri", "resources", "vscode-lattice-bridge");
  const targetPath = path.join(rootDir, "src-tauri", "resources", "vscode-lattice-bridge.vsix");
  await fs.writeFile(targetPath, await buildBridgeVSIX(sourceDir));
  process.stdout.write(`[prepare-vscode-workbench-bridge] created ${targetPath}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error("[prepare-vscode-workbench-bridge] failed:", error);
    process.exit(1);
  });
}
