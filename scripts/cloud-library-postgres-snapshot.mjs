/** Captures a database-side consistent snapshot. Storage bytes and hosted platform restoration remain separate. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, link, lstat, mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connectionBinding, openPostgresSession, postgresConnectionEnvironment, runPostgresTool } from './cloud-library-postgres-process.mjs';
import { platformCatalogSql, platformRoutineCatalogSql, quotedPlatformIdentifier as quoteIdentifier } from './cloud-library-platform-catalog.mjs';

const leases = new WeakMap();
async function safeOutput(output) {
  const target = resolve(output);
  const check = async path => {
    const parent = dirname(path); if (parent !== path) await check(parent);
    const stats = await lstat(path); if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('POSTGRES_OUTPUT_UNSAFE');
  };
  await check(dirname(target));
  try { await lstat(target); } catch (error) { if (error.code === 'ENOENT') return target; throw error; }
  throw new Error('Postgres capture output already exists');
}
async function artifact(path, kind, snapshotId) {
  const hash = createHash('sha256'); let sizeBytes = 0;
  for await (const bytes of createReadStream(path)) { hash.update(bytes); sizeBytes += bytes.length; }
  if (!Number.isSafeInteger(sizeBytes)) throw new Error('POSTGRES_CAPTURE_SIZE_INVALID');
  return { kind, path: kind + '.sql', sizeBytes, sha256: hash.digest('hex'), snapshotId };
}

/**
 * Holds the exported snapshot open for all caller-owned database reads/dumps.
 * @template T
 * @param {{ connection: object, binDirectory: string }} options
 * @param {(snapshot: Readonly<{snapshotId: string}>) => Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function withPostgresRecoverySnapshot({ connection, binDirectory }, operation) {
  const env = postgresConnectionEnvironment(connection);
  const session = await openPostgresSession({ binDirectory, env });
  const lease = Object.freeze({ snapshotId: 'pg-' + randomUUID() });
  try {
    await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL row_security=off;');
    const snapshot = await session.query('SELECT pg_export_snapshot();');
    if (!/^[a-fA-F0-9-]{1,100}$/.test(snapshot)) throw new Error('POSTGRES_SNAPSHOT_INVALID');
    const identity = JSON.parse(await session.query("SELECT json_build_object('system',system_identifier::text,'database',current_database(),'version',current_setting('server_version_num')) FROM pg_control_system();"));
    const databaseIdentitySha256 = createHash('sha256').update(identity.system + ':' + identity.database).digest('hex');
    leases.set(lease, { session, snapshot, env, binding: connectionBinding(connection), binDirectory, databaseIdentitySha256, serverVersion: String(identity.version) });
    return await operation(lease);
  } finally { leases.delete(lease); await session.close(); }
}

/** @param {{ connection: object, binDirectory: string, output: string, snapshot?: Readonly<{snapshotId: string}> }} options */
export async function capturePostgresRecoverySnapshot({ connection, binDirectory, output, snapshot }) {
  const target = await safeOutput(output);
  if (!snapshot) return withPostgresRecoverySnapshot({ connection, binDirectory }, lease => capturePostgresRecoverySnapshot({ connection, binDirectory, output, snapshot: lease }));
  const held = leases.get(snapshot);
  if (!held || held.binding !== connectionBinding(connection) || held.binDirectory !== binDirectory) throw new Error('POSTGRES_SNAPSHOT_LEASE_INVALID');
  const rows = JSON.parse(await held.session.query(`SELECT json_build_object(
    'libraryIds',coalesce((SELECT json_agg(id::text ORDER BY id) FROM public.libraries),'[]'::json),
    'objects',coalesce((SELECT json_agg(json_build_object('libraryId',library_id::text,'id',id::text,'storage_key',storage_key,'storage_backend',storage_backend,'size_bytes',size_bytes,'sha256',sha256,'mime_type',mime_type) ORDER BY library_id,id) FROM public.blobs),'[]'::json));`));
  const libraryIds = new Set(rows.libraryIds);
  if (!Array.isArray(rows.libraryIds) || libraryIds.size !== rows.libraryIds.length || !Array.isArray(rows.objects) || rows.objects.some(object => !libraryIds.has(object.libraryId) || object.storage_backend !== 'supabase' || !Number.isSafeInteger(object.size_bytes) || object.size_bytes < 0 || !/^[a-f0-9]{64}$/.test(object.sha256))) throw new Error('POSTGRES_PROJECT_INVENTORY_INVALID');
  const inventory = { version: 1, scope: 'full-project', projectRef: connection.projectRef, snapshotId: snapshot.snapshotId, libraryIds: rows.libraryIds, objects: rows.objects };
  await mkdir(target, { mode: 0o700 });
  const artifacts = [];
  const sqlKinds = [
    ['schema', ['--schema-only', '--schema=public', '--schema=auth', '--schema=storage']],
    ['data', ['--data-only', '--schema=public', '--schema=auth', '--schema=storage']],
    ['history-schema', ['--schema-only', '--schema=supabase_migrations']],
    ['history-data', ['--data-only', '--schema=supabase_migrations']],
  ];
  for (const [kind, flags] of sqlKinds) {
    const path = resolve(target, kind + '.sql');
    await runPostgresTool({ binDirectory, name: 'pg_dump', env: held.env,
      args: ['--no-password', '--no-owner', '--strict-names', '--quote-all-identifiers', '--snapshot=' + held.snapshot, '--file=' + path, ...flags] });
    artifacts.push(await artifact(path, kind, snapshot.snapshotId));
  }
  const rolesFile = resolve(target, 'roles.sql');
  await runPostgresTool({ binDirectory, name: 'pg_dumpall', env: held.env, args: ['--no-password', '--roles-only', '--no-role-passwords', '--no-comments', '--quote-all-identifiers', '--database=' + connection.database, '--file=' + rolesFile] });
  artifacts.push(await artifact(rolesFile, 'roles', snapshot.snapshotId));
  await held.session.query('SELECT 1;');
  const inventoryBytes = Buffer.from(JSON.stringify(inventory, null, 2));
  if (inventoryBytes.length > 16 * 1024 * 1024) throw new Error('POSTGRES_INVENTORY_SIZE_LIMIT');
  await writeFile(resolve(target, 'inventory.json'), inventoryBytes, { flag: 'wx', mode: 0o600 });
  const capture = { version: 1, complete: true, scope: 'postgres-database-snapshot', projectRef: connection.projectRef, snapshotId: snapshot.snapshotId,
    databaseIdentitySha256: held.databaseIdentitySha256, serverVersion: held.serverVersion, capturedAt: new Date().toISOString(),
    includedSchemas: ['public', 'auth', 'storage', 'supabase_migrations'],
    databaseSnapshotVerified: true, rolesConsistency: 'global-roles-maintenance-attested', hostedPlatformCompatibilityVerified: false,
    sourceInventory: { path: 'inventory.json', sizeBytes: inventoryBytes.length, sha256: createHash('sha256').update(inventoryBytes).digest('hex') }, artifacts };
  const pending = resolve(target, '.database-capture.pending.json');
  try { await writeFile(pending, JSON.stringify(capture, null, 2), { flag: 'wx', mode: 0o600 }); await link(pending, resolve(target, 'database-capture.json')); }
  finally { await unlink(pending).catch(() => {}); }
  return { status: 'captured', scope: 'postgres-database-snapshot', includedSchemas: ['public', 'auth', 'storage', 'supabase_migrations'], libraries: rows.libraryIds.length, objects: rows.objects.length, artifacts: artifacts.length, databaseSnapshotVerified: true, hostedPlatformCompatibilityVerified: false, productionRestoreVerified: false };
}

