/** Read-only local preflight. No network, deployment, migration, dotenv or credential discovery. */
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const requiredMigrationNames = Object.freeze([
  '202608200001_shared_library_core.sql', '202608200002_shared_library_rls.sql',
  '202608300001_shared_library_security_hardening.sql', '202610080001_cloud_team_library.sql',
  '202610120001_cloud_member_display_names.sql', '202610130001_cloud_supabase_storage.sql',
  '202610130002_cloud_function_privileges.sql', '202610170001_cloud_large_objects.sql',
  '202610270001_cloud_team_ai.sql', '202610270002_cloud_collaboration_audit.sql',
  '202610270003_github_integration.sql', '202610270004_github_identity_unbind.sql',
  '202610280001_cloud_team_ai_owner_config.sql',
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const digest = value => createHash('sha256').update(value).digest('hex');
const present = value => typeof value === 'string' && value.trim().length > 0;
const secret = value => present(value) && value.length >= 16 && value.length <= 8192 && !/[\r\n]/.test(value) && !/[<>]/.test(value);
function httpsUrl(value, { origin = false } = {}) {
  if (!present(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && (!url.port || url.port === '443') && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(url.hostname)
      && !/(^|\.)(localhost|local|internal|invalid)$/i.test(url.hostname)
      && (!origin || value === url.origin);
  } catch { return false; }
}
function jwtRole(value, role) {
  if (typeof value !== 'string' || value.split('.').length !== 3) return false;
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')).role === role; }
  catch { return false; }
}
const publicKey = value => typeof value === 'string' && (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value) || jwtRole(value, 'anon'));
const serviceKey = value => typeof value === 'string' && (/^sb_secret_[A-Za-z0-9_-]+$/.test(value) || jwtRole(value, 'service_role'));
function encryptionKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, 'base64').length === 32 && Buffer.from(value, 'base64').toString('base64') === value;
}
function allowedOrigins(value) {
  if (!present(value)) return false;
  const origins = value.split(',').map(item => item.trim());
  return origins.length > 0 && origins.every(item => httpsUrl(item, { origin: true })
    || ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'].includes(item));
}
function aiProviders(value) {
  try {
    const providers = JSON.parse(value);
    if (!Array.isArray(providers) || !providers.length || providers.length > 32) return false;
    const ids = new Set();
    return providers.every(provider => {
      if (!record(provider) || typeof provider.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(provider.id) || ids.has(provider.id)) return false;
      ids.add(provider.id);
      return httpsUrl(provider.baseUrl) && present(provider.apiKey) && !/[\r\n]/.test(provider.apiKey)
        && Array.isArray(provider.models) && provider.models.length > 0 && provider.models.length <= 64
        && provider.models.every(model => present(model) && model.length <= 200)
        && integer(provider.maxOutputTokens, 1, 8192) && integer(provider.requestBudgetUsdMicros, 1, 1000000000);
    });
  } catch { return false; }
}
const environmentRules = Object.freeze({
  SUPABASE_URL: httpsUrl, SUPABASE_ANON_KEY: publicKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  ALLOWED_ORIGINS: allowedOrigins,
  GITHUB_APP_CLIENT_ID: value => typeof value === 'string' && /^[A-Za-z0-9_.-]{10,100}$/.test(value),
  GITHUB_APP_CLIENT_SECRET: secret, GITHUB_TOKEN_ENCRYPTION_KEY: encryptionKey,
  GITHUB_OAUTH_REDIRECT_URI: httpsUrl, GITHUB_WEBHOOK_SECRET: value => secret(value) && value.length >= 32,
  GITHUB_SYNC_JOB_SECRET: value => secret(value) && value.length >= 32,
  GITHUB_APP_SLUG: value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value),
  GITHUB_OAUTH_ALLOWED_RETURN_ORIGINS: allowedOrigins,
  TEAM_AI_ENCRYPTION_KEY: encryptionKey,
  TEAM_AI_ALLOWED_ORIGINS: value => !present(value) || value.split(',').every(origin => httpsUrl(origin.trim(), { origin: true })),
  TEAM_AI_PROVIDERS_JSON: value => !present(value) || aiProviders(value),
});
async function localFile(path, json = true, max = 2097152) {
  if (!path) return { ok: false, supplied: false };
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > max) return { ok: false, supplied: true };
    const bytes = await readFile(path);
    if (bytes.length > max) return { ok: false, supplied: true };
    return { ok: true, supplied: true, value: json ? JSON.parse(bytes.toString('utf8')) : bytes };
  } catch { return { ok: false, supplied: true }; }
}
function validPublicConfiguration(value, env) {
  if (!record(value) || Object.keys(value).some(key => !['name', 'apiUrl', 'supabaseUrl', 'publicKey', 'maxFileBytes'].includes(key))) return false;
  return httpsUrl(value.apiUrl) && httpsUrl(value.supabaseUrl) && publicKey(value.publicKey)
    && (value.name === undefined || present(value.name))
    && (value.maxFileBytes === undefined || integer(value.maxFileBytes, 1, 20971520))
    && (!present(env.SUPABASE_URL) || value.supabaseUrl.replace(/\/$/, '') === env.SUPABASE_URL.replace(/\/$/, ''))
    && (!present(env.SUPABASE_ANON_KEY) || value.publicKey === env.SUPABASE_ANON_KEY);
}

