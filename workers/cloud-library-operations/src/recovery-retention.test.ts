// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const runNode = promisify(execFile);
async function recoveryArchive(snapshotId = 'snapshot-1') {
  const parent = await mkdtemp(resolve('.lattice-build/recovery-retention-'));
  const root = resolve(parent, 'source'); await mkdir(root);
  const artifacts = [];
  for (const kind of ['roles', 'schema', 'data', 'history-schema', 'history-data', 'repository-migrations', 'deployment-version', 'public-config']) {
    const bytes = 'synthetic-' + kind; await writeFile(resolve(root, kind + '.fixture'), bytes);
    artifacts.push({ kind, path: kind + '.fixture', sizeBytes: Buffer.byteLength(bytes), sha256: digest(bytes) });
  }
  const sourceInventoryPath = resolve(parent, 'inventory.json');
  const inventoryBytes = JSON.stringify({ version: 1, scope: 'full-project', projectRef: 'synthetic-project', snapshotId, libraryIds: [], objects: [] });
  await writeFile(sourceInventoryPath, inventoryBytes);
  await writeFile(resolve(root, 'recovery-point.json'), JSON.stringify({ version: 2, complete: true, scope: 'project-recovery-point', projectRef: 'synthetic-project', snapshotId, sourceInventorySha256: digest(inventoryBytes), artifacts, libraries: [] }));
  const { sealRecoveryArchive } = await import('../../../scripts/cloud-library-recovery-archive.mjs');
  const archive = resolve(parent, 'original.lattice-backup'), copy = resolve(parent, 'copy.lattice-backup'), key = randomBytes(32);
  const sealed = await sealRecoveryArchive({ recoveryRoot: root, sourceInventoryPath, output: archive, key });
  await copyFile(archive, copy);
  return { parent, archive, copy, key, sha256: sealed.sha256, restore: resolve(parent, 'copy-restore') };
}

describe('independent archive copy and retention planning', () => {
  it('keeps CLI copy verification in no-write preparation unless explicitly executed', async () => {
    const f = await recoveryArchive();
    const result = await runNode(process.execPath, ['scripts/cloud-library-recovery-retention.mjs', 'verify-copy', f.archive, f.copy, f.sha256, f.restore], { env: { ...process.env, LATTICE_RECOVERY_KEY_BASE64: 'invalid-must-not-be-read-during-prepare' } });
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'prepared', filesWritten: 0, archiveRead: false, credentialsRead: false, productionRestoreVerified: false });
    await expect(access(f.restore)).rejects.toThrow();
  });
  it('verifies both archive hashes and actually restores the copy without claiming physically independent storage', async () => {
    const { verifyRecoveryArchiveCopy } = await import('../../../scripts/cloud-library-recovery-retention.mjs');
    const f = await recoveryArchive();
    const result = await verifyRecoveryArchiveCopy({ sourceArchive: f.archive, copyArchive: f.copy, expectedSha256: f.sha256, output: f.restore, key: f.key });
    expect(result).toMatchObject({ version: 1, status: 'copy-verified', archiveSha256: f.sha256, projectRef: 'synthetic-project', snapshotId: 'snapshot-1', copyIntegrityVerified: true, independentStorageVerified: false, productionRestoreVerified: false });
    expect(await readFile(resolve(f.restore, 'package/data.fixture'), 'utf8')).toBe('synthetic-data');
    expect(JSON.stringify(result)).not.toContain(f.parent);
    expect(JSON.stringify(result)).not.toContain(f.key.toString('base64'));
  });

  it('rejects the same source and damaged copies without producing a verified restore', async () => {
    const { verifyRecoveryArchiveCopy } = await import('../../../scripts/cloud-library-recovery-retention.mjs');
    const f = await recoveryArchive();
    await expect(verifyRecoveryArchiveCopy({ sourceArchive: f.archive, copyArchive: f.archive, expectedSha256: f.sha256, output: f.restore, key: f.key })).rejects.toThrow(/same|distinct|independent/i);
    await writeFile(f.copy, 'damaged');
    await expect(verifyRecoveryArchiveCopy({ sourceArchive: f.archive, copyArchive: f.copy, expectedSha256: f.sha256, output: f.restore, key: f.key })).rejects.toThrow(/integrity|hash/i);
    await expect(access(f.restore)).rejects.toThrow();
  });

  it('plans only old verified archives while keeping minimum distinct snapshots and protected points', async () => {
    const { planRecoveryRetention, verifyRecoveryArchiveCopy } = await import('../../../scripts/cloud-library-recovery-retention.mjs');
    const f = await recoveryArchive();
    const make = async (id: string, date: string, snapshotId = id, protectedPoint = false) => {
      const source = await recoveryArchive(snapshotId);
      const archivePath = resolve(f.parent, id + '.lattice-backup'); await copyFile(source.archive, archivePath);
      const receipt = await verifyRecoveryArchiveCopy({ sourceArchive: source.archive, copyArchive: archivePath, expectedSha256: source.sha256, output: source.restore, key: source.key, now: Date.parse('2026-10-21T00:00:00Z') });
      return { id, archivePath, createdAt: date, protected: protectedPoint, receipt };
    };
    const entries = [await make('old', '2026-07-01T00:00:00.000Z'), await make('protected', '2026-08-01T00:00:00.000Z', 'protected', true), await make('latest', '2026-10-20T00:00:00.000Z'), await make('previous', '2026-10-19T00:00:00.000Z')];
    const result = await planRecoveryRetention({ entries, now: Date.parse('2026-10-21T00:00:00Z'), keepDays: 30, minimumSnapshots: 2 });
    expect(result).toMatchObject({ status: 'planned', filesDeleted: 0, productionRestoreVerified: false });
    expect(result.deleteCandidates).toEqual(['old']);
    expect(result.keep.map(row => row.id).sort()).toEqual(['latest', 'previous', 'protected']);
    for (const entry of entries) await access(entry.archivePath);
  });

  it('does not count duplicate snapshots as separate recovery points and fails closed if retained archives change', async () => {
    const { planRecoveryRetention, verifyRecoveryArchiveCopy } = await import('../../../scripts/cloud-library-recovery-retention.mjs');
    const f = await recoveryArchive();
    const receipt = await verifyRecoveryArchiveCopy({ sourceArchive: f.archive, copyArchive: f.copy, expectedSha256: f.sha256, output: f.restore, key: f.key, now: Date.parse('2026-10-21T00:00:00Z') });
    const entries = [{ id: 'one', archivePath: f.archive, createdAt: '2026-07-01T00:00:00.000Z', protected: false, receipt }, { id: 'two', archivePath: f.copy, createdAt: '2026-07-01T00:00:00.000Z', protected: false, receipt }];
    const options = { entries, now: Date.parse('2026-10-21T00:00:00Z'), keepDays: 30, minimumSnapshots: 2 };
    expect((await planRecoveryRetention(options)).deleteCandidates).toEqual([]);
    await writeFile(f.copy, 'changed');
    await expect(planRecoveryRetention(options)).rejects.toThrow(/integrity|hash/i);
    await access(f.archive); await access(f.copy);
  });
});
