// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const kinds = ['roles', 'schema', 'data', 'history-schema', 'history-data', 'repository-migrations', 'deployment-version', 'public-config'];
const runNode = promisify(execFile);
async function fixture() {
  const parent = await mkdtemp(resolve('.lattice-build/recovery-assembly-'));
  const source = resolve(parent, 'exports'); await mkdir(source);
  const snapshotId = 'maintenance-synthetic-1';
  const artifacts = [];
  for (const kind of kinds) {
    const bytes = Buffer.from('synthetic export: ' + kind);
    await writeFile(resolve(source, kind + '.fixture'), bytes);
    artifacts.push({ kind, path: kind + '.fixture', sizeBytes: bytes.length, sha256: digest(bytes), snapshotId });
  }
  const current = Buffer.from('%PDF-synthetic-current'), history = Buffer.from('historical synthetic child note');
  const objects = [current, history].map((bytes, index) => ({ id: 'blob-' + index, libraryId: 'lib-1', storage_key: 'libraries/lib-1/blobs/blob-' + index, storage_backend: 'supabase', size_bytes: bytes.length, sha256: digest(bytes) }));
  const libraries = [];
  for (const libraryId of ['lib-1', 'empty']) {
    const path = 'libraries/' + libraryId; await mkdir(resolve(source, path, 'objects'), { recursive: true });
    const rows = objects.filter(object => object.libraryId === libraryId);
    const manifest = Buffer.from(JSON.stringify({ version: 2, scope: 'member-visible-library-objects', complete: true, libraryId, objectCount: rows.length, totalBytes: rows.reduce((total, row) => total + row.size_bytes, 0), objects: rows }));
    await writeFile(resolve(source, path, 'manifest.json'), manifest);
    libraries.push({ libraryId, path, manifestSha256: digest(manifest), snapshotId });
  }
  for (const [index, object] of objects.entries()) await writeFile(resolve(source, 'libraries/lib-1/objects', object.sha256 + '.bin'), [current, history][index]);
  const inventory = { version: 1, scope: 'full-project', projectRef: 'synthetic-project', snapshotId, libraryIds: ['lib-1', 'empty'], objects };
  const inventoryBytes = Buffer.from(JSON.stringify(inventory));
  await writeFile(resolve(source, 'inventory.json'), inventoryBytes);
  const plan = { version: 1, projectRef: 'synthetic-project', snapshotId, sourceInventory: { path: 'inventory.json', sizeBytes: inventoryBytes.length, sha256: digest(inventoryBytes) }, artifacts, libraries };
  const planPath = resolve(source, 'assembly-plan.json');
  await writeFile(planPath, JSON.stringify(plan));
  return { parent, source, output: resolve(parent, 'recovery'), plan, planPath, inventory, objects, current, history };
}