/**
 * @typedef {object} ProductionReadinessOptions
 * @property {Record<string, string | undefined>} [env]
 * @property {string} [rootDir]
 * @property {string} [packageDir]
 * @property {string} [publicConfigPath]
 * @property {string} [migrationLedgerPath]
 * @property {boolean} [offline]
 */
/**
 * All output comes from fixed names, booleans and enums; never serialize input values or exception text.
 * @param {ProductionReadinessOptions} [options]
 */
export async function inspectProductionReadiness({ env = process.env, rootDir = repositoryRoot, packageDir, publicConfigPath, migrationLedgerPath, offline = false } = {}) {
  const environment = Object.entries(environmentRules).map(([name, validate]) => ({ name, present: present(env[name]), valid: Boolean(validate(env[name])) }));
  let callbackOriginAllowed = false;
  try { callbackOriginAllowed = present(env.ALLOWED_ORIGINS) && env.ALLOWED_ORIGINS.split(',').map(item => item.trim()).includes(new URL(env.GITHUB_OAUTH_REDIRECT_URI).origin); } catch { /* Fixed boolean only. */ }
  const publicSecretEnvironmentDetected = Object.keys(env).some(name => name.startsWith('NEXT_PUBLIC_') && /SERVICE_ROLE|CLIENT_SECRET|ENCRYPTION_KEY|WEBHOOK_SECRET|TEAM_AI_PROVIDERS_JSON|API_KEY/.test(name) && present(env[name]));
  const output = packageDir ? resolve(packageDir) : resolve(rootDir, '.lattice-build/cloud-service-setup-20261027-supabase');
  const [manifest, initializer, worker, ledger] = await Promise.all([
    localFile(resolve(output, 'manifest.json')), localFile(resolve(output, 'initialize-new-project.sql'), false, 8388608),
    localFile(resolve(output, 'wrangler.json')), localFile(migrationLedgerPath, true, 16777216),
  ]);
  let publicInput;
  if (publicConfigPath) publicInput = await localFile(publicConfigPath);
  else if (present(env.NEXT_PUBLIC_LATTICE_CLOUD_SERVICE)) {
    try { publicInput = { ok: true, value: JSON.parse(env.NEXT_PUBLIC_LATTICE_CLOUD_SERVICE) }; }
    catch { publicInput = { ok: false }; }
  } else publicInput = await localFile(resolve(output, 'service-public.example.json'));
  const publicConfiguration = { present: Boolean(publicInput.ok), valid: publicInput.ok && validPublicConfiguration(publicInput.value, env) };
  const manifestValid = manifest.ok && record(manifest.value) && Array.isArray(manifest.value.migrations);
  const packageSecretsAbsent = worker.ok && record(worker.value) && record(worker.value.vars)
    && !Object.keys(worker.value.vars).some(name => ['SUPABASE_SERVICE_ROLE_KEY', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_TOKEN_ENCRYPTION_KEY', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_SYNC_JOB_SECRET', 'TEAM_AI_ENCRYPTION_KEY', 'TEAM_AI_PROVIDERS_JSON'].includes(name));
  const ledgerValid = ledger.ok && Array.isArray(ledger.value) && ledger.value.length <= 10000
    && ledger.value.every(row => record(row) && typeof row.version === 'string')
    && new Set(ledger.value.map(row => row.version)).size === ledger.value.length;
  const migrations = await Promise.all(requiredMigrationNames.map(async name => {
    const source = await localFile(resolve(rootDir, 'supabase/migrations', name), false);
    const hash = source.ok ? digest(source.value) : undefined;
    const packaged = manifestValid ? manifest.value.migrations.filter(row => record(row) && row.name === name) : [];
    const packageMatches = Boolean(hash && packaged.length === 1 && packaged[0].sha256 === hash
      && initializer.ok && initializer.value.toString('utf8').includes('-- BEGIN ' + name + '\n' + source.value.toString('utf8') + '\n-- END ' + name));
    const rows = ledgerValid ? ledger.value.filter(row => row.version === name.split('_')[0]) : [];
    const ledgerStatus = !ledger.supplied ? 'unprovided' : !ledgerValid ? 'invalid' : !rows.length ? 'missing'
      : rows[0].sha256 !== undefined && rows[0].sha256 !== hash ? 'checksum-mismatch' : 'recorded';
    return { name, repositoryPresent: source.ok, packageMatches, ledger: ledgerStatus, ledgerChecksumVerified: Boolean(rows.length && hash && rows[0].sha256 === hash) };
  }));
  const generatedPackage = { manifestValid: Boolean(manifestValid), initializerPresent: initializer.ok, workerConfigurationPresent: worker.ok, secretValuesAbsentFromWorkerVars: Boolean(packageSecretsAbsent) };
  const localConfigurationReady = environment.every(row => row.valid) && callbackOriginAllowed && !publicSecretEnvironmentDetected
    && Boolean(publicConfiguration.valid) && Boolean(manifestValid) && Boolean(packageSecretsAbsent)
    && migrations.every(row => row.repositoryPresent && row.packageMatches && row.ledger === 'recorded');
  return {
    version: 1, scope: 'local-production-readiness', mode: offline ? 'offline' : 'local-environment',
    status: localConfigurationReady ? 'configured-unverified' : 'blocked', localConfigurationReady,
    productionReady: false, deploymentVerified: false, networkRequests: 0,
    environment, callbackOriginAllowed, publicSecretEnvironmentDetected, publicConfiguration, generatedPackage, migrations,
    unverified: ['remote-migration-ledger-currentness', 'deployed-code-and-secret-bindings', 'github-app-permissions-and-installation', 'github-webhook-delivery', 'library-ai-policy-and-billing-allocation', 'real-two-account-acceptance', 'encrypted-backup-and-isolated-restore'],
  };
}
/** @param {string[]} args @param {ProductionReadinessOptions} [options] */
export async function runReadinessCli(args, options = {}) {
  try {
    const input = { ...options }, seen = new Set();
    const paths = { '--package-dir': 'packageDir', '--public-config': 'publicConfigPath', '--migration-ledger': 'migrationLedgerPath' };
    for (let index = 0; index < args.length; index++) {
      const name = args[index];
      if (seen.has(name)) throw Error('INVALID_ARGUMENTS'); seen.add(name);
      if (name === '--offline') input.offline = true;
      else if (paths[name] && typeof args[index + 1] === 'string' && !args[index + 1].startsWith('--')) input[paths[name]] = resolve(args[++index]);
      else throw Error('INVALID_ARGUMENTS');
    }
    return await inspectProductionReadiness(input);
  } catch { return { version: 1, scope: 'local-production-readiness', status: 'invalid-input', productionReady: false, deploymentVerified: false, networkRequests: 0, code: 'READINESS_INPUT_INVALID' }; }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const report = await runReadinessCli(process.argv.slice(2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'configured-unverified' ? 0 : 2;
}
