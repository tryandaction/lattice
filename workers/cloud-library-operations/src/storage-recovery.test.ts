// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { storageRecoveryFixture } from '../test-support/storage-recovery';

const runNode = promisify(execFile);
it('prepares object restore without reading files, credentials or target configuration', async () => {
  const result = await runNode(process.execPath, ['scripts/cloud-library-storage-restore.mjs', 'absent-recovery', 'absent-inventory.json', 'synthetic-target'], { env: { ...process.env, LATTICE_RESTORE_STORAGE_TOKEN: 'must-not-be-read-or-printed' } });
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'prepared', networkRequests: 0, credentialsRead: false, filesRead: 0, writes: 0 });
  expect(result.stdout).not.toContain('must-not-be-read-or-printed');
});

describe('physical object restoration over real local HTTP', () => {
  it('restores exact 20MiB, historical and child bytes, then revalidates rather than uploading duplicates', async () => {
    const { restoreCloudStorageObjects } = await import('../../../scripts/cloud-library-storage-restore.mjs');
    const f = await storageRecoveryFixture();
    try {
      const options = { recoveryRoot: f.backup, sourceInventoryPath: f.inventoryPath, target: f.target };
      const first = await restoreCloudStorageObjects(options);
      expect(first).toMatchObject({ status: 'restored-objects', objects: 3, uploaded: 3, existingVerified: 0, targetMetadataVerified: true, allReadbackVerified: true, productionRestoreVerified: false });
      for (const [index, object] of f.objects.entries()) expect((await f.remoteBytes(object.storage_key)).equals(f.bytes[index])).toBe(true);
      expect(await restoreCloudStorageObjects(options)).toMatchObject({ status: 'restored-objects', uploaded: 0, existingVerified: 3 });
      expect(f.uploads).toHaveLength(3);
      expect(f.requests.every(request => ['GET','POST'].includes(request.method))).toBe(true);
      expect(JSON.stringify(first)).not.toMatch(/synthetic-operator-token|127\.0\.0\.1|blob-0/);
    } finally { await f.close(); }
  });

  it('accepts a lost upload acknowledgement only after downloading the actually persisted bytes', async () => {
    const { restoreCloudStorageObjects } = await import('../../../scripts/cloud-library-storage-restore.mjs');
    const f = await storageRecoveryFixture(); f.behavior.lostResponse = true;
    try {
      expect(await restoreCloudStorageObjects({ recoveryRoot: f.backup, sourceInventoryPath: f.inventoryPath, target: f.target })).toMatchObject({ status: 'restored-objects', objects: 3, allReadbackVerified: true });
      expect(f.uploads).toHaveLength(3);
    } finally { await f.close(); }
  });

  it('restores zero-byte child files and checks their empty digest on restart', async () => {
    const { restoreCloudStorageObjects } = await import('../../../scripts/cloud-library-storage-restore.mjs');
    const f = await storageRecoveryFixture({ includeEmpty: true });
    try {
      const options = { recoveryRoot: f.backup, sourceInventoryPath: f.inventoryPath, target: f.target };
      expect(await restoreCloudStorageObjects(options)).toMatchObject({ objects: 4, uploaded: 4, allReadbackVerified: true });
      expect(await f.remoteBytes(f.objects[3].storage_key)).toHaveLength(0);
      expect(await restoreCloudStorageObjects(options)).toMatchObject({ uploaded: 0, existingVerified: 4 });
      expect(f.uploads).toHaveLength(4);
    } finally { await f.close(); }
  });

  it('resumes after cancellation following persistence, keeping the verified object without uploading it again', async () => {
    const { restoreCloudStorageObjects } = await import('../../../scripts/cloud-library-storage-restore.mjs');
    const controller = new AbortController();
    const f = await storageRecoveryFixture({ afterUpload: () => controller.abort() });
    try {
      const options = { recoveryRoot: f.backup, sourceInventoryPath: f.inventoryPath, target: f.target };
      await expect(restoreCloudStorageObjects({ ...options, signal: controller.signal })).rejects.toThrow('STORAGE_RESTORE_CANCELLED');
      expect(f.uploads).toHaveLength(1);
      expect((await f.remoteBytes(f.objects[0].storage_key)).equals(f.bytes[0])).toBe(true);
      expect(await f.hasRemote(f.objects[1].storage_key)).toBe(false);
      expect(await restoreCloudStorageObjects(options)).toMatchObject({ status: 'restored-objects', uploaded: 2, existingVerified: 1, allReadbackVerified: true });
      expect(f.uploads).toHaveLength(3);
    } finally { await f.close(); }
  });

  it('does not overwrite an existing object with different bytes', async () => {
    const { restoreCloudStorageObjects } = await import('../../../scripts/cloud-library-storage-restore.mjs');
    const f = await storageRecoveryFixture(); await f.putRemote(f.objects[0].storage_key, Buffer.from('other existing bytes'));
    try {
      await expect(restoreCloudStorageObjects({ recoveryRoot: f.backup, sourceInventoryPath: f.inventoryPath, target: f.target })).rejects.toThrow(/integrity|conflict/i);
      expect(await f.remoteBytes(f.objects[0].storage_key)).toEqual(Buffer.from('other existing bytes'));
      expect(f.uploads).toEqual([]);
    } finally { await f.close(); }
  });

  it.each(['publicBucket', 'missingMetadata', 'wrongMime', 'unauthorized', 'corruptUpload', 'mutateAfterUpload'] as const)('cannot report success for %s', async fault => {
    const { restoreCloudStorageObjects } = await import('../../../scripts/cloud-library-storage-restore.mjs');
    const f = await storageRecoveryFixture(); f.behavior[fault] = true;
    try {
      let error = '';
      try { await restoreCloudStorageObjects({ recoveryRoot: f.backup, sourceInventoryPath: f.inventoryPath, target: f.target }); } catch (caught) { error = String(caught); }
      expect(error.length).toBeGreaterThan(0); expect(error).not.toMatch(/synthetic-operator-token|private reflected/);
      if (['publicBucket', 'missingMetadata', 'wrongMime', 'unauthorized'].includes(fault)) expect(f.uploads).toEqual([]);
    } finally { await f.close(); }
  });

  it('rejects a physical object larger than its descriptor before any whole-file read or network access', async () => {
    const { restoreCloudStorageObjects } = await import('../../../scripts/cloud-library-storage-restore.mjs');
    const f = await storageRecoveryFixture();
    const damaged = resolve(f.backup, 'lib-1/objects', f.objects[1].sha256 + '.bin');
    const file = await open(damaged, 'r+');
    try { await file.truncate(20 * 1024 * 1024 + 1); } finally { await file.close(); }
    const original = fs.promises.readFile; let wholeReads = 0;
    fs.promises.readFile = async function(path, ...args) {
      if (String(path) === damaged) { wholeReads++; throw new Error('WHOLE_FILE_READ_FORBIDDEN'); }
      return original(path, ...args);
    } as typeof fs.promises.readFile;
    syncBuiltinESMExports();
    try {
      await expect(restoreCloudStorageObjects({ recoveryRoot: f.backup, sourceInventoryPath: f.inventoryPath, target: f.target })).rejects.toThrow(/inventory|package/i);
      expect(wholeReads).toBe(0); expect(f.requests).toEqual([]);
    } finally { fs.promises.readFile = original; syncBuiltinESMExports(); await f.close(); }
  });

  it('rejects source identity, endpoint mismatch and altered source inventory before network writes', async () => {
    const { restoreCloudStorageObjects } = await import('../../../scripts/cloud-library-storage-restore.mjs');
    const f = await storageRecoveryFixture();
    try {
      const options = { recoveryRoot: f.backup, sourceInventoryPath: f.inventoryPath, target: f.target };
      await expect(restoreCloudStorageObjects({ ...options, target: { ...f.target, projectRef: 'synthetic-source' } })).rejects.toThrow(/source|project/i);
      await expect(restoreCloudStorageObjects({ ...options, target: { ...f.target, supabaseUrl: 'https://different.supabase.co' } })).rejects.toThrow(/endpoint|project/i);
      const inventory = JSON.parse(await readFile(f.inventoryPath, 'utf8')); inventory.objects = [];
      await writeFile(f.inventoryPath, JSON.stringify(inventory));
      await expect(restoreCloudStorageObjects(options)).rejects.toThrow(/inventory|binding/i);
      expect(f.requests).toEqual([]);
    } finally { await f.close(); }
  });

  it('does not follow redirects with operator credentials', async () => {
    const { restoreCloudStorageObjects } = await import('../../../scripts/cloud-library-storage-restore.mjs');
    let leakedRequests = 0; const other = createServer((_request, response) => { leakedRequests++; response.end('unreachable'); });
    await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve));
    const address = other.address(); if (!address || typeof address === 'string') throw new Error('No loopback port');
    const f = await storageRecoveryFixture(); f.behavior.redirect = `http://127.0.0.1:${address.port}/leak`;
    try {
      await expect(restoreCloudStorageObjects({ recoveryRoot: f.backup, sourceInventoryPath: f.inventoryPath, target: f.target })).rejects.toThrow();
      expect(leakedRequests).toBe(0); expect(f.uploads).toEqual([]);
    } finally { await f.close(); other.closeAllConnections(); await new Promise<void>(resolve => other.close(() => resolve())); }
  });
});
