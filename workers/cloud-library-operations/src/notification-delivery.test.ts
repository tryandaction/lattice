// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

class Storage {
  state: unknown;
  alarmAt: number | null = null;
  async get() { return structuredClone(this.state); }
  async put(_key: string, value: unknown) { this.state = structuredClone(value); }
  async setAlarm(at: number) { this.alarmAt = at; }
  async deleteAlarm() { this.alarmAt = null; }
}
const event = { id: 'a'.repeat(64) + ':1', category: 'health', type: 'degraded', from: 'ok', to: 'critical', code: 'HEALTH_HTTP_FAILED', checkedAt: '2026-10-21T00:00:00.000Z' };
const request = (body = event, token = 'synthetic-receiver-secret') => new Request('https://notifications.internal/events', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'idempotency-key': body.id }, body: JSON.stringify(body) });
function fixture() {
  const storage = new Storage();
  let failures = 0;
  const attempts: string[] = [], deliveries = new Map<string, string>();
  const env = { NOTIFICATION_TOKEN: 'synthetic-receiver-secret', NOTIFICATION_CHANNEL: { async fetch(input: Request) {
    const body = await input.json() as typeof event;
    expect(input.headers.get('idempotency-key')).toBe(body.id);
    expect(storage.state).toMatchObject({ status: 'pending', event: body });
    expect(storage.alarmAt).toBeGreaterThan(Date.now());
    attempts.push(body.id);
    if (failures-- > 0) return Response.json({}, { status: 503 });
    const receipt = deliveries.get(body.id) ?? 'synthetic-delivery-receipt'; deliveries.set(body.id, receipt);
    return Response.json({ accepted: true, eventId: body.id, receiptId: receipt });
  } } };
  return { storage, env, attempts, deliveries, fail: (value: number) => { failures = value; } };
}
async function alarmAtDeadline(receiver: { alarm(): Promise<void> }, storage: Storage) {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(storage.alarmAt ?? Date.now());
  try { await receiver.alarm(); } finally { clock.mockRestore(); }
}

describe('durable notification receiver', () => {
  it('persists before delivery and returns the same completed receipt after object restart', async () => {
    const { NotificationDelivery } = await import('./notification-delivery.mjs');
    const f = fixture();
    const first = new NotificationDelivery({ storage: f.storage }, f.env);
    const response = await first.fetch(request());
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ accepted: true, eventId: event.id, receiptId: 'synthetic-delivery-receipt' });
    expect(await (await new NotificationDelivery({ storage: f.storage }, f.env).fetch(request())).json()).toEqual(receipt);
    expect(f.attempts).toEqual([event.id]);
    expect(JSON.stringify(f.storage.state)).not.toContain('synthetic-receiver-secret');
  });

  it('retains failed channel work for alarm retry and does not acknowledge pending work', async () => {
    const { NotificationDelivery } = await import('./notification-delivery.mjs');
    const f = fixture(); f.fail(1);
    const first = await new NotificationDelivery({ storage: f.storage }, f.env).fetch(request());
    expect(first.status).toBe(503); expect(await first.json()).toMatchObject({ accepted: false });
    expect(f.deliveries.size).toBe(0);
    // A pending receipt must survive a new object instance; alarm retries the same id.
    await alarmAtDeadline(new NotificationDelivery({ storage: f.storage }, f.env), f.storage);
    expect(f.attempts).toEqual([event.id, event.id]);
    expect(f.deliveries.size).toBe(1);
    const done = await new NotificationDelivery({ storage: f.storage }, f.env).fetch(request());
    expect(done.status).toBe(200); expect(f.attempts).toHaveLength(2);
  });

  it('rejects unauthorized, mutated or invalid event bodies before channel delivery', async () => {
    const { NotificationDelivery } = await import('./notification-delivery.mjs');
    const f = fixture(), receiver = new NotificationDelivery({ storage: f.storage }, f.env);
    expect((await receiver.fetch(request(event, 'wrong'))).status).toBe(401);
    const bad = { ...event, id: event.id, code: 'error containing a secret or private message' };
    expect((await receiver.fetch(request(bad))).status).toBe(400);
    expect(f.attempts).toHaveLength(0);
    await receiver.fetch(request());
    expect((await receiver.fetch(request({ ...event, code: 'AUTHENTICATION_FAILED' }))).status).toBe(409);
    expect(f.attempts).toHaveLength(1);
  });

  it('does not acknowledge a wrong channel receipt and retries after acknowledgement persistence fails', async () => {
    const { NotificationDelivery } = await import('./notification-delivery.mjs');
    const f = fixture();
    f.env.NOTIFICATION_CHANNEL.fetch = async () => Response.json({ accepted: true, eventId: 'wrong', receiptId: 'wrong' });
    expect((await new NotificationDelivery({ storage: f.storage }, f.env).fetch(request())).status).toBe(503);
    expect(f.storage.state).toMatchObject({ status: 'pending' });
    const good = fixture(); let failOnce = true;
    const original = good.storage.put.bind(good.storage);
    good.storage.put = async (key, value) => {
      if ((value as { status: string }).status === 'delivered' && failOnce) { failOnce = false; throw new Error('synthetic durable outage'); }
      await original(key, value);
    };
    expect((await new NotificationDelivery({ storage: good.storage }, good.env).fetch(request())).status).toBe(503);
    await alarmAtDeadline(new NotificationDelivery({ storage: good.storage }, good.env), good.storage);
    expect(good.attempts).toEqual([event.id, event.id]); expect(good.deliveries.size).toBe(1);
  });
});
