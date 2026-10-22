import { runOperationsTick, retryOperationsNotifications } from "./monitor.mjs";
export { NotificationDelivery } from './notification-delivery.mjs';

export class LibraryOperations {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.pending = Promise.resolve(); }
  serialize(operation) {
    const job = this.pending.then(operation);
    this.pending = job.catch(() => {});
    return job;
  }
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/tick") return new Response(null, { status: 404 });
    try {
      const result = await this.serialize(() => runOperationsTick({ env: this.env, storage: this.ctx.storage }));
      return Response.json(result);
    } catch { return Response.json({ status: "failed", code: "OPERATIONS_STATE_OR_CONFIG_INVALID" }, { status: 503 }); }
  }
  async alarm() {
    await this.serialize(() => retryOperationsNotifications({ env: this.env, storage: this.ctx.storage }));
  }
}

const worker = {
  fetch() { return new Response(null, { status: 404 }); },
  async scheduled(_controller, env) {
    const id = env.OPERATIONS.idFromName("configured-library-monitor-v1");
    const response = await env.OPERATIONS.get(id).fetch("https://operations.internal/tick", { method: "POST" });
    if (!response.ok) throw new Error("OPERATIONS_TICK_FAILED");
  },
};
export default worker;
