/** Real local workerd + SQLite DO; synthetic channel only, no external requests. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [miniflareModule, output, ...extra] = process.argv.slice(2);
if (!miniflareModule || !output || extra.length) throw new Error('Usage: notification-smoke <installed-miniflare-entry> <new-output>');
const { Miniflare, Response } = await import(pathToFileURL(resolve(miniflareModule)).href);
const root = resolve(output); await mkdir(root);
const event = { id: 'b'.repeat(64) + ':1', category: 'health', type: 'degraded', from: 'ok', to: 'critical', code: 'HEALTH_HTTP_FAILED', checkedAt: new Date().toISOString() };
const attempts = [], accepted = new Map(); let reject = true, healthFault = false;
const healthy = { schemaVersion: '202610170001', bucketPrivate: true, bucketMaxFileBytes: 20971520, maxFileBytes: 20971520, expiredUploads: 0, usage: { usedBytes: 1, reservedBytes: 0, maxStorageBytes: 100, supabaseService: { usedBytes: 1, reservedBytes: 0, maxStorageBytes: 100 } } };
const options = {
  name: 'notification-receiver-smoke', modules: true, scriptPath: resolve('workers/cloud-library-operations/src/index.mjs'), modulesRoot: resolve('.'), compatibilityDate: '2026-07-21',
  bindings: { NOTIFICATION_TOKEN: 'synthetic-internal-secret', API_URL: 'https://synthetic-api.invalid', LIBRARY_ID: 'synthetic-library', SUPABASE_URL: 'https://synthetic-auth.invalid', SUPABASE_PUBLIC_KEY: 'synthetic-public-key', OPERATOR_USER_ID: 'synthetic-operator', OPERATOR_REFRESH_TOKEN: 'synthetic-refresh', EXPECTED_VENDOR_PROVIDERS: 'synthetic', CLEANUP_ENABLED: 'false' },
  durableObjects: { NOTIFICATIONS: { className: 'NotificationDelivery', useSQLite: true }, OPERATIONS: { className: 'LibraryOperations', useSQLite: true } }, durableObjectsPersist: resolve(root, 'durable-state'),
  serviceBindings: { NOTIFICATION_CHANNEL: async request => {
    assert.equal(new URL(request.url).host, 'notification-channel.internal');
    const value = await request.json(); assert.equal(request.headers.get('idempotency-key'), value.id);
    if (value.id === event.id) assert.deepEqual(value, event);
    else { assert.equal(value.category, 'health'); assert.ok(['HEALTH_HTTP_FAILED', 'HEALTHY'].includes(value.code)); }
    attempts.push(value.id);
    if (reject) return Response.json({}, { status: 503 });
    accepted.set(value.id, 'synthetic-receipt');
    return Response.json({ accepted: true, eventId: value.id, receiptId: 'synthetic-receipt' });
  }, VENDOR_USAGE: async () => {
    const checkedAt = new Date().toISOString();
    return Response.json({ version: 1, checkedAt, providers: [{ provider: 'synthetic', period: checkedAt.slice(0, 7), checkedAt, requestRatio: 0.1, costRatio: 0.1 }] });
  } },
  outboundService: async request => {
    const url = new URL(request.url);
    if (url.host === 'synthetic-auth.invalid' && url.pathname === '/auth/v1/token') return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-rotated', expires_in: 3600, user: { id: 'synthetic-operator' } });
    if (url.host === 'synthetic-api.invalid' && url.pathname === '/v1/libraries/synthetic-library/health') return healthFault ? Response.json({}, { status: 503 }) : Response.json(healthy);
    throw new Error('Unexpected outbound request: real network is forbidden');
  },
};
const headers = { authorization: 'Bearer synthetic-internal-secret', 'content-type': 'application/json', 'idempotency-key': event.id };
let mf = new Miniflare(options);
const stub = async () => { const ns = await mf.getDurableObjectNamespace('NOTIFICATIONS'); return ns.get(ns.idFromName(event.id)); };
try {
  assert.equal((await mf.dispatchFetch('https://public.invalid/events', { method: 'POST', headers, body: JSON.stringify(event) })).status, 404);
  assert.equal((await (await stub()).fetch('https://notifications.internal/events', { method: 'POST', headers, body: JSON.stringify(event) })).status, 503);
  assert.equal(attempts.length, 1); assert.equal(accepted.size, 0);
  await mf.dispose(); reject = false; mf = new Miniflare(options);
  // Activate the persisted object without causing an early delivery. Its stored alarm owns the retry.
  assert.equal((await (await stub()).fetch('https://notifications.internal/events', { method: 'POST', headers, body: JSON.stringify(event) })).status, 503);
  assert.equal(attempts.length, 1);
  const start = Date.now();
  while (!accepted.size && Date.now() - start < 45000) await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(accepted.size, 1, 'Persisted workerd alarm did not retry the channel after restart');
  assert.equal(attempts.length, 2);
  const response = await (await stub()).fetch('https://notifications.internal/events', { method: 'POST', headers, body: JSON.stringify(event) });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { accepted: true, eventId: event.id, receiptId: 'synthetic-receipt' });
  assert.equal(attempts.length, 2);
  const worker = await mf.getWorker(); await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() });
  const operations = await mf.getDurableObjectNamespace('OPERATIONS');
  const monitor = operations.get(operations.idFromName('configured-library-monitor-v1'));
  healthFault = true;
  const failed = await (await monitor.fetch('https://operations.internal/tick', { method: 'POST' })).json();
  assert.equal(failed.checks.health.status, 'critical'); assert.equal(failed.pendingNotifications, 0); assert.equal(accepted.size, 2);
  healthFault = false;
  const recovered = await (await monitor.fetch('https://operations.internal/tick', { method: 'POST' })).json();
  assert.equal(recovered.checks.health.status, 'ok'); assert.equal(recovered.pendingNotifications, 0); assert.equal(accepted.size, 3);
  await monitor.fetch('https://operations.internal/tick', { method: 'POST' }); assert.equal(accepted.size, 3);
  const result = { status: 'passed', actualWorkerd: true, actualMonitorScheduled: true, monitorInternalBinding: true, sqliteRestart: true, persistedAlarmRetried: true, stableReceipt: true, healthFailureAndRecovery: true, attempts: attempts.length, uniqueSyntheticDeliveries: accepted.size, realNetworkRequests: 0, realNotifications: 0, publicRouteStatus: 404 };
  await writeFile(resolve(root, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(resolve(root, 'result.json'), JSON.stringify({ status: 'failed', attempts: attempts.length, accepted: accepted.size, error: String(error), realNetworkRequests: 0, realNotifications: 0 }, null, 2)); throw error;
} finally { await mf.dispose(); }
