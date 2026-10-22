/** Local consistency check only; never restores a database or connects to a cloud service. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readVerifiedCloudObjectBackup } from "./cloud-library-object-backup.mjs";

const requiredArtifacts = ["roles", "schema", "data", "history-schema", "history-data", "repository-migrations", "deployment-version", "public-config"];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const validId = value => typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

async function insidePath(root, relative, directory = false) {
  if (typeof relative !== "string" || relative.split("/").some(part => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..")) throw new Error("Unsafe recovery manifest path");
  let path = root;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index++) {
    path = resolve(path, parts[index]);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !((index < parts.length - 1 || directory) ? stats.isDirectory() : stats.isFile())) throw new Error("Unsafe recovery manifest path or symbolic link");
  }
  return path;
}

/** Source inventory must be supplied separately from an authorized full-project DB inventory. */
export async function verifyCloudRecoveryPackage(output, sourceInventoryPath, pointFile = "recovery-point.json", options = {}) {
  const root = resolve(output);
  const stats = await lstat(root);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("Unsafe recovery root path");
  const point = JSON.parse(await readFile(await insidePath(root, pointFile), "utf8"));
  const sourceBytes = await readFile(sourceInventoryPath);
  const source = JSON.parse(sourceBytes.toString('utf8'));
  if (!point || ![1, 2].includes(point.version) || point.scope !== "project-recovery-point" || !validId(point.projectRef) || !Array.isArray(point.artifacts) || !Array.isArray(point.libraries) || !source || source.version !== 1 || source.projectRef !== point.projectRef || !Array.isArray(source.libraryIds) || !Array.isArray(source.objects)) throw new Error("Invalid recovery point or source inventory");
  const sourceInventoryBound = point.version === 2;
  if (sourceInventoryBound && (point.complete !== true || !validId(point.snapshotId) || !validHash(point.sourceInventorySha256)
    || digest(sourceBytes) !== point.sourceInventorySha256 || source.scope !== 'full-project' || source.snapshotId !== point.snapshotId)) throw new Error('Incomplete recovery snapshot or source inventory binding mismatch');
  const artifactKinds = new Set(), artifactPaths = new Set();
  for (const artifact of point.artifacts) {
    if (!artifact || typeof artifact.kind !== "string" || artifactKinds.has(artifact.kind) || artifactPaths.has(artifact.path) || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0 || !validHash(artifact.sha256)) throw new Error("Invalid or duplicate recovery artifact");
    artifactKinds.add(artifact.kind); artifactPaths.add(artifact.path);
  }
  if (requiredArtifacts.some(kind => !artifactKinds.has(kind))) throw new Error("Missing required artifact");
  for (const artifact of point.artifacts) {
    const hash = createHash("sha256"); let size = 0;
    for await (const bytes of createReadStream(await insidePath(root, artifact.path))) { hash.update(bytes); size += bytes.length; }
    if (size !== artifact.sizeBytes || hash.digest("hex") !== artifact.sha256) throw new Error("Recovery artifact integrity mismatch");
  }

  const sourceLibraries = new Set(source.libraryIds);
  const backupLibraries = new Set(point.libraries.map(library => library?.libraryId));
  if (sourceLibraries.size !== source.libraryIds.length || backupLibraries.size !== point.libraries.length || source.libraryIds.some(id => !validId(id) || !backupLibraries.has(id)) || sourceLibraries.size !== backupLibraries.size) throw new Error("Recovery library coverage mismatch");
  const expectedObjects = new Map();
  for (const object of source.objects) {
    if (!object || !sourceLibraries.has(object.libraryId) || !validId(object.id) || !validHash(object.sha256) || !Number.isSafeInteger(object.size_bytes) || object.size_bytes < 0 || object.storage_backend !== "supabase" || typeof object.storage_key !== "string") throw new Error("Invalid source object inventory");
    const id = `${object.libraryId}:${object.id}`;
    if (expectedObjects.has(id)) throw new Error("Duplicate source object inventory");
    expectedObjects.set(id, object);
  }
  const actualObjects = new Map(), libraryPaths = new Set();
  for (const library of point.libraries) {
    if (!validHash(library.manifestSha256) || libraryPaths.has(library.path)) throw new Error("Invalid or duplicate recovery library manifest");
    libraryPaths.add(library.path);
    const libraryRoot = await insidePath(root, library.path, true);
    const manifestBytes = await readFile(await insidePath(root, `${library.path}/manifest.json`));
    if (digest(manifestBytes) !== library.manifestSha256) throw new Error("Library manifest integrity mismatch");
    const manifest = await readVerifiedCloudObjectBackup(libraryRoot, options);
    if (manifest.libraryId !== library.libraryId) throw new Error("Recovery library identity mismatch");
    for (const object of manifest.objects) actualObjects.set(`${library.libraryId}:${object.id}`, object);
  }
  if (actualObjects.size !== expectedObjects.size) throw new Error("Recovery object coverage mismatch");
  for (const [id, expected] of expectedObjects) {
    const actual = actualObjects.get(id);
    if (!actual || ["storage_key", "storage_backend", "size_bytes", "sha256"].some(key => actual[key] !== expected[key])) throw new Error("Recovery object coverage or metadata mismatch");
  }
  return {
    status: "passed", scope: "local-recovery-package", artifacts: point.artifacts.length, libraries: backupLibraries.size, objects: actualObjects.size,
    sourceInventoryBound,
    snapshotConsistency: sourceInventoryBound ? 'operator-attested' : 'legacy-unbound',
    productionRestoreVerified: false,
    pending: ["authorized-full-project-source-inventory", "independent-encrypted-copy-and-retention", "independent-project-restore-and-auth-permission-drill"],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const [output, sourceInventoryPath, ...extra] = process.argv.slice(2);
    if (!output || !sourceInventoryPath || extra.length) throw new Error("Invalid arguments");
    console.log(JSON.stringify(await verifyCloudRecoveryPackage(output, sourceInventoryPath)));
  } catch {
    console.error(JSON.stringify({ status: "failed", code: "RECOVERY_PACKAGE_INCOMPLETE_OR_INVALID", usage: "node scripts/cloud-library-recovery-verify.mjs <recovery-root> <independent-source-inventory.json>" }));
    process.exitCode = 1;
  }
}
