/** Only creates a fresh synthetic PostgreSQL cluster on loopback. Never uses an installed service. */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { closeSync, existsSync, openSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const run = promisify(execFile);
export const postgresBin = process.env.LATTICE_TEST_PG_BIN ?? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'PostgreSQL/18/bin');
export const nativePostgresAvailable = existsSync(resolve(postgresBin, process.platform === 'win32' ? 'initdb.exe' : 'initdb'));
const executable = (name: string) => resolve(postgresBin, name + (process.platform === 'win32' ? '.exe' : ''));

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return Promise.resolve();
  return new Promise(resolve => child.once('exit', () => resolve()));
}

export async function nativePostgresFixture(options: { afterStarted?: (port: number) => Promise<void> } = {}) {
  const root = await mkdtemp(resolve('.lattice-build/native-postgres-recovery-'));
  const data = resolve(root, 'pgdata'); await mkdir(data);
  const socket = createServer(); await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
  const port = address.port; await new Promise<void>(resolve => socket.close(() => resolve()));
  const systemEnv = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP'].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  const env: NodeJS.ProcessEnv = { ...systemEnv, NODE_ENV: 'test', PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'lattice_fixture_admin', PGDATABASE: 'postgres', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5', PGCLIENTENCODING: 'UTF8' };
  await run(executable('initdb'), ['--no-locale', '--encoding=UTF8', '--auth=trust', '--username=lattice_fixture_admin', '-D', data], { env, windowsHide: true, timeout: 60000 });
  let serverError: Error | undefined;
  const logFd = openSync(resolve(root, 'server.log'), 'w');
  const server = spawn(executable('postgres'), ['-D', data, '-h', '127.0.0.1', '-p', String(port), '-c', 'max_connections=10', '-c', 'log_statement=none'], { env, windowsHide: true, stdio: ['ignore', logFd, logFd] });
  closeSync(logFd);
  server.once('error', error => { serverError = error; });
  const close = async () => {
    if (server.pid === undefined || server.exitCode !== null) return;
    const exited = waitForExit(server);
    try {
      await run(executable('pg_ctl'), ['-D', data, '-w', 'stop', '-m', 'fast'], { env, windowsHide: true, timeout: 30000 });
      await exited;
    } catch (error) {
      if (server.exitCode === null) server.kill();
      await exited;
      throw error;
    }
  };
  const connection = { host: '127.0.0.1', port, database: 'lattice_source', user: 'lattice_fixture_admin', password: '', sslMode: 'disable', projectRef: 'synthetic-source' };
  const sql = (statement: string, database = connection.database) => new Promise<string>((resolve, reject) => {
    const child = execFile(executable('psql'), ['-X', '-w', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { env: { ...env, PGDATABASE: database }, windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
    child.stdin?.end(statement);
  });
  const file = async (path: string, database = connection.database) => (await run(executable('psql'), ['-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-f', path], { env: { ...env, PGDATABASE: database }, windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
  try {
    const deadline = Date.now() + 60000;
    let lastConnectionError: unknown;
    while (Date.now() < deadline) {
      if (serverError) throw serverError;
      if (server.exitCode !== null) throw new Error(`PostgreSQL fixture exited before becoming ready (code ${server.exitCode}).`);
      try {
        await run(executable('psql'), ['-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-c', 'select 1'], { env, windowsHide: true, timeout: 2000 });
        lastConnectionError = undefined;
        break;
      } catch (error) { lastConnectionError = error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (lastConnectionError) throw new Error(`PostgreSQL fixture did not become ready: ${lastConnectionError instanceof Error ? lastConnectionError.message : String(lastConnectionError)}`);
    await options.afterStarted?.(port);
    await sql('create database lattice_source;', 'postgres'); await sql('create database lattice_target;', 'postgres');
    return { root, connection, binDirectory: postgresBin, sql, file, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}
