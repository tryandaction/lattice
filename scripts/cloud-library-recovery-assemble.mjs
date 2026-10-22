/** Offline assembly only. Database snapshot acquisition and production restoration are separate. */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { readVerifiedCloudObjectBackup } from './cloud-library-object-backup.mjs';
import { verifyCloudRecoveryPackage } from './cloud-library-recovery-verify.mjs';

const requiredKinds = ['roles', 'schema', 'data', 'history-schema', 'history-data', 'repository-migrations', 'deployment-version', 'public-config'];
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => { const part = relative(parent, child); return !part || !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep); };
function shape(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) throw new Error('Invalid or unexpected assembly fields');
}
function safeRelative(value) {
  return typeof value === 'string' && value.length <= 1024 && value.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..' && !part.endsWith('.') && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}
async function regular(path, directory = false) {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !(directory ? stats.isDirectory() : stats.isFile())) throw new Error('Unsafe assembly path or symbolic link');
  return stats;
}
async function noLinkedAncestors(path, directory = false) {
  const parent = dirname(path);
  if (parent !== path) await noLinkedAncestors(parent, true);
  return regular(path, directory);
}
async function inputPath(root, path, directory = false) {
  if (!safeRelative(path)) throw new Error('Unsafe assembly input path');
  let current = root; const parts = path.split('/');
  for (const [index, part] of parts.entries()) { current = resolve(current, part); await regular(current, directory || index < parts.length - 1); }
  return current;
}
async function absent(path) {
  try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Assembly output already exists');
}
async function boundedJson(path, limit = 16 * 1024 * 1024) {
  if ((await regular(path)).size > limit) throw new Error('Assembly metadata exceeds byte limit');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('Assembly metadata exceeds byte limit');
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}
function descriptor(value) {
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0 || !validHash(value.sha256)) throw new Error('Invalid assembly integrity descriptor');
}
async function hashFile(path, expected) {
  descriptor(expected); const before = await regular(path);
  if (before.size !== expected.sizeBytes) throw new Error('Assembly source integrity mismatch');
  const hash = createHash('sha256'); let size = 0;
  for await (const bytes of createReadStream(path)) { size += bytes.length; hash.update(bytes); }
  const after = await regular(path);
  if (size !== expected.sizeBytes || hash.digest('hex') !== expected.sha256 || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error('Assembly source changed or hash integrity mismatch');
}
async function prepare(planPath, output) {
  const planFile = resolve(planPath); await noLinkedAncestors(planFile);
  const inputRoot = dirname(planFile);
  const { bytes: planBytes, value: plan } = await boundedJson(planFile, 1024 * 1024);
  shape(plan, ['version', 'projectRef', 'snapshotId', 'sourceInventory', 'artifacts', 'libraries']);
  if (plan.version !== 1 || !validId(plan.projectRef) || !validId(plan.snapshotId) || !Array.isArray(plan.artifacts) || !Array.isArray(plan.libraries) || plan.libraries.length > 10000) throw new Error('Invalid assembly plan or snapshot');
  const requestedOutput = resolve(output); await noLinkedAncestors(dirname(requestedOutput), true);
  const target = resolve(await realpath(dirname(requestedOutput)), basename(requestedOutput));
  if (inside(inputRoot, target) || inside(target, inputRoot)) throw new Error('Assembly output must be separate from source inputs');
  await absent(target);
  shape(plan.sourceInventory, ['path', 'sizeBytes', 'sha256']); descriptor(plan.sourceInventory);
  const inventoryPath = await inputPath(inputRoot, plan.sourceInventory.path);
  const { bytes: inventoryBytes, value: source } = await boundedJson(inventoryPath);
  if (inventoryBytes.length !== plan.sourceInventory.sizeBytes || digest(inventoryBytes) !== plan.sourceInventory.sha256) throw new Error('Source inventory integrity mismatch');
  shape(source, ['version', 'scope', 'projectRef', 'snapshotId', 'libraryIds', 'objects']);
  if (source.version !== 1 || source.scope !== 'full-project' || source.projectRef !== plan.projectRef || source.snapshotId !== plan.snapshotId || !Array.isArray(source.libraryIds) || !Array.isArray(source.objects)) throw new Error('Invalid full-project source inventory or snapshot');
  const libraryIds = new Set(source.libraryIds);
  if (libraryIds.size !== source.libraryIds.length || source.libraryIds.some(id => !validId(id)) || plan.libraries.length !== libraryIds.size) throw new Error('Assembly library coverage mismatch');
  const expectedObjects = new Map();
  for (const object of source.objects) {
    if (!object || !libraryIds.has(object.libraryId) || !validId(object.id) || !validHash(object.sha256) || !Number.isSafeInteger(object.size_bytes) || object.size_bytes < 0 || object.storage_backend !== 'supabase' || typeof object.storage_key !== 'string') throw new Error('Invalid assembly object inventory');
    const id = object.libraryId + ':' + object.id;
    if (expectedObjects.has(id)) throw new Error('Duplicate assembly source object');
    expectedObjects.set(id, object);
  }
  const entries = [{ source: inventoryPath, path: 'source-inventory.json', bytes: inventoryBytes, sizeBytes: inventoryBytes.length, sha256: digest(inventoryBytes) }];
  const artifacts = [], libraries = [], seenKinds = new Set(), seenLibraries = new Set(), actualObjects = new Map();
  for (const artifact of plan.artifacts) {
    shape(artifact, ['kind', 'path', 'sizeBytes', 'sha256', 'snapshotId']); descriptor(artifact);
    if (!requiredKinds.includes(artifact.kind) || seenKinds.has(artifact.kind) || artifact.snapshotId !== plan.snapshotId) throw new Error('Invalid assembly artifact or snapshot');
    seenKinds.add(artifact.kind);
    const path = 'artifacts/' + artifact.kind + '.export';
    const sourcePath = await inputPath(inputRoot, artifact.path); await hashFile(sourcePath, artifact);
    entries.push({ source: sourcePath, path, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256 });
    artifacts.push({ kind: artifact.kind, path, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256 });
  }
  if (seenKinds.size !== requiredKinds.length) throw new Error('Missing required assembly artifact');
  for (const library of plan.libraries) {
    shape(library, ['libraryId', 'path', 'manifestSha256', 'snapshotId']);
    if (!libraryIds.has(library.libraryId) || seenLibraries.has(library.libraryId) || library.snapshotId !== plan.snapshotId || !validHash(library.manifestSha256)) throw new Error('Assembly library coverage or snapshot mismatch');
    seenLibraries.add(library.libraryId);
    const root = await inputPath(inputRoot, library.path, true);
    const manifestPath = await inputPath(root, 'manifest.json');
    const { bytes, value: manifest } = await boundedJson(manifestPath);
    if (digest(bytes) !== library.manifestSha256) throw new Error('Library manifest integrity mismatch');
    const verified = await readVerifiedCloudObjectBackup(root);
    if (manifest.libraryId !== library.libraryId || JSON.stringify(verified) !== JSON.stringify(manifest)) throw new Error('Assembly library source changed or identity mismatch');
    const prefix = 'libraries/' + library.libraryId;
    libraries.push({ libraryId: library.libraryId, path: prefix, manifestSha256: library.manifestSha256 });
    entries.push({ source: manifestPath, path: prefix + '/manifest.json', bytes, sizeBytes: bytes.length, sha256: digest(bytes) });
    const hashes = new Set();
    for (const object of manifest.objects) {
      actualObjects.set(library.libraryId + ':' + object.id, object);
      if (hashes.has(object.sha256)) continue;
      hashes.add(object.sha256);
      const path = prefix + '/objects/' + object.sha256 + '.bin';
      entries.push({ source: await inputPath(root, 'objects/' + object.sha256 + '.bin'), path, sizeBytes: object.size_bytes, sha256: object.sha256 });
    }
  }
  if (actualObjects.size !== expectedObjects.size) throw new Error('Assembly historical object coverage mismatch');
  for (const [id, expected] of expectedObjects) {
    const actual = actualObjects.get(id);
    if (!actual || ['storage_key', 'storage_backend', 'size_bytes', 'sha256'].some(key => actual[key] !== expected[key])) throw new Error('Assembly object coverage mismatch');
  }
  const point = { version: 2, scope: 'project-recovery-point', complete: true, projectRef: plan.projectRef, snapshotId: plan.snapshotId, sourceInventorySha256: digest(inventoryBytes), artifacts, libraries };
  return { target, planFile, planBytes, entries, point, objects: actualObjects.size };
}
function summary(prepared, status, filesWritten) {
  return { status, scope: 'local-project-recovery-assembly', artifacts: prepared.point.artifacts.length, libraries: prepared.point.libraries.length, objects: prepared.objects, networkRequests: 0, filesWritten, snapshotConsistency: 'operator-attested', productionSnapshotVerified: false, productionRestoreVerified: false, independentStorageVerified: false };
}

/** Reads and validates explicit local exports; performs no writes and no network requests. */
export async function prepareCloudRecoveryAssembly({ planPath, output }) { return summary(await prepare(planPath, output), 'prepared', 0); }

async function copyEntry(root, entry) {
  const target = resolve(root, entry.path); await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  if (entry.bytes) { await writeFile(target, entry.bytes, { flag: 'wx', mode: 0o600 }); return; }
  const before = await regular(entry.source), hash = createHash('sha256'); let size = 0;
  const meter = new Transform({ transform(bytes, _encoding, callback) {
    size += bytes.length;
    if (size > entry.sizeBytes) { callback(new Error('Assembly source changed during copy')); return; }
    hash.update(bytes); callback(null, bytes);
  } });
  await pipeline(createReadStream(entry.source), meter, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  const after = await regular(entry.source);
  if (size !== entry.sizeBytes || hash.digest('hex') !== entry.sha256 || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error('Assembly source changed or integrity mismatch during copy');
}

/** Uses a fresh output; only a fully verified copy receives recovery-point.json. */
export async function assembleCloudRecoveryPackage({ planPath, output }) {
  const prepared = await prepare(planPath, output);
  await mkdir(prepared.target, { mode: 0o700 });
  const pending = resolve(prepared.target, '.recovery-point.pending.json');
  try {
    for (const entry of prepared.entries) await copyEntry(prepared.target, entry);
    for (const library of prepared.point.libraries) await mkdir(resolve(prepared.target, library.path, 'objects'), { recursive: true, mode: 0o700 });
    if (!Buffer.from(await readFile(prepared.planFile)).equals(prepared.planBytes)) throw new Error('Assembly plan changed during copy');
    await writeFile(pending, JSON.stringify(prepared.point, null, 2), { flag: 'wx', mode: 0o600 });
    await verifyCloudRecoveryPackage(prepared.target, resolve(prepared.target, 'source-inventory.json'), '.recovery-point.pending.json');
    await link(pending, resolve(prepared.target, 'recovery-point.json'));
    return summary(prepared, 'assembled', prepared.entries.length + 1);
  } finally { await unlink(pending).catch(() => {}); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const [planPath, output, mode, ...extra] = process.argv.slice(2);
    if (!planPath || !output || extra.length || mode && mode !== '--assemble') throw new Error('Invalid arguments');
    console.log(JSON.stringify(await (mode === '--assemble' ? assembleCloudRecoveryPackage : prepareCloudRecoveryAssembly)({ planPath, output })));
  } catch {
    console.error(JSON.stringify({ status: 'failed', code: 'RECOVERY_ASSEMBLY_INCOMPLETE_OR_INVALID', usage: 'node scripts/cloud-library-recovery-assemble.mjs <local-plan.json> <new-output-directory> [--assemble]' }));
    process.exitCode = 1;
  }
}
