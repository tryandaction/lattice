// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const parent = await mkdtemp(resolve(".lattice-build/production-recovery-"));
  const root = resolve(parent, "source"); await mkdir(root);
  const artifacts = [];
  for (const kind of ["roles", "schema", "data", "history-schema", "history-data", "repository-migrations", "deployment-version", "public-config"]) {
    const bytes = `synthetic-${kind}`; await writeFile(resolve(root, `${kind}.fixture`), bytes);
    artifacts.push({ kind, path: `${kind}.fixture`, sizeBytes: Buffer.byteLength(bytes), sha256: digest(bytes) });
  }
  const bytes = Buffer.alloc(20 * 1024 * 1024, 73), sha256 = digest(bytes);
  const object = { id: "blob-1", libraryId: "lib-1", storage_key: "libraries/lib-1/blobs/object-1", storage_backend: "supabase", size_bytes: bytes.length, sha256 };
  await mkdir(resolve(root, "lib-1/objects"), { recursive: true }); await writeFile(resolve(root, "lib-1/objects", `${sha256}.bin`), bytes);
  const manifest = JSON.stringify({ version: 2, complete: true, scope: "member-visible-library-objects", libraryId: "lib-1", objectCount: 1, totalBytes: bytes.length, objects: [object] });
  await writeFile(resolve(root, "lib-1/manifest.json"), manifest);
  await writeFile(resolve(root, "recovery-point.json"), JSON.stringify({ version: 1, scope: "project-recovery-point", projectRef: "synthetic-source", artifacts, libraries: [{ libraryId: "lib-1", path: "lib-1", manifestSha256: digest(manifest) }] }));
  const inventoryPath = resolve(parent, "source-inventory.json");
  await writeFile(inventoryPath, JSON.stringify({ version: 1, projectRef: "synthetic-source", libraryIds: ["lib-1"], objects: [object] }));
  return { parent, root, inventoryPath, key: randomBytes(32), archivePath: resolve(parent, "independent-copy/point.lattice-backup"), output: resolve(parent, "isolated-restore"), sha256 };
}
describe("encrypted offline recovery point", () => {
  it("never seals a manifest whose parsed object list came from an unhashed later read", async () => {
    const { sealRecoveryArchive } = await import("../../../scripts/cloud-library-recovery-archive.mjs");
    const f = await fixture(); await mkdir(resolve(f.parent, "independent-copy"));
    const manifestPath = resolve(f.root, "lib-1/manifest.json");
    const original = fs.promises.readFile;
    const manifestBytes = await original(manifestPath);
    const changed = JSON.stringify({ ...JSON.parse(manifestBytes.toString()), objects: [], objectCount: 0, totalBytes: 0 });
    let reads = 0;
    fs.promises.readFile = async function(path, ...args) {
      if (String(path) === manifestPath && ++reads === 3) {
        await writeFile(manifestPath, changed);
        try { return await original(path, ...args); }
        finally { await writeFile(manifestPath, manifestBytes); }
      }
      return original(path, ...args);
    } as typeof fs.promises.readFile;
    syncBuiltinESMExports();
    try {
      await expect(sealRecoveryArchive({ recoveryRoot: f.root, sourceInventoryPath: f.inventoryPath, output: f.archivePath, key: f.key })).rejects.toThrow(/source changed|integrity/i);
      await expect(access(f.archivePath)).rejects.toThrow();
    } finally { fs.promises.readFile = original; syncBuiltinESMExports(); }
  });

  it("rejects case-insensitive entry collisions before publishing an archive", async () => {
    const { sealRecoveryArchive } = await import("../../../scripts/cloud-library-recovery-archive.mjs");
    const f = await fixture(); await mkdir(resolve(f.parent, "independent-copy"));
    // Both spellings describe one Windows file. Also create the alias on case-sensitive hosts.
    const bytes = await readFile(resolve(f.root, "roles.fixture"));
    await writeFile(resolve(f.root, "ROLES.fixture"), bytes);
    const pointPath = resolve(f.root, "recovery-point.json");
    const point = JSON.parse(await readFile(pointPath, "utf8"));
    point.artifacts[1] = { kind: "schema", path: "ROLES.fixture", sizeBytes: bytes.length, sha256: digest(bytes) };
    await writeFile(pointPath, JSON.stringify(point));
    await expect(sealRecoveryArchive({ recoveryRoot: f.root, sourceInventoryPath: f.inventoryPath, output: f.archivePath, key: f.key })).rejects.toThrow(/duplicate|unsafe/i);
    await expect(access(f.archivePath)).rejects.toThrow();
  });

  it("encrypts verified artifacts and restores all bytes into a new isolated directory", async () => {
    const { sealRecoveryArchive, openRecoveryArchive } = await import("../../../scripts/cloud-library-recovery-archive.mjs");
    const f = await fixture(); await mkdir(resolve(f.parent, "independent-copy"));
    const sealed = await sealRecoveryArchive({ recoveryRoot: f.root, sourceInventoryPath: f.inventoryPath, output: f.archivePath, key: f.key });
    expect(sealed).toMatchObject({ status: "sealed", productionRestoreVerified: false });
    const encrypted = await readFile(f.archivePath); expect(encrypted.includes(Buffer.from("synthetic-schema"))).toBe(false);
    const restored = await openRecoveryArchive({ archive: f.archivePath, output: f.output, key: f.key });
    expect(restored).toMatchObject({ status: "verified", objects: 1, artifacts: 8, productionRestoreVerified: false });
    expect(digest(await readFile(resolve(f.output, "package/lib-1/objects", `${f.sha256}.bin`)))).toBe(f.sha256);
  });

  it("rejects wrong keys and tampering before creating a completed recovery point", async () => {
    const { sealRecoveryArchive, openRecoveryArchive } = await import("../../../scripts/cloud-library-recovery-archive.mjs");
    const f = await fixture(); await mkdir(resolve(f.parent, "independent-copy"));
    await sealRecoveryArchive({ recoveryRoot: f.root, sourceInventoryPath: f.inventoryPath, output: f.archivePath, key: f.key });
    await expect(openRecoveryArchive({ archive: f.archivePath, output: f.output, key: randomBytes(32) })).rejects.toThrow(/authenticate|decrypt/i);
    const encrypted = await readFile(f.archivePath); encrypted[encrypted.length - 1] ^= 1; await writeFile(f.archivePath, encrypted);
    await expect(openRecoveryArchive({ archive: f.archivePath, output: f.output, key: f.key })).rejects.toThrow(/authenticate|decrypt/i);
  });

  it("refuses an archive under the source and refuses to overwrite an existing restore", async () => {
    const { sealRecoveryArchive, openRecoveryArchive } = await import("../../../scripts/cloud-library-recovery-archive.mjs");
    const f = await fixture();
    await expect(sealRecoveryArchive({ recoveryRoot: f.root, sourceInventoryPath: f.inventoryPath, output: resolve(f.root, "bad.backup"), key: f.key })).rejects.toThrow(/independent|outside/i);
    await mkdir(resolve(f.parent, "independent-copy")); await sealRecoveryArchive({ recoveryRoot: f.root, sourceInventoryPath: f.inventoryPath, output: f.archivePath, key: f.key });
    await mkdir(f.output); await writeFile(resolve(f.output, "keep.txt"), "keep");
    await expect(openRecoveryArchive({ archive: f.archivePath, output: f.output, key: f.key })).rejects.toThrow(/exist/i);
    expect(await readFile(resolve(f.output, "keep.txt"), "utf8")).toBe("keep");
  });

  it("preserves empty libraries and rejects oversized extraction without a verified marker", async () => {
    const { sealRecoveryArchive, openRecoveryArchive } = await import("../../../scripts/cloud-library-recovery-archive.mjs");
    const f = await fixture(); await mkdir(resolve(f.parent, "independent-copy"));
    await mkdir(resolve(f.root, "empty/objects"), { recursive: true });
    const manifest = JSON.stringify({ version: 2, scope: "member-visible-library-objects", complete: true, libraryId: "empty", objectCount: 0, totalBytes: 0, objects: [] });
    await writeFile(resolve(f.root, "empty/manifest.json"), manifest);
    const point = JSON.parse(await readFile(resolve(f.root, "recovery-point.json"), "utf8")); point.libraries.push({ libraryId: "empty", path: "empty", manifestSha256: digest(manifest) });
    await writeFile(resolve(f.root, "recovery-point.json"), JSON.stringify(point));
    const inventory = JSON.parse(await readFile(f.inventoryPath, "utf8")); inventory.libraryIds.push("empty"); await writeFile(f.inventoryPath, JSON.stringify(inventory));
    await sealRecoveryArchive({ recoveryRoot: f.root, sourceInventoryPath: f.inventoryPath, output: f.archivePath, key: f.key });
    await expect(openRecoveryArchive({ archive: f.archivePath, output: f.output, key: f.key, maxUnpackedBytes: 1024 })).rejects.toThrow(/unpacked byte limit/);
    await expect(access(resolve(f.output, "verified-recovery.json"))).rejects.toThrow();
    expect(await openRecoveryArchive({ archive: f.archivePath, output: f.output, key: f.key })).toMatchObject({ libraries: 2, objects: 1, status: "verified" });
  });

  it("does not publish a sealed archive when independent inventory is missing a library", async () => {
    const { sealRecoveryArchive } = await import("../../../scripts/cloud-library-recovery-archive.mjs");
    const f = await fixture(); await mkdir(resolve(f.parent, "independent-copy"));
    const inventory = JSON.parse(await readFile(f.inventoryPath, "utf8")); inventory.libraryIds.push("unbacked-library"); await writeFile(f.inventoryPath, JSON.stringify(inventory));
    await expect(sealRecoveryArchive({ recoveryRoot: f.root, sourceInventoryPath: f.inventoryPath, output: f.archivePath, key: f.key })).rejects.toThrow(/library coverage/);
    await expect(access(f.archivePath)).rejects.toThrow();
  });

  it.each(["package/../escape", "package/CON.fixture", "package/alias."])("rejects authenticated unsafe archive entry %s", async unsafePath => {
    const { openRecoveryArchive } = await import("../../../scripts/cloud-library-recovery-archive.mjs");
    const f = await fixture(); await mkdir(resolve(f.parent, "independent-copy"));
    const index = Buffer.from(JSON.stringify({ version: 1, entries: [{ path: "source-inventory.json", sizeBytes: 0, sha256: digest("") }, { path: "package/recovery-point.json", sizeBytes: 0, sha256: digest("") }, { path: unsafePath, sizeBytes: 0, sha256: digest("") }] }));
    const length = Buffer.alloc(4); length.writeUInt32BE(index.length);
    const iv = randomBytes(12), header = Buffer.concat([Buffer.from("LATBKP01"), iv]), cipher = createCipheriv("aes-256-gcm", f.key, iv); cipher.setAAD(header);
    const encrypted = Buffer.concat([header, cipher.update(gzipSync(Buffer.concat([length, index]))), cipher.final(), cipher.getAuthTag()]);
    await writeFile(f.archivePath, encrypted);
    await expect(openRecoveryArchive({ archive: f.archivePath, output: f.output, key: f.key })).rejects.toThrow(/unsafe|duplicate/i);
    await expect(access(f.output)).rejects.toThrow();
  });
});
