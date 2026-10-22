/** Operator-only physical restore. Never overwrites or deletes objects, buckets or database rows. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyCloudRecoveryPackage } from './cloud-library-recovery-verify.mjs';

const bucket = 'lattice-shared-library', maxObjectBytes = 20 * 1024 * 1024;
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const opaque = value => typeof value === 'string' && /^[\x21-\x7e]{1,8192}$/.test(value);
const cancelled = signal => { if (signal?.aborted) throw new Error('STORAGE_RESTORE_CANCELLED'); };
function targetUrl(target) {
  if (!target || Object.keys(target).length !== 4 || !['projectRef','supabaseUrl','publicKey','accessToken'].every(key => Object.hasOwn(target,key))
    || !id(target.projectRef) || !opaque(target.publicKey) || !opaque(target.accessToken) || typeof target.supabaseUrl !== 'string') throw new Error('STORAGE_TARGET_PROJECT_INVALID');
  let url;
  try { url = new URL(target.supabaseUrl); } catch { throw new Error('STORAGE_TARGET_ENDPOINT_INVALID'); }
  const local = url.protocol === 'http:' && target.projectRef.startsWith('synthetic-') && ['127.0.0.1','localhost','[::1]'].includes(url.hostname) && url.port;
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(local || url.protocol === 'https:' && url.hostname === `${target.projectRef}.supabase.co` && !url.port)) throw new Error('STORAGE_TARGET_PROJECT_ENDPOINT_MISMATCH');
  return url.origin;
}
async function regular(path, directory = false) {
  const parent = dirname(path); if (parent !== path) await regular(parent, true);
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !(directory ? stats.isDirectory() : stats.isFile())) throw new Error('STORAGE_BACKUP_PATH_UNSAFE');
  return stats;
}
async function localJson(path) {
  if ((await regular(path)).size > 16 * 1024 * 1024) throw new Error('STORAGE_BACKUP_METADATA_LIMIT');
  const bytes = await readFile(path);
  if (bytes.length > 16 * 1024 * 1024) throw new Error('STORAGE_BACKUP_METADATA_LIMIT');
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}
function validateObject(object, libraryIds) {
  if (!object || !id(object.id) || !libraryIds.has(object.libraryId) || object.storage_backend !== 'supabase' || !Number.isSafeInteger(object.size_bytes) || object.size_bytes < 0 || object.size_bytes > maxObjectBytes
    || typeof object.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(object.sha256) || typeof object.storage_key !== 'string'
    || !object.storage_key.startsWith(`libraries/${object.libraryId}/blobs/`) || object.storage_key.split('/').some(part => !id(part))
    || object.mime_type !== undefined && object.mime_type !== null && (typeof object.mime_type !== 'string' || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(object.mime_type))) throw new Error('STORAGE_SOURCE_OBJECT_INVALID');
}
async function recoveryPlan(recoveryRoot, sourceInventoryPath, targetRef) {
  try {
    const root = resolve(recoveryRoot); await regular(root, true);
    const { value: point } = await localJson(resolve(root, 'recovery-point.json'));
    const { bytes, value: inventory } = await localJson(resolve(sourceInventoryPath));
    if (point.version !== 2 || point.complete !== true || point.scope !== 'project-recovery-point' || !id(point.projectRef) || !id(point.snapshotId)
      || inventory.version !== 1 || inventory.scope !== 'full-project' || inventory.projectRef !== point.projectRef || inventory.snapshotId !== point.snapshotId || hash(bytes) !== point.sourceInventorySha256
      || !Array.isArray(inventory.libraryIds) || !Array.isArray(inventory.objects)) throw new Error('Invalid source binding');
    if (targetRef === point.projectRef) throw new Error('STORAGE_SOURCE_PROJECT_REFUSED');
    const libraries = new Set(inventory.libraryIds);
    if (libraries.size !== inventory.libraryIds.length || inventory.libraryIds.some(value => !id(value))) throw new Error('Invalid library set');
    const ids = new Set(), keys = new Set();
    for (const object of inventory.objects) {
      validateObject(object, libraries);
      if (ids.has(object.id) || keys.has(object.storage_key)) throw new Error('Duplicate source objects');
      ids.add(object.id); keys.add(object.storage_key);
    }
    const verified = await verifyCloudRecoveryPackage(root, sourceInventoryPath, 'recovery-point.json', { maxObjectBytes });
    if (!verified.sourceInventoryBound) throw new Error('Unbound recovery point');
    const roots = new Map(point.libraries.map(library => [library.libraryId, resolve(root, library.path)]));
    return { inventory, roots };
  } catch (error) {
    if (error instanceof Error && error.message === 'STORAGE_SOURCE_PROJECT_REFUSED') throw error;
    throw new Error('STORAGE_RECOVERY_INVENTORY_OR_PACKAGE_INVALID');
  }
}
async function bodyJson(response, maxBytes = 1024 * 1024) {
  const reader = response.body?.getReader(); if (!reader) throw new Error('STORAGE_RESPONSE_INVALID');
  let size = 0; const chunks = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) throw new Error('STORAGE_RESPONSE_LIMIT'); chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch { await reader.cancel().catch(() => {}); throw new Error('STORAGE_RESPONSE_INVALID_OR_TOO_LARGE'); }
  finally { reader.releaseLock(); }
}
async function sameBytes(response, object) {
  const reader = response.body?.getReader(); if (!reader) throw new Error('STORAGE_OBJECT_INTEGRITY_MISMATCH');
  const digest = createHash('sha256'); let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > object.size_bytes) throw new Error('Object too large'); digest.update(value); }
    if (size !== object.size_bytes || digest.digest('hex') !== object.sha256) throw new Error('Wrong object bytes');
  } catch { await reader.cancel().catch(() => {}); throw new Error('STORAGE_OBJECT_INTEGRITY_MISMATCH'); }
  finally { reader.releaseLock(); }
}
function requester(base, target, fetchImpl, signal) {
  return async (path, init = {}) => {
    cancelled(signal);
    try {
      return await fetchImpl(base + path, { ...init, redirect: 'manual', credentials: 'omit', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
        headers: { apikey: target.publicKey, authorization: 'Bearer ' + target.accessToken, ...init.headers } });
    } catch { cancelled(signal); throw new Error('STORAGE_REQUEST_UNAVAILABLE'); }
  };
}
async function privateBucket(request) {
  const response = await request('/storage/v1/bucket/' + bucket);
  if (response.status !== 200) { await response.body?.cancel(); throw new Error('STORAGE_PRIVATE_BUCKET_UNAVAILABLE'); }
  const value = await bodyJson(response);
  if (value.id !== bucket || value.public !== false || !Number.isSafeInteger(value.file_size_limit) || value.file_size_limit < maxObjectBytes) throw new Error('STORAGE_PRIVATE_BUCKET_INVALID');
}
async function metadata(request, table, select, maxRows) {
  const rows = [], seen = new Set(); let cursor = '';
  while (true) {
    const query = new URLSearchParams({ select, order: 'id.asc', limit: '1000' }); if (cursor) query.set('id', 'gt.' + cursor);
    const response = await request('/rest/v1/' + table + '?' + query.toString());
    if (response.status !== 200) { await response.body?.cancel(); throw new Error('STORAGE_TARGET_METADATA_UNAVAILABLE'); }
    const page = await bodyJson(response);
    if (!Array.isArray(page) || page.length > 1000) throw new Error('STORAGE_TARGET_METADATA_INVALID');
    if (!page.length) return rows;
    for (const row of page) {
      if (!id(row?.id) || seen.has(row.id) || cursor && row.id <= cursor || rows.length >= maxRows) throw new Error('STORAGE_TARGET_METADATA_COVERAGE_MISMATCH');
      rows.push(row); seen.add(row.id); cursor = row.id;
    }
  }
}
async function matchingMetadata(request, inventory) {
  const libraryRows = await metadata(request, 'libraries', 'id', inventory.libraryIds.length);
  if (libraryRows.length !== inventory.libraryIds.length || libraryRows.some(row => !inventory.libraryIds.includes(row.id))) throw new Error('STORAGE_TARGET_LIBRARY_COVERAGE_MISMATCH');
  const blobs = await metadata(request, 'blobs', 'id,library_id,storage_key,storage_backend,size_bytes,sha256,mime_type', inventory.objects.length);
  const expected = new Map(inventory.objects.map(object => [object.id, object]));
  if (blobs.length !== expected.size) throw new Error('STORAGE_TARGET_OBJECT_COVERAGE_MISMATCH');
  for (const row of blobs) {
    const object = expected.get(row.id);
    if (!object || row.library_id !== object.libraryId || ['storage_key','storage_backend','size_bytes','sha256'].some(key => row[key] !== object[key]) || (row.mime_type ?? null) !== (object.mime_type ?? null)) throw new Error('STORAGE_TARGET_OBJECT_METADATA_MISMATCH');
  }
}
async function existingObject(request, object) {
  const path = object.storage_key.split('/').map(encodeURIComponent).join('/');
  const response = await request('/storage/v1/object/authenticated/' + bucket + '/' + path);
  if (response.status === 200) { await sameBytes(response, object); return true; }
  if (response.status === 404) { await response.body?.cancel(); return false; }
  if (response.status === 400) {
    const error = await bodyJson(response);
    if (String(error.statusCode) === '404' || ['NoSuchKey','NoSuchObject','ResourceNotFound'].includes(error.code)) return false;
  } else await response.body?.cancel();
  throw new Error('STORAGE_OBJECT_READ_UNAVAILABLE');
}

/** Explicit operator invocation. Remote readback is the authority when resuming after a lost response.
 * @param {{recoveryRoot: string, sourceInventoryPath: string, target: {projectRef: string, supabaseUrl: string, publicKey: string, accessToken: string}, fetchImpl?: typeof fetch, signal?: AbortSignal}} options
 */
