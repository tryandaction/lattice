import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryClientSequenceCounter,
  InMemoryDeviceStore,
  loadOrCreateDeviceIdentity,
} from "../device";

let sequence = 0;
function deterministicId(): string {
  sequence += 1;
  return `device-${sequence}`;
}

describe("device identity boundary", () => {
  beforeEach(() => {
    sequence = 0;
  });

  it("creates and persists a device identity on first run", async () => {
    const store = new InMemoryDeviceStore();
    const identity = await loadOrCreateDeviceIdentity({
      store,
      platform: "web",
      generateId: deterministicId,
      now: () => "2026-08-20T00:00:00.000Z",
    });
    expect(identity.deviceId).toBe("device-1");
    expect(identity.platform).toBe("web");
    expect((await store.getDeviceIdentity())?.deviceId).toBe("device-1");
  });

  it("reuses an existing device identity across reloads", async () => {
    const store = new InMemoryDeviceStore();
    await store.saveDeviceIdentity({
      deviceId: "device-x",
      installedAt: "2026-08-20T00:00:00.000Z",
      platform: "desktop",
    });
    const identity = await loadOrCreateDeviceIdentity({
      store,
      platform: "desktop",
      generateId: deterministicId,
    });
    expect(identity.deviceId).toBe("device-x");
  });

  it("generates a new identity only when none exists", async () => {
    const store = new InMemoryDeviceStore();
    await loadOrCreateDeviceIdentity({ store, platform: "web", generateId: deterministicId });
    await loadOrCreateDeviceIdentity({ store, platform: "web", generateId: deterministicId });
    expect((await store.getDeviceIdentity())?.deviceId).toBe("device-1");
  });

  it("keeps the client sequence monotonic", () => {
    const counter = new InMemoryClientSequenceCounter();
    expect(counter.next()).toBe(1);
    expect(counter.next()).toBe(2);
    expect(counter.next()).toBe(3);
  });
});
