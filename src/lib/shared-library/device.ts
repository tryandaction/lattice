/**
 * Device identity boundary.
 *
 * A device gets a stable `deviceId` on first run and persists it, so every
 * operation can carry a per-device idempotency key (`deviceId:clientSequence`)
 * and the server can manage sessions per device. The store is swappable —
 * localStorage on Web, Tauri store on Desktop, in-memory in tests.
 */

export interface DeviceIdentity {
  /** Opaque, stable uuid. Never derived from a path or platform detail. */
  deviceId: string;
  /** ISO-8601 install timestamp. */
  installedAt: string;
  platform: "web" | "desktop";
  label?: string;
}

export interface DeviceStore {
  getDeviceIdentity(): Promise<DeviceIdentity | null>;
  saveDeviceIdentity(identity: DeviceIdentity): Promise<void>;
}

export class InMemoryDeviceStore implements DeviceStore {
  private identity: DeviceIdentity | null = null;

  async getDeviceIdentity(): Promise<DeviceIdentity | null> {
    return this.identity;
  }

  async saveDeviceIdentity(identity: DeviceIdentity): Promise<void> {
    this.identity = identity;
  }
}

export interface CreateDeviceIdentityInput {
  store: DeviceStore;
  platform: "web" | "desktop";
  label?: string;
  /** Injectable for deterministic tests. */
  generateId?: () => string;
  /** Injectable for deterministic tests. */
  now?: () => string;
}

function defaultGenerateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function loadOrCreateDeviceIdentity(
  input: CreateDeviceIdentityInput,
): Promise<DeviceIdentity> {
  const existing = await input.store.getDeviceIdentity();
  if (existing) {
    return existing;
  }

  const created: DeviceIdentity = {
    deviceId: input.generateId ? input.generateId() : defaultGenerateId(),
    installedAt: input.now ? input.now() : new Date().toISOString(),
    platform: input.platform,
    ...(input.label ? { label: input.label } : {}),
  };
  await input.store.saveDeviceIdentity(created);
  return created;
}

export interface ClientSequenceCounter {
  next(): number;
}

/** Monotonic per-instance sequence for building idempotency keys. */
export class InMemoryClientSequenceCounter implements ClientSequenceCounter {
  private value = 0;

  next(): number {
    this.value += 1;
    return this.value;
  }
}