describe('local project recovery assembly', () => {
  it.each(['changed-snapshot', 'changed-bytes', 'missing-binding', 'incomplete'] as const)('does not validate or seal a v2 point after %s', async defect => {
    const { assembleCloudRecoveryPackage } = await import('../../../scripts/cloud-library-recovery-assemble.mjs');
    const { verifyCloudRecoveryPackage } = await import('../../../scripts/cloud-library-recovery-verify.mjs');
    const { sealRecoveryArchive } = await import('../../../scripts/cloud-library-recovery-archive.mjs');
    const f = await fixture();
    await assembleCloudRecoveryPackage({ planPath: f.planPath, output: f.output });
    const pointFile = resolve(f.output, 'recovery-point.json');
    const point = JSON.parse(await readFile(pointFile, 'utf8'));
    const sourceFile = resolve(f.output, 'source-inventory.json');
    if (defect === 'changed-snapshot') {
      const inventory = JSON.parse(await readFile(sourceFile, 'utf8')); inventory.snapshotId = 'different-snapshot';
      await writeFile(sourceFile, JSON.stringify(inventory));
    }
    if (defect === 'changed-bytes') await writeFile(sourceFile, (await readFile(sourceFile, 'utf8')) + ' ');
    if (defect === 'missing-binding') { delete point.snapshotId; delete point.sourceInventorySha256; }
    if (defect === 'incomplete') point.complete = false;
    await writeFile(pointFile, JSON.stringify(point));
    await expect(verifyCloudRecoveryPackage(f.output, sourceFile)).rejects.toThrow(/snapshot|inventory|complete|binding/i);
    const archive = resolve(f.parent, 'invalid.lattice-backup');
    await expect(sealRecoveryArchive({ recoveryRoot: f.output, sourceInventoryPath: sourceFile, output: archive, key: randomBytes(32) })).rejects.toThrow();
    await expect(access(archive)).rejects.toThrow();
  });
  it('defaults to a no-write preflight without opening credentials or making requests', async () => {
    const f = await fixture();
    const result = await runNode(process.execPath, ['scripts/cloud-library-recovery-assemble.mjs', f.planPath, f.output]);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'prepared', libraries: 2, objects: 2, artifacts: 8, networkRequests: 0, filesWritten: 0, productionRestoreVerified: false });
    await expect(access(f.output)).rejects.toThrow();
    expect(result.stdout).not.toContain(f.source);
  });

  it('assembles current/history bytes and empty libraries, then uses the existing encrypted recovery path', async () => {
    const { assembleCloudRecoveryPackage } = await import('../../../scripts/cloud-library-recovery-assemble.mjs');
    const { sealRecoveryArchive, openRecoveryArchive } = await import('../../../scripts/cloud-library-recovery-archive.mjs');
    const f = await fixture();
    expect(await assembleCloudRecoveryPackage({ planPath: f.planPath, output: f.output })).toMatchObject({ status: 'assembled', libraries: 2, objects: 2, artifacts: 8, productionRestoreVerified: false });
    const point = JSON.parse(await readFile(resolve(f.output, 'recovery-point.json'), 'utf8'));
    expect(point).toMatchObject({ complete: true, projectRef: 'synthetic-project', snapshotId: 'maintenance-synthetic-1' });
    const key = randomBytes(32), archive = resolve(f.parent, 'independent.lattice-backup');
    await sealRecoveryArchive({ recoveryRoot: f.output, sourceInventoryPath: resolve(f.output, 'source-inventory.json'), output: archive, key });
    const restore = resolve(f.parent, 'restored');
    expect(await openRecoveryArchive({ archive, output: restore, key })).toMatchObject({ status: 'verified', libraries: 2, objects: 2 });
    for (const [index, object] of f.objects.entries()) expect(await readFile(resolve(restore, 'package/libraries/lib-1/objects', object.sha256 + '.bin'))).toEqual([f.current, f.history][index]);
    await access(resolve(restore, 'package/libraries/empty/objects'));
  });

  it.each(['missing-library', 'missing-history', 'missing-artifact', 'mixed-snapshot'] as const)('rejects %s without publishing a successful recovery point', async defect => {
    const { assembleCloudRecoveryPackage } = await import('../../../scripts/cloud-library-recovery-assemble.mjs');
    const f = await fixture();
    if (defect === 'missing-library') f.plan.libraries.pop();
    if (defect === 'missing-history') {
      const manifestPath = resolve(f.source, 'libraries/lib-1/manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.objects.pop(); manifest.objectCount = 1; manifest.totalBytes = f.current.length;
      const bytes = JSON.stringify(manifest); await writeFile(manifestPath, bytes);
      f.plan.libraries[0].manifestSha256 = digest(bytes);
    }
    if (defect === 'missing-artifact') f.plan.artifacts = f.plan.artifacts.filter(row => row.kind !== 'history-data');
    if (defect === 'mixed-snapshot') f.plan.artifacts[0].snapshotId = 'other-snapshot';
    await writeFile(f.planPath, JSON.stringify(f.plan));
    await expect(assembleCloudRecoveryPackage({ planPath: f.planPath, output: f.output })).rejects.toThrow(/coverage|snapshot|artifact/i);
    await expect(access(resolve(f.output, 'recovery-point.json'))).rejects.toThrow();
  });

  it('refuses changed artifact bytes and an existing destination without modifying either source or destination', async () => {
    const { assembleCloudRecoveryPackage } = await import('../../../scripts/cloud-library-recovery-assemble.mjs');
    const f = await fixture();
    await mkdir(f.output); await writeFile(resolve(f.output, 'keep.txt'), 'existing backup');
    await expect(assembleCloudRecoveryPackage({ planPath: f.planPath, output: f.output })).rejects.toThrow(/exist/i);
    expect(await readFile(resolve(f.output, 'keep.txt'), 'utf8')).toBe('existing backup');
    await writeFile(resolve(f.source, 'data.fixture'), 'corrupt');
    await expect(assembleCloudRecoveryPackage({ planPath: f.planPath, output: resolve(f.parent, 'different-output') })).rejects.toThrow(/integrity|hash|changed/i);
    await expect(access(resolve(f.parent, 'different-output/recovery-point.json'))).rejects.toThrow();
  });
});
