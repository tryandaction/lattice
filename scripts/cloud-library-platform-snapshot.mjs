/** Explicit operator-only data capture for a separately initialized Supabase platform. */
import { pathToFileURL } from 'node:url';
import { capturePostgresPlatformRecoverySnapshot } from './cloud-library-postgres-snapshot.mjs';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const [output, projectRef, execute, ...extra] = process.argv.slice(2);
    if (!output || !/^[a-zA-Z0-9_-]{1,128}$/.test(projectRef ?? '') || extra.length || execute && execute !== '--capture') throw new Error('Invalid platform capture arguments');
    if (!execute) console.log(JSON.stringify({ status: 'prepared', filesRead: 0, credentialsRead: false, networkRequests: 0, filesWritten: 0, productionRestoreVerified: false }));
    else {
      const env = process.env;
      if (!env.LATTICE_BACKUP_PG_BIN) throw new Error('Explicit PostgreSQL tools required');
      const connection = { host: env.LATTICE_BACKUP_PG_HOST, port: Number(env.LATTICE_BACKUP_PG_PORT), database: env.LATTICE_BACKUP_PG_DATABASE, user: env.LATTICE_BACKUP_PG_USER, password: env.LATTICE_BACKUP_PG_PASSWORD, sslMode: env.LATTICE_BACKUP_PG_SSLMODE, projectRef };
      console.log(JSON.stringify(await capturePostgresPlatformRecoverySnapshot({ connection, binDirectory: env.LATTICE_BACKUP_PG_BIN, output })));
    }
  } catch { console.error(JSON.stringify({ status: 'failed', code: 'PLATFORM_CAPTURE_INCOMPLETE_OR_INVALID' })); process.exitCode = 1; }
}