/**
 * Captures data for a separately initialized platform target. Never restores schema or Storage metadata.
 * @param {{ connection: object, binDirectory: string, output: string, snapshot?: Readonly<{snapshotId: string}> }} options
 */
export async function capturePostgresPlatformRecoverySnapshot({ connection, binDirectory, output, snapshot }) {
  const target = await safeOutput(output);
  if (!snapshot) return withPostgresRecoverySnapshot({ connection, binDirectory }, lease => capturePostgresPlatformRecoverySnapshot({ connection, binDirectory, output, snapshot: lease }));
  const held = leases.get(snapshot);
  if (!held || held.binding !== connectionBinding(connection) || held.binDirectory !== binDirectory) throw new Error('POSTGRES_SNAPSHOT_LEASE_INVALID');
  // Catalog and per-table counts stay in the same readonly transaction as the native dump.
  const relations = JSON.parse(await held.session.query(platformCatalogSql + ';'));
  const routines = JSON.parse(await held.session.query(platformRoutineCatalogSql + ';'));
  if (!Array.isArray(routines) || routines.length > 1000) throw new Error('POSTGRES_PLATFORM_ROUTINES_INVALID');
  if (!Array.isArray(relations) || relations.length > 1000 || !relations.some(row => row.schema === 'public' && row.name === 'libraries')
    || !relations.some(row => row.schema === 'public' && row.name === 'blobs') || !relations.some(row => row.schema === 'auth' && row.name === 'users')) throw new Error('POSTGRES_PLATFORM_CATALOG_INVALID');
  for (const relation of relations) {
    const name = quoteIdentifier(relation.schema) + '.' + quoteIdentifier(relation.name);
    if (relation.kind === 'S') {
      relation.sequence = JSON.parse(await held.session.query(`SELECT json_build_object('last_value',last_value::text,'is_called',is_called) FROM ${name};`));
      // PostgreSQL sequences are nontransactional; do not claim their value shares the exported snapshot.
    } else {
      const count = await held.session.query(`SELECT count(*) FROM ${name};`);
      relation.rows = Number(count);
      if (!Number.isSafeInteger(relation.rows) || relation.rows < 0) throw new Error('POSTGRES_PLATFORM_ROW_COUNT_INVALID');
    }
  }
  const ledger = JSON.parse(await held.session.query("SELECT coalesce(json_agg(row_to_json(t) ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations t;"));
  const buckets = JSON.parse(await held.session.query("SELECT coalesce(json_agg(row_to_json(t) ORDER BY id),'[]'::json) FROM storage.buckets t;"));
  const rows = JSON.parse(await held.session.query(`SELECT json_build_object(
    'libraryIds',coalesce((SELECT json_agg(id::text ORDER BY id) FROM public.libraries),'[]'::json),
    'objects',coalesce((SELECT json_agg(json_build_object('libraryId',library_id::text,'id',id::text,'storage_key',storage_key,'storage_backend',storage_backend,'size_bytes',size_bytes,'sha256',sha256,'mime_type',mime_type) ORDER BY library_id,id) FROM public.blobs),'[]'::json));`));
  if (!Array.isArray(ledger) || ledger.some(row => typeof row.version !== 'string') || !Array.isArray(buckets)
    || buckets.some(row => row.id !== 'lattice-shared-library' || row.public !== false || row.file_size_limit !== 20 * 1024 * 1024)
    || buckets.length !== 1 || !Array.isArray(rows.libraryIds) || !Array.isArray(rows.objects)) throw new Error('POSTGRES_PLATFORM_PROJECT_SCOPE_INVALID');
  const libraries = new Set(rows.libraryIds);
  if (libraries.size !== rows.libraryIds.length || rows.objects.some(row => !libraries.has(row.libraryId) || row.storage_backend !== 'supabase'
    || !Number.isSafeInteger(row.size_bytes) || row.size_bytes < 0 || !/^[a-f0-9]{64}$/.test(row.sha256))) throw new Error('POSTGRES_PLATFORM_INVENTORY_INVALID');
  await mkdir(target, { mode: 0o700 });
  const artifacts = [];
  const saveJson = async (path, value, kind) => {
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > 16 * 1024 * 1024) throw new Error('POSTGRES_PLATFORM_METADATA_LIMIT');
    await writeFile(resolve(target, path), bytes, { flag: 'wx', mode: 0o600 });
    artifacts.push({ kind, path, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), snapshotId: snapshot.snapshotId });
  };
  const dumpPath = resolve(target, 'platform-data.dump');
  await runPostgresTool({ binDirectory, name: 'pg_dump', env: held.env, timeoutMs: 600000, args: [
    '--no-password','--no-owner','--no-privileges','--strict-names','--quote-all-identifiers','--data-only','--format=custom',
    '--snapshot=' + held.snapshot,'--file=' + dumpPath, ...relations.map(row => '--table=' + quoteIdentifier(row.schema) + '.' + quoteIdentifier(row.name)),
  ] });
  await chmod(dumpPath, 0o600);
  const data = await artifact(dumpPath, 'platform-data', snapshot.snapshotId); data.path = 'platform-data.dump'; artifacts.push(data);
  await saveJson('catalog.json', { version: 1, snapshotId: snapshot.snapshotId, sequenceConsistency: 'unverified-nontransactional', relations, routines }, 'catalog');
  await saveJson('migration-ledger.json', ledger, 'migration-ledger');
  await saveJson('storage-config.json', { buckets, objectRowsExcluded: true, physicalFilesIncluded: false }, 'storage-config');
  await saveJson('inventory.json', { version: 1, scope: 'full-project', projectRef: connection.projectRef, snapshotId: snapshot.snapshotId, ...rows }, 'inventory');
  await held.session.query('SELECT 1;');
  const capture = { version: 1, complete: true, scope: 'lattice-platform-data-snapshot', projectRef: connection.projectRef, snapshotId: snapshot.snapshotId,
    databaseIdentitySha256: held.databaseIdentitySha256, serverVersion: held.serverVersion, capturedAt: new Date().toISOString(), artifacts,
    databaseSnapshotVerified: true, sequenceConsistency: 'unverified-nontransactional', authenticationSecretsIncluded: true,
    platformEncryptionRootKeyIncluded: false, requiresSeparatePlatformEncryptionRootKey: true, schemaRestored: false, rolesRestored: false,
    storageObjectMetadataIncluded: false, physicalStorageIncluded: false, hostedPlatformCompatibilityVerified: false, productionRestoreVerified: false };
  const pending = resolve(target, '.platform-capture.pending.json');
  try { await writeFile(pending, JSON.stringify(capture, null, 2), { flag: 'wx', mode: 0o600 }); await link(pending, resolve(target, 'platform-capture.json')); }
  finally { await unlink(pending).catch(() => {}); }
  return { status: 'captured-platform-data', tables: relations.filter(row => row.kind !== 'S').length, sequences: relations.filter(row => row.kind === 'S').length,
    artifacts: artifacts.length, databaseSnapshotVerified: true, sequenceConsistency: 'unverified-nontransactional', physicalStorageRestored: false,
    platformEncryptionRootKeyIncluded: false, hostedPlatformCompatibilityVerified: false, productionRestoreVerified: false };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const [output, projectRef, execute, ...extra] = process.argv.slice(2);
    if (!output || !/^[a-zA-Z0-9_-]{1,128}$/.test(projectRef ?? '') || extra.length || execute && execute !== '--capture') throw new Error('Invalid capture arguments');
    if (!execute) console.log(JSON.stringify({ status: 'prepared', networkRequests: 0, credentialsRead: false, filesWritten: 0, productionRestoreVerified: false }));
    else {
      const env = process.env;
      const connection = { host: env.LATTICE_BACKUP_PG_HOST, port: Number(env.LATTICE_BACKUP_PG_PORT), database: env.LATTICE_BACKUP_PG_DATABASE, user: env.LATTICE_BACKUP_PG_USER, password: env.LATTICE_BACKUP_PG_PASSWORD, sslMode: env.LATTICE_BACKUP_PG_SSLMODE, projectRef };
      if (!env.LATTICE_BACKUP_PG_BIN) throw new Error('Explicit PostgreSQL tools required');
      console.log(JSON.stringify(await capturePostgresRecoverySnapshot({ connection, binDirectory: env.LATTICE_BACKUP_PG_BIN, output })));
    }
  } catch { console.error(JSON.stringify({ status: 'failed', code: 'POSTGRES_CAPTURE_INCOMPLETE_OR_INVALID' })); process.exitCode = 1; }
}
