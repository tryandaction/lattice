/** Restricted PostgreSQL subprocess I/O; connection values stay off the command line and logs. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';

export function postgresConnectionEnvironment(connection) {
  const fields = ['host', 'port', 'database', 'user', 'password', 'sslMode', 'projectRef'];
  if (!connection || Object.keys(connection).length !== fields.length || fields.some(field => !Object.hasOwn(connection, field))
    || typeof connection.host !== 'string' || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535
    || typeof connection.database !== 'string' || !/^[a-zA-Z0-9_-]{1,63}$/.test(connection.database)
    || typeof connection.user !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(connection.user)
    || typeof connection.password !== 'string' || /[\u0000\r\n]/u.test(connection.password)
    || typeof connection.projectRef !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(connection.projectRef)) throw new Error('POSTGRES_CONNECTION_INVALID');
  const local = ['127.0.0.1', 'localhost', '::1'].includes(connection.host);
  const direct = connection.host === `db.${connection.projectRef}.supabase.co`;
  const pooler = /^[a-zA-Z0-9.-]+\.pooler\.supabase\.com$/u.test(connection.host) && connection.user === `postgres.${connection.projectRef}`;
  if (local ? !connection.projectRef.startsWith('synthetic-') || connection.sslMode !== 'disable'
    : !connection.password || connection.sslMode !== 'verify-full' || !(direct || pooler) || connection.database !== 'postgres') throw new Error('POSTGRES_PROJECT_ENDPOINT_MISMATCH');
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP'].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  return { ...env, PGHOST: connection.host, PGPORT: String(connection.port), PGDATABASE: connection.database, PGUSER: connection.user,
    PGPASSWORD: connection.password, PGSSLMODE: connection.sslMode, PGCONNECT_TIMEOUT: '10', PGCLIENTENCODING: 'UTF8', PGAPPNAME: 'lattice-recovery-operator',
    PGPASSFILE: resolve('.lattice-build', 'unavailable-pgpass-' + randomUUID()), PGSERVICEFILE: resolve('.lattice-build', 'unavailable-pgservice-' + randomUUID()), PSQL_HISTORY: process.platform === 'win32' ? 'NUL' : '/dev/null' };
}
export async function postgresExecutable(binDirectory, name) {
  const path = resolve(binDirectory, name + (process.platform === 'win32' ? '.exe' : ''));
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('POSTGRES_TOOL_UNAVAILABLE');
  return path;
}
export const connectionBinding = connection => createHash('sha256').update(JSON.stringify(connection)).digest('hex');

export async function runPostgresTool({ binDirectory, name, args, env, timeoutMs = 120000, input }) {
  const executable = await postgresExecutable(binDirectory, name);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', settled = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('POSTGRES_TOOL_TIMEOUT')); }, timeoutMs);
    function finish(error) { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(output); }
    child.on('error', () => finish(new Error('POSTGRES_TOOL_UNAVAILABLE')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', bytes => { output += bytes; if (Buffer.byteLength(output) > 32 * 1024 * 1024) { child.kill(); finish(new Error('POSTGRES_TOOL_OUTPUT_LIMIT')); } });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('close', code => finish(code === 0 ? null : new Error('POSTGRES_TOOL_FAILED')));
    child.stdin.end(input);
  });
}

export async function openPostgresSession({ binDirectory, env }) {
  const executable = await postgresExecutable(binDirectory, 'psql');
  const child = spawn(executable, ['-X', '-w', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], { env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  let current = null, buffer = '', terminated = false;
  const closed = new Promise(resolve => child.once('close', code => { terminated = true; current?.reject(new Error('POSTGRES_SESSION_ENDED')); current = null; resolve(code); }));
  child.on('error', () => { current?.reject(new Error('POSTGRES_SESSION_UNAVAILABLE')); current = null; terminated = true; });
  child.stderr.resume(); child.stdin.on('error', () => {});
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', bytes => {
    buffer = (buffer + bytes).replace(/\r\n/g, '\n');
    if (Buffer.byteLength(buffer) > 32 * 1024 * 1024) { current?.reject(new Error('POSTGRES_SESSION_OUTPUT_LIMIT')); current = null; child.kill(); return; }
    if (!current) return;
    const end = buffer.indexOf(current.marker + '\n');
    if (end < 0) return;
    const done = current; current = null;
    const value = buffer.slice(0, end).trim(); buffer = buffer.slice(end + done.marker.length + 1);
    done.resolve(value);
  });
  return {
    async query(sql) {
      if (terminated || current) throw new Error('POSTGRES_SESSION_NOT_READY');
      const marker = 'LATTICE_END_' + randomUUID().replaceAll('-', '');
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          timer = setTimeout(() => { if (current?.marker === marker) { current = null; child.kill(); reject(new Error('POSTGRES_SESSION_TIMEOUT')); } }, 30000);
          current = { marker, resolve, reject };
          child.stdin.write(sql + '\n\\echo ' + marker + '\n');
        });
      } finally { clearTimeout(timer); }
    },
    async close() {
      child.stdin.end('ROLLBACK;\n\\q\n');
      const timer = setTimeout(() => child.kill(), 5000);
      try { await closed; } finally { clearTimeout(timer); }
    },
  };
}
