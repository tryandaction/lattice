/** Internal durable receiver; public Worker routes remain closed. */
const fields = ['id', 'category', 'type', 'from', 'to', 'code', 'checkedAt'];
const ranks = { ok: 0, warning: 1, critical: 2 };
const eventId = value => typeof value === 'string' && /^[a-f0-9]{64}:[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value.split(':')[1]));
function validEvent(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key))
    && eventId(value.id) && ['health', 'vendor', 'cleanup'].includes(value.category) && ['degraded', 'recovered'].includes(value.type)
    && Object.hasOwn(ranks, value.from) && Object.hasOwn(ranks, value.to) && /^[A-Z][A-Z0-9_]{0,127}$/.test(value.code)
    && value.type === (ranks[value.to] < ranks[value.from] ? 'recovered' : 'degraded')
    && typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt)) && new Date(value.checkedAt).toISOString() === value.checkedAt;
}
const canonical = event => JSON.stringify(Object.fromEntries(fields.map(key => [key, event[key]])));
const failure = (status, code) => Response.json({ accepted: false, code }, { status });
function validateState(state) {
  if (!state || state.version !== 1 || !validEvent(state.event) || !['pending', 'delivered'].includes(state.status)
    || !Number.isSafeInteger(state.attempts) || state.attempts < 0 || !Number.isSafeInteger(state.nextAttemptAt) || state.nextAttemptAt < 0
    || state.status === 'delivered' && (typeof state.receiptId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(state.receiptId))) throw new Error('Invalid notification durable state');
}
async function boundedBody(request) {
  if (!request.body) throw new Error('Empty notification body');
  const reader = request.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 8192) throw new Error('Notification body too large'); chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export class NotificationDelivery {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.pending = Promise.resolve(); }
  /** @template T @param {() => Promise<T>} operation @returns {Promise<T>} */
  serialize(operation) { const job = this.pending.then(operation); this.pending = job.catch(() => {}); return job; }
  async attempt(state) {
    validateState(state);
    if (state.status === 'delivered') return state;
    const now = Date.now();
    if (state.nextAttemptAt > now) { await this.ctx.storage.setAlarm(state.nextAttemptAt); return state; }
    if (!this.env.NOTIFICATION_CHANNEL) { await this.ctx.storage.setAlarm(now + 3600000); return state; }
    state = { ...state, attempts: state.attempts + 1, nextAttemptAt: now + Math.min(3600000, 30000 * 2 ** Math.min(7, state.attempts)) };
    // Persist pending and its next alarm before starting the channel side effect.
    await this.ctx.storage.put('delivery', state);
    await this.ctx.storage.setAlarm(state.nextAttemptAt);
    let reply;
    try {
      const response = await this.env.NOTIFICATION_CHANNEL.fetch(new Request('https://notification-channel.internal/events', {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': state.event.id },
        body: canonical(state.event), redirect: 'manual', signal: AbortSignal.timeout(5000),
      }));
      if (response.status !== 200) { await response.body?.cancel(); return state; }
      reply = await boundedBody(response);
    } catch { return state; }
    if (reply?.accepted !== true || reply.eventId !== state.event.id || typeof reply.receiptId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(reply.receiptId)) return state;
    const delivered = { ...state, status: 'delivered', receiptId: reply.receiptId };
    await this.ctx.storage.put('delivery', delivered);
    await this.ctx.storage.deleteAlarm();
    return delivered;
  }
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/events') return new Response(null, { status: 404 });
    if (typeof this.env.NOTIFICATION_TOKEN !== 'string' || !this.env.NOTIFICATION_TOKEN || request.headers.get('authorization') !== 'Bearer ' + this.env.NOTIFICATION_TOKEN) return failure(401, 'NOTIFICATION_UNAUTHORIZED');
    let event;
    try { event = await boundedBody(request); } catch { return failure(400, 'NOTIFICATION_INVALID'); }
    if (!validEvent(event) || request.headers.get('idempotency-key') !== event.id) return failure(400, 'NOTIFICATION_INVALID');
    try {
      return await this.serialize(async () => {
        let state = await this.ctx.storage.get('delivery');
        if (state) {
          validateState(state);
          if (canonical(state.event) !== canonical(event)) return failure(409, 'NOTIFICATION_ID_CONFLICT');
        } else {
          state = { version: 1, event, status: 'pending', attempts: 0, nextAttemptAt: 0 };
          await this.ctx.storage.put('delivery', state);
        }
        state = await this.attempt(state);
        return state.status === 'delivered'
          ? Response.json({ accepted: true, eventId: event.id, receiptId: state.receiptId }) : failure(503, 'NOTIFICATION_PENDING');
      });
    } catch { return failure(503, 'NOTIFICATION_STATE_UNAVAILABLE'); }
  }
  async alarm() {
    await this.serialize(async () => {
      const state = await this.ctx.storage.get('delivery');
      if (!state) return;
      await this.attempt(state);
    });
  }
}
