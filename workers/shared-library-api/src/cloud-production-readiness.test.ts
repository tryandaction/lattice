// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectProductionReadiness, runReadinessCli, requiredMigrationNames } from '../../../scripts/cloud-production-readiness.mjs';

async function fixture() {
  await mkdir(resolve('.lattice-build'), { recursive: true });
  const rootDir = await mkdtemp(resolve('.lattice-build/production-readiness-'));
  const packageDir = resolve(rootDir, 'package');
  await mkdir(resolve(rootDir, 'supabase/migrations'), { recursive: true }); await mkdir(packageDir);
  const migrations = [], migrationSections = [];
  for (const name of requiredMigrationNames) {
    const sql = '-- ' + name + '\nselect 1;\n';
    await writeFile(resolve(rootDir, 'supabase/migrations', name), sql);
    migrations.push({ name, sha256: createHash('sha256').update(sql).digest('hex') });
    migrationSections.push('-- BEGIN ' + name + '\n' + sql + '\n-- END ' + name);
  }
  await writeFile(resolve(packageDir, 'manifest.json'), JSON.stringify({ status: 'prepared-not-deployed', productionReady: false, migrations }));
  await writeFile(resolve(packageDir, 'initialize-new-project.sql'), migrationSections.join('\n'));
  await writeFile(resolve(packageDir, 'wrangler.json'), JSON.stringify({ vars: { ALLOWED_ORIGINS: 'https://app.example.com' } }));
  const publicConfigPath = resolve(rootDir, 'public.json');
  await writeFile(publicConfigPath, JSON.stringify({ name: 'Cloud', apiUrl: 'https://project.supabase.co/functions/v1/shared-library-api', supabaseUrl: 'https://project.supabase.co', publicKey: 'sb_publishable_public_only', maxFileBytes: 20971520 }));
  const migrationLedgerPath = resolve(rootDir, 'ledger.json');
  await writeFile(migrationLedgerPath, JSON.stringify(migrations.map(row => ({ version: row.name.split('_')[0], sha256: row.sha256 }))));
  const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_public_only', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_NEVER_PRINT_SERVICE_TOKEN', GITHUB_APP_CLIENT_ID: 'Iv23EXAMPLE1234567890', GITHUB_APP_CLIENT_SECRET: 'NEVER_PRINT_GITHUB_CLIENT_SECRET_1234', GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64'), GITHUB_OAUTH_REDIRECT_URI: 'https://app.example.com/', GITHUB_APP_SLUG: 'lattice-cloud', GITHUB_OAUTH_ALLOWED_RETURN_ORIGINS: 'https://app.example.com', GITHUB_WEBHOOK_SECRET: 'NEVER_PRINT_WEBHOOK_SECRET_1234567890', ALLOWED_ORIGINS: 'https://app.example.com', TEAM_AI_PROVIDERS_JSON: JSON.stringify([{ id: 'team', label: 'Private label', apiKey: 'NEVER_PRINT_AI_SECRET', baseUrl: 'https://private-provider.example.com/v1', models: ['private-model'], maxOutputTokens: 1024, requestBudgetUsdMicros: 10000 }]) };
  return { rootDir, packageDir, publicConfigPath, migrationLedgerPath, env: { ...env, TEAM_AI_ENCRYPTION_KEY: Buffer.alloc(32, 29).toString('base64'), GITHUB_SYNC_JOB_SECRET: 'NEVER_PRINT_JOB_SECRET_1234567890123456' } };
}
describe('production readiness without side effects or sensitive output', () => {
  it('supports user-configured team AI without a deployment model API key', async () => {
    const options = await fixture();
    const env = { ...options.env, TEAM_AI_PROVIDERS_JSON: undefined, TEAM_AI_ENCRYPTION_KEY: Buffer.alloc(32, 29).toString('base64') };
    const report = await inspectProductionReadiness({ ...options, env });
    expect(report.localConfigurationReady).toBe(true);
    expect(report.environment.find(row => row.name === 'TEAM_AI_PROVIDERS_JSON')).toMatchObject({ present: false, valid: true });
    expect(report.environment.find(row => row.name === 'TEAM_AI_ENCRYPTION_KEY')).toMatchObject({ present: true, valid: true });
  });
  it('does not claim production readiness when environment or ledger is missing', async () => {
    const options = await fixture();
    const report = await inspectProductionReadiness({ ...options, env: {}, migrationLedgerPath: undefined, offline: true });
    expect(report).toMatchObject({ status: 'blocked', productionReady: false, deploymentVerified: false, networkRequests: 0, localConfigurationReady: false });
    expect(report.environment.find((row: { name: string }) => row.name === 'SUPABASE_SERVICE_ROLE_KEY')).toMatchObject({ present: false, valid: false });
    expect(report.migrations.every((row: { ledger: string }) => row.ledger === 'unprovided')).toBe(true);
  });
  it('reports only fixed field names and statuses even with every secret configured', async () => {
    const options = await fixture(); const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    try {
      const report = await inspectProductionReadiness(options);
      expect(report).toMatchObject({ status: 'configured-unverified', productionReady: false, localConfigurationReady: true, networkRequests: 0 });
      const serialized = JSON.stringify(report);
      for (const value of Object.values(options.env)) expect(serialized).not.toContain(value);
      expect(serialized).not.toContain('private-provider'); expect(serialized).not.toContain('private-model'); expect(serialized).not.toContain('Private label');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { fetchMock.mockRestore(); }
  });
  it('rejects secrets in public configuration and includes no input values or raw errors', async () => {
    const options = await fixture();
    await writeFile(options.publicConfigPath, JSON.stringify({ publicKey: options.env.SUPABASE_SERVICE_ROLE_KEY, apiUrl: 'https://public.example.com', supabaseUrl: 'https://project.supabase.co', GITHUB_APP_CLIENT_SECRET: options.env.GITHUB_APP_CLIENT_SECRET }));
    const report = await inspectProductionReadiness(options);
    expect(report).toMatchObject({ status: 'blocked', localConfigurationReady: false });
    expect(report.publicConfiguration.valid).toBe(false); expect(JSON.stringify(report)).not.toContain('NEVER_PRINT');
  });
  it('rejects malformed provider JSON, callback outside CORS and a wrong migration checksum', async () => {
    const options = await fixture();
    options.env.TEAM_AI_PROVIDERS_JSON = '{NEVER_PRINT_MALFORMED_SECRET'; options.env.GITHUB_OAUTH_REDIRECT_URI = 'https://unapproved.example.com/';
    await writeFile(options.migrationLedgerPath, JSON.stringify(requiredMigrationNames.map((name: string) => ({ version: name.split('_')[0], sha256: '0'.repeat(64) }))));
    const report = await inspectProductionReadiness(options);
    expect(report.environment.find((row: { name: string }) => row.name === 'TEAM_AI_PROVIDERS_JSON')?.valid).toBe(false);
    expect(report.callbackOriginAllowed).toBe(false); expect(report.migrations.every((row: { ledger: string }) => row.ledger === 'checksum-mismatch')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('NEVER_PRINT'); expect(JSON.stringify(report)).not.toContain('unapproved.example');
  });
  it('does not echo unrecognized CLI arguments or explicitly supplied bad file contents', async () => {
    const report = await runReadinessCli(['--secret=NEVER_PRINT_ARG']);
    expect(report).toMatchObject({ status: 'invalid-input', productionReady: false }); expect(JSON.stringify(report)).not.toContain('NEVER_PRINT_ARG');
    const options = await fixture(); await writeFile(options.migrationLedgerPath, 'NEVER_PRINT_BAD_LEDGER');
    expect(JSON.stringify(await inspectProductionReadiness(options))).not.toContain('NEVER_PRINT_BAD_LEDGER');
  });
  it('rejects an initializer whose migration marker is present but SQL content was replaced', async () => {
    const options = await fixture();
    await writeFile(resolve(options.packageDir, 'initialize-new-project.sql'), requiredMigrationNames.map(name => '-- BEGIN ' + name + '\nselect 2;\n-- END ' + name).join('\n'));
    const report = await inspectProductionReadiness(options);
    expect(report.localConfigurationReady).toBe(false); expect(report.migrations.every(row => !row.packageMatches)).toBe(true);
  });
});
