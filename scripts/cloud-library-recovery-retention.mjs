/** Offline copy verification and non-destructive retention planning. Never deletes archives. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openRecoveryArchive } from './cloud-library-recovery-archive.mjs';

const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid recovery timestamp');
  return Date.parse(value);
}
async function archiveDigest(path) {
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('Unsafe recovery archive path');
  const hash = createHash('sha256'); let size = 0;
  for await (const bytes of createReadStream(path)) { size += bytes.length; hash.update(bytes); }
  const after = await lstat(path);
  if (after.isSymbolicLink() || !after.isFile() || before.size !== size || after.size !== size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || before.dev !== after.dev) throw new Error('Recovery archive changed during integrity check');
  return { sha256: hash.digest('hex'), sizeBytes: size, dev: after.dev, ino: after.ino };
}

/** A different local path is verified; only the operator can attest independent physical storage. */
export async function verifyRecoveryArchiveCopy({ sourceArchive, copyArchive, expectedSha256, output, key, now = Date.now() }) {
  if (!validHash(expectedSha256) || !Number.isSafeInteger(now) || now < 0) throw new Error('Invalid copy verification arguments');
  const source = resolve(sourceArchive), copy = resolve(copyArchive);
  if ((await realpath(source)).toLowerCase() === (await realpath(copy)).toLowerCase()) throw new Error('Recovery copy must be distinct from the same source');
  const original = await archiveDigest(source), duplicate = await archiveDigest(copy);
  if (original.ino && original.ino === duplicate.ino && original.dev === duplicate.dev) throw new Error('Recovery copy must be a distinct file, not a hard link');
  if (original.sha256 !== expectedSha256 || duplicate.sha256 !== expectedSha256 || original.sizeBytes !== duplicate.sizeBytes) throw new Error('Recovery copy hash integrity mismatch');
  const restored = await openRecoveryArchive({ archive: copy, output, key });
  const point = JSON.parse(await readFile(resolve(output, 'package/recovery-point.json'), 'utf8'));
  if (point.version !== 2 || point.complete !== true || !validId(point.projectRef) || !validId(point.snapshotId) || !validHash(point.sourceInventorySha256)) throw new Error('Recovery point lacks a bound project snapshot identity');
  if ((await archiveDigest(copy)).sha256 !== expectedSha256 || (await archiveDigest(source)).sha256 !== expectedSha256) throw new Error('Recovery archive changed after verification');
  return { version: 1, status: 'copy-verified', archiveSha256: expectedSha256, projectRef: point.projectRef, snapshotId: point.snapshotId, verifiedAt: new Date(now).toISOString(), copyIntegrityVerified: true, offlineRestoreVerified: restored.status === 'verified', independentStorageVerified: false, productionRestoreVerified: false };
}