export async function restoreCloudStorageObjects({ recoveryRoot, sourceInventoryPath, target, fetchImpl = fetch, signal = undefined }) {
  const base = targetUrl(target); cancelled(signal);
  const { inventory, roots } = await recoveryPlan(recoveryRoot, sourceInventoryPath, target.projectRef);
  const request = requester(base, target, fetchImpl, signal);
  await privateBucket(request); await matchingMetadata(request, inventory);
  let uploaded = 0, existingVerified = 0, totalBytes = 0;
  for (const object of inventory.objects) {
    cancelled(signal);
    if (await existingObject(request, object)) existingVerified++;
    else {
      const path = resolve(roots.get(object.libraryId), 'objects', object.sha256 + '.bin');
      if ((await regular(path)).size !== object.size_bytes) throw new Error('STORAGE_LOCAL_OBJECT_INTEGRITY_MISMATCH');
      const chunks = []; let size = 0;
      for await (const chunk of createReadStream(path)) {
        size += chunk.length;
        if (size > object.size_bytes || size > maxObjectBytes) throw new Error('STORAGE_LOCAL_OBJECT_INTEGRITY_MISMATCH');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks, size);
      if (bytes.length !== object.size_bytes || hash(bytes) !== object.sha256) throw new Error('STORAGE_LOCAL_OBJECT_INTEGRITY_MISMATCH');
      cancelled(signal);
      try {
        const response = await request('/storage/v1/object/' + bucket + '/' + object.storage_key.split('/').map(encodeURIComponent).join('/'), { method: 'POST', headers: { 'content-type': object.mime_type ?? 'application/octet-stream', 'x-upsert': 'false', 'cache-control': 'no-store', 'content-length': String(bytes.length) }, body: bytes });
        await response.body?.cancel();
      } catch { cancelled(signal); /* The response can be lost after persistence. Verify the real object below. */ }
      if (!await existingObject(request, object)) throw new Error('STORAGE_UPLOAD_NOT_VERIFIED');
      uploaded++;
    }
    totalBytes += object.size_bytes;
  }
  await privateBucket(request); await matchingMetadata(request, inventory);
  cancelled(signal);
  return { status: 'restored-objects', objects: inventory.objects.length, libraries: inventory.libraryIds.length, uploaded, existingVerified, totalBytes,
    sourceInventoryBound: true, targetMetadataVerified: true, allReadbackVerified: true, overwriteEnabled: false, objectsDeleted: 0, productionRestoreVerified: false };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const [recoveryRoot, sourceInventoryPath, projectRef, execute, ...extra] = process.argv.slice(2);
    if (!recoveryRoot || !sourceInventoryPath || !id(projectRef) || extra.length || execute && execute !== '--restore-objects') throw new Error('Invalid storage restore arguments');
    if (!execute) console.log(JSON.stringify({ status: 'prepared', networkRequests: 0, credentialsRead: false, filesRead: 0, writes: 0, productionRestoreVerified: false }));
    else {
      const env = process.env;
      const target = { projectRef, supabaseUrl: env.LATTICE_RESTORE_SUPABASE_URL, publicKey: env.LATTICE_RESTORE_SUPABASE_PUBLIC_KEY, accessToken: env.LATTICE_RESTORE_STORAGE_TOKEN };
      console.log(JSON.stringify(await restoreCloudStorageObjects({ recoveryRoot, sourceInventoryPath, target })));
    }
  } catch { console.error(JSON.stringify({ status: 'failed', code: 'STORAGE_RESTORE_INCOMPLETE_OR_REFUSED' })); process.exitCode = 1; }
}
