/** Restore only to a distinct, empty PostgreSQL database. Never cleans or replaces a populated target. */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { openPostgresSession, postgresConnectionEnvironment, runPostgresTool } from './cloud-library-postgres-process.mjs';

const kinds = ['schema', 'data', 'history-schema', 'history-data', 'roles'];
async function noLinkedAncestors(path, directory = false) {
  const parent = dirname(path); if (parent !== path) await noLinkedAncestors(parent, true);
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !(directory ? stats.isDirectory() : stats.isFile())) throw new Error('POSTGRES_CAPTURE_PATH_UNSAFE');
  return stats;
}
async function stagedCapture(root, staging) {
  await noLinkedAncestors(root, true);
  const manifestPath = resolve(root, 'database-capture.json');
  if ((await noLinkedAncestors(manifestPath)).size > 1024 * 1024) throw new Error('POSTGRES_CAPTURE_MANIFEST_INVALID');
  const capture = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (capture.version !== 1 || capture.complete !== true || capture.scope !== 'postgres-database-snapshot' || capture.databaseSnapshotVerified !== true
    || typeof capture.projectRef !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(capture.projectRef)
    || typeof capture.snapshotId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(capture.snapshotId) || !/^[a-f0-9]{64}$/.test(capture.databaseIdentitySha256)
    || !Array.isArray(capture.artifacts) || capture.artifacts.length !== kinds.length || new Set(capture.artifacts.map(row => row.kind)).size !== kinds.length) throw new Error('POSTGRES_CAPTURE_MANIFEST_INVALID');
  const descriptor = capture.sourceInventory;
  if (!descriptor || descriptor.path !== 'inventory.json' || !Number.isSafeInteger(descriptor.sizeBytes) || descriptor.sizeBytes < 1 || descriptor.sizeBytes > 16 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error('POSTGRES_CAPTURE_INVENTORY_INVALID');
  const inventoryPath = resolve(root, 'inventory.json');
  if ((await noLinkedAncestors(inventoryPath)).size !== descriptor.sizeBytes) throw new Error('POSTGRES_CAPTURE_INVENTORY_INTEGRITY_MISMATCH');
  const inventoryBytes = await readFile(inventoryPath);
  if (inventoryBytes.length !== descriptor.sizeBytes || createHash('sha256').update(inventoryBytes).digest('hex') !== descriptor.sha256) throw new Error('POSTGRES_CAPTURE_INVENTORY_INTEGRITY_MISMATCH');
  const inventory = JSON.parse(inventoryBytes.toString('utf8'));
  if (inventory.version !== 1 || inventory.scope !== 'full-project' || inventory.projectRef !== capture.projectRef || inventory.snapshotId !== capture.snapshotId || !Array.isArray(inventory.libraryIds) || !Array.isArray(inventory.objects)) throw new Error('POSTGRES_CAPTURE_INVENTORY_BINDING_INVALID');
  for (const artifact of capture.artifacts) {
    if (!kinds.includes(artifact.kind) || artifact.path !== artifact.kind + '.sql' || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0 || !/^[a-f0-9]{64}$/.test(artifact.sha256) || artifact.snapshotId !== capture.snapshotId) throw new Error('POSTGRES_CAPTURE_ARTIFACT_INVALID');
    const source = resolve(root, artifact.path); await noLinkedAncestors(source);
    const hash = createHash('sha256'); let size = 0;
    const meter = new Transform({ transform(bytes, _encoding, callback) { size += bytes.length; if (size > artifact.sizeBytes) { callback(new Error('POSTGRES_CAPTURE_INTEGRITY_MISMATCH')); return; } hash.update(bytes); callback(null, bytes); } });
    await pipeline(createReadStream(source), meter, createWriteStream(resolve(staging, artifact.path), { flags: 'wx', mode: 0o600 }));
    if (size !== artifact.sizeBytes || hash.digest('hex') !== artifact.sha256) throw new Error('POSTGRES_CAPTURE_INTEGRITY_MISMATCH');
  }
  // Hex data is a SQL literal with no parser metacharacters. Keep it off argv.
  const verificationSql = `DO $lattice_verify$ DECLARE expected jsonb := convert_from(decode('${inventoryBytes.toString('hex')}','hex'),'UTF8')::jsonb; observed jsonb; BEGIN
    SELECT jsonb_build_object('libraryIds',coalesce((SELECT jsonb_agg(id::text ORDER BY id) FROM public.libraries),'[]'::jsonb),
      'objects',coalesce((SELECT jsonb_agg(jsonb_build_object('libraryId',library_id::text,'id',id::text,'storage_key',storage_key,'storage_backend',storage_backend,'size_bytes',size_bytes,'sha256',sha256,'mime_type',mime_type) ORDER BY library_id,id) FROM public.blobs),'[]'::jsonb)) INTO observed;
    IF observed <> jsonb_build_object('libraryIds',expected->'libraryIds','objects',expected->'objects') THEN RAISE EXCEPTION 'Restored inventory mismatch'; END IF;
  END $lattice_verify$;`;
  await writeFile(resolve(staging, 'verify-inventory.sql'), verificationSql, { flag: 'wx', mode: 0o600 });
  return capture;
}
const emptyTargetCondition = `EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema'))
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public')
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public')
  OR EXISTS(SELECT 1 FROM pg_extension WHERE extname<>'plpgsql')`;

/** No global role SQL is executed. Required application roles must exist on the operator-prepared target. */
export async function restorePostgresRecoverySnapshot({ captureRoot, connection, binDirectory }) {
  const env = postgresConnectionEnvironment(connection);
  const staging = await mkdtemp(resolve(tmpdir(), 'lattice-postgres-restore-'));
  let session;
  try {
    const capture = await stagedCapture(resolve(captureRoot), staging);
    if (capture.projectRef === connection.projectRef) throw new Error('POSTGRES_RESTORE_SOURCE_PROJECT_REFUSED');
    session = await openPostgresSession({ binDirectory, env });
    const target = JSON.parse(await session.query(`SELECT json_build_object('system',system_identifier::text,'database',current_database(),'nonempty',(${emptyTargetCondition})) FROM pg_control_system();`));
    const identity = createHash('sha256').update(target.system + ':' + target.database).digest('hex');
    if (identity === capture.databaseIdentitySha256) throw new Error('POSTGRES_RESTORE_SOURCE_IDENTITY_REFUSED');
    if (target.nonempty) throw new Error('POSTGRES_RESTORE_TARGET_NONEMPTY');
    await session.close(); session = null;
    // The same identity/empty guards run again within the restore transaction.
    const guard = `DO $lattice$ BEGIN
      IF (SELECT encode(sha256(convert_to(system_identifier::text || ':' || current_database(),'UTF8')),'hex') FROM pg_control_system())='${capture.databaseIdentitySha256}' THEN RAISE EXCEPTION 'Source identity refused'; END IF;
      IF (${emptyTargetCondition}) THEN RAISE EXCEPTION 'Target must be empty'; END IF;
    END $lattice$;`;
    await runPostgresTool({ binDirectory, name: 'psql', env, timeoutMs: 600000, args: [
      '-X', '-w', '-q', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-c', guard,
      '-c', 'DROP SCHEMA public;', '-f', resolve(staging, 'schema.sql'), '-f', resolve(staging, 'history-schema.sql'),
      '-c', 'SET session_replication_role=replica;', '-f', resolve(staging, 'data.sql'), '-f', resolve(staging, 'history-data.sql'),
      '-c', 'SET session_replication_role=origin;', '-f', resolve(staging, 'verify-inventory.sql'),
    ] });
    return { status: 'restored-isolated-postgres', databaseRestored: true, inventoryVerifiedInTransaction: true, sameSourceRefused: true, nonemptyTargetRefused: true, artifacts: 4,
      rolesRestored: false, globalRoles: 'operator-prepared', physicalStorageRestored: false, hostedPlatformCompatibilityVerified: false, productionRestoreVerified: false };
  } finally {
    await session?.close();
    // Only this function's unique private staging tree is removed; never the capture or database path.
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const [captureRoot, targetProjectRef, execute, ...extra] = process.argv.slice(2);
    if (!captureRoot || !/^[a-zA-Z0-9_-]{1,128}$/.test(targetProjectRef ?? '') || extra.length || execute && execute !== '--restore-empty-target') throw new Error('Invalid restore arguments');
    if (!execute) console.log(JSON.stringify({ status: 'prepared', databaseWrites: 0, credentialsRead: false, filesRead: 0, productionRestoreVerified: false }));
    else {
      const env = process.env;
      if (!env.LATTICE_RESTORE_PG_BIN) throw new Error('Explicit PostgreSQL tools required');
      const connection = { host: env.LATTICE_RESTORE_PG_HOST, port: Number(env.LATTICE_RESTORE_PG_PORT), database: env.LATTICE_RESTORE_PG_DATABASE, user: env.LATTICE_RESTORE_PG_USER, password: env.LATTICE_RESTORE_PG_PASSWORD, sslMode: env.LATTICE_RESTORE_PG_SSLMODE, projectRef: targetProjectRef };
      console.log(JSON.stringify(await restorePostgresRecoverySnapshot({ captureRoot, connection, binDirectory: env.LATTICE_RESTORE_PG_BIN })));
    }
  } catch { console.error(JSON.stringify({ status: 'failed', code: 'POSTGRES_RESTORE_REFUSED_OR_FAILED' })); process.exitCode = 1; }
}