/** Rehashes receipt-bound files, then returns IDs only. Dates/receipts are operator-maintained local metadata. */
export async function planRecoveryRetention({ entries, now = Date.now(), keepDays = 30, minimumSnapshots = 3 }) {
  if (!Array.isArray(entries) || entries.length > 10000 || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(keepDays) || keepDays < 1 || keepDays > 36500 || !Number.isSafeInteger(minimumSnapshots) || minimumSnapshots < 2 || minimumSnapshots > 1000) throw new Error('Invalid recovery retention policy');
  const ids = new Set(), paths = new Set(), hashIdentities = new Map(), projects = new Map();
  for (const entry of entries) {
    const receipt = entry?.receipt;
    if (!validId(entry?.id) || ids.has(entry.id) || typeof entry.archivePath !== 'string' || typeof entry.protected !== 'boolean'
      || !receipt || receipt.version !== 1 || receipt.status !== 'copy-verified' || !validHash(receipt.archiveSha256)
      || !validId(receipt.projectRef) || !validId(receipt.snapshotId) || receipt.copyIntegrityVerified !== true || receipt.offlineRestoreVerified !== true) throw new Error('Invalid or unverified recovery retention entry');
    const created = timestamp(entry.createdAt), verified = timestamp(receipt.verifiedAt);
    if (created > now || verified > now || created > verified) throw new Error('Invalid future recovery retention timestamp');
    const path = (await realpath(entry.archivePath)).toLowerCase();
    if (paths.has(path)) throw new Error('Duplicate recovery archive path');
    paths.add(path); ids.add(entry.id);
    if ((await archiveDigest(entry.archivePath)).sha256 !== receipt.archiveSha256) throw new Error('Retention archive hash integrity mismatch');
    const identity = receipt.projectRef + ':' + receipt.snapshotId;
    if (hashIdentities.has(receipt.archiveSha256) && hashIdentities.get(receipt.archiveSha256) !== identity) throw new Error('Conflicting recovery archive snapshot receipts');
    hashIdentities.set(receipt.archiveSha256, identity);
    if (!projects.has(receipt.projectRef)) projects.set(receipt.projectRef, new Map());
    const snapshots = projects.get(receipt.projectRef);
    if (!snapshots.has(identity)) snapshots.set(identity, { identity, created, entries: [] });
    const snapshot = snapshots.get(identity);
    // The newest declared date wins, so a duplicate cannot make a point prematurely eligible.
    snapshot.created = Math.max(snapshot.created, created);
    snapshot.entries.push({ id: entry.id, protected: entry.protected });
  }
  const keep = [], deleteCandidates = [];
  const cutoff = now - keepDays * 86400000;
  for (const snapshots of projects.values()) {
    const ordered = [...snapshots.values()].sort((a, b) => b.created - a.created || a.identity.localeCompare(b.identity));
    for (const [index, snapshot] of ordered.entries()) {
      const reason = index < minimumSnapshots ? 'minimum-distinct-snapshots' : snapshot.created >= cutoff ? 'retention-window' : snapshot.entries.some(entry => entry.protected) ? 'protected-snapshot' : null;
      for (const entry of snapshot.entries) {
        if (reason) keep.push({ id: entry.id, reason });
        else deleteCandidates.push(entry.id);
      }
    }
  }
  return { status: 'planned', keep, deleteCandidates, filesDeleted: 0, policy: { keepDays, minimumSnapshots }, archiveIntegrityRechecked: true, receiptProvenance: 'operator-maintained', independentStorageVerified: false, productionRestoreVerified: false };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'verify-copy') {
      const [sourceArchive, copyArchive, expectedSha256, output, execute, ...extra] = args;
      if (!sourceArchive || !copyArchive || !validHash(expectedSha256) || !output || extra.length || execute && execute !== '--verify') throw new Error('Invalid copy verification arguments');
      if (!execute) console.log(JSON.stringify({ status: 'prepared', filesWritten: 0, archiveRead: false, credentialsRead: false, independentStorageVerified: false, productionRestoreVerified: false }));
      else {
        const encoded = process.env.LATTICE_RECOVERY_KEY_BASE64;
        if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('Separate recovery key required');
        console.log(JSON.stringify(await verifyRecoveryArchiveCopy({ sourceArchive, copyArchive, expectedSha256, output, key: Buffer.from(encoded, 'base64') })));
      }
    } else if (mode === 'plan-retention') {
      if (args.length !== 1 || !args[0]) throw new Error('Invalid retention plan arguments');
      const file = resolve(args[0]);
      const meta = await lstat(file);
      if (!meta.isFile() || meta.isSymbolicLink() || meta.size > 16 * 1024 * 1024) throw new Error('Invalid retention catalog');
      const catalog = JSON.parse(await readFile(file, 'utf8'));
      if (!catalog || Object.keys(catalog).length !== 4 || catalog.version !== 1 || !Array.isArray(catalog.entries) || catalog.entries.some(entry => !entry || typeof entry.archivePath !== 'string')) throw new Error('Invalid retention catalog');
      const entries = catalog.entries.map(entry => ({ ...entry, archivePath: isAbsolute(entry.archivePath) ? entry.archivePath : resolve(dirname(file), entry.archivePath) }));
      console.log(JSON.stringify(await planRecoveryRetention({ entries, keepDays: catalog.keepDays, minimumSnapshots: catalog.minimumSnapshots })));
    } else throw new Error('Invalid recovery operation');
  } catch {
    console.error(JSON.stringify({ status: 'failed', code: 'RECOVERY_COPY_OR_RETENTION_INVALID', usage: 'verify-copy <source> <copy> <sha256> <new-restore-root> [--verify] | plan-retention <local-catalog.json>' }));
    process.exitCode = 1;
  }
}
