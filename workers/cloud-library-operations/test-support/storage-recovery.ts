/** Real loopback HTTP and disk-backed synthetic object store; no hosted Supabase connection. */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function storageRecoveryFixture(options: { includeEmpty?: boolean; afterUpload?: (key: string) => void } = {}) {
  const root = await mkdtemp(resolve('.lattice-build/storage-recovery-'));
  const backup = resolve(root, 'backup'), remote = resolve(root, 'remote'); await mkdir(backup); await mkdir(remote);
  const bytes = [Buffer.alloc(20 * 1024 * 1024, 71), Buffer.from('synthetic historical bytes'), Buffer.from('# PDF child note\nChinese nickname and annotation metadata live in SQL.')];
  if (options.includeEmpty) bytes.push(Buffer.alloc(0));
  const objects = bytes.map((data, index) => ({ libraryId: 'lib-1', id: 'blob-' + index, storage_key: 'libraries/lib-1/blobs/blob-' + index, storage_backend: 'supabase', size_bytes: data.length, sha256: hash(data), mime_type: index === 0 ? 'application/pdf' : 'text/plain' }));
  const libraryIds = ['empty', 'lib-1'];
  const libraries = [];
  for (const libraryId of libraryIds) {
    await mkdir(resolve(backup, libraryId, 'objects'), { recursive: true });
    const rows = objects.filter(object => object.libraryId === libraryId);
    for (const object of rows) await writeFile(resolve(backup, libraryId, 'objects', object.sha256 + '.bin'), bytes[objects.indexOf(object)]);
    const manifest = JSON.stringify({ version: 2, complete: true, scope: 'member-visible-library-objects', libraryId, objectCount: rows.length, totalBytes: rows.reduce((sum, row) => sum + row.size_bytes, 0), objects: rows });
    await writeFile(resolve(backup, libraryId, 'manifest.json'), manifest);
    libraries.push({ libraryId, path: libraryId, manifestSha256: hash(manifest) });
  }
  const artifacts = [];
  for (const kind of ['roles', 'schema', 'data', 'history-schema', 'history-data', 'repository-migrations', 'deployment-version', 'public-config']) {
    const data = 'synthetic-' + kind; await writeFile(resolve(backup, kind + '.export'), data);
    artifacts.push({ kind, path: kind + '.export', sizeBytes: Buffer.byteLength(data), sha256: hash(data) });
  }
  const inventory = { version: 1, scope: 'full-project', projectRef: 'synthetic-source', snapshotId: 'synthetic-point', libraryIds, objects };
  const inventoryBytes = JSON.stringify(inventory); const inventoryPath = resolve(root, 'inventory.json'); await writeFile(inventoryPath, inventoryBytes);
  await writeFile(resolve(backup, 'recovery-point.json'), JSON.stringify({ version: 2, scope: 'project-recovery-point', complete: true, projectRef: inventory.projectRef, snapshotId: inventory.snapshotId, sourceInventorySha256: hash(inventoryBytes), artifacts, libraries }));
  const requests: Array<{ method: string; path: string }> = [], uploads: string[] = [];
  const behavior = { publicBucket: false, missingMetadata: false, wrongMime: false, lostResponse: false, corruptUpload: false, redirect: '', unauthorized: false, mutateAfterUpload: false };
  const objectPath = (key: string) => resolve(remote, hash(key) + '.bin');
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1'); const path = url.pathname;
    requests.push({ method: request.method ?? '', path });
    const json = (body: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    try {
      if (request.headers.authorization !== 'Bearer synthetic-operator-token' || request.headers.apikey !== 'synthetic-public-key' || behavior.unauthorized) { json({ error: 'private reflected synthetic-operator-token' }, 401); return; }
      if (behavior.redirect) { response.writeHead(302, { location: behavior.redirect }); response.end(); return; }
      if (path === '/storage/v1/bucket/lattice-shared-library' && request.method === 'GET') { json({ id: 'lattice-shared-library', public: behavior.publicBucket, file_size_limit: 20971520 }); return; }
      if (path === '/rest/v1/libraries' || path === '/rest/v1/blobs') {
        const rows = path.endsWith('/libraries') ? libraryIds.map(id => ({ id })) : behavior.missingMetadata ? objects.slice(0, -1) : objects.map(({ libraryId, ...row }) => ({ ...row, library_id: libraryId, mime_type: behavior.wrongMime ? 'text/plain' : row.mime_type }));
        const cursor = url.searchParams.get('id')?.replace(/^gt\./, '') ?? '';
        json(rows.filter(row => row.id > cursor).sort((a,b) => a.id.localeCompare(b.id)).slice(0, 1)); return;
      }
      const download = '/storage/v1/object/authenticated/lattice-shared-library/';
      const upload = '/storage/v1/object/lattice-shared-library/';
      if (path.startsWith(download) && request.method === 'GET') {
        const key = decodeURIComponent(path.slice(download.length));
        try { response.end(await readFile(objectPath(key))); } catch { json({ code: 'NoSuchKey', statusCode: '404' }, 404); } return;
      }
      if (path.startsWith(upload) && request.method === 'POST') {
        const key = decodeURIComponent(path.slice(upload.length));
        if (!objects.some(object => object.storage_key === key) || request.headers['x-upsert'] !== 'false') { json({ error: 'invalid upload' }, 400); return; }
        const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        let data = Buffer.concat(chunks);
        if (behavior.corruptUpload) data = Buffer.from('synthetic corruption');
        try { await writeFile(objectPath(key), data, { flag: 'wx' }); } catch { json({ code: 'ResourceAlreadyExists', statusCode: '409' }, 400); return; }
        uploads.push(key);
        options.afterUpload?.(key);
        if (behavior.mutateAfterUpload) behavior.missingMetadata = true;
        if (behavior.lostResponse) { behavior.lostResponse = false; json({ error: 'synthetic lost ack' }, 503); return; }
        json({ Key: key }); return;
      }
      json({ error: 'unsupported fixture route' }, 405);
    } catch { json({ error: 'synthetic server error' }, 500); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No synthetic endpoint');
  const target = { projectRef: 'synthetic-target', supabaseUrl: `http://127.0.0.1:${address.port}`, publicKey: 'synthetic-public-key', accessToken: 'synthetic-operator-token' };
  return { root, backup, remote, inventoryPath, target, objects, bytes, requests, uploads, behavior,
    remoteBytes: (key: string) => readFile(objectPath(key)),
    putRemote: (key: string, data: Uint8Array) => writeFile(objectPath(key), data),
    async hasRemote(key: string) { return access(objectPath(key)).then(() => true, () => false); },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
