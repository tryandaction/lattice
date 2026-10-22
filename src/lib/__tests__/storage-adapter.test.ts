/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStorageAdapter, type TauriInvoke } from "../storage-adapter";

describe("storage-adapter desktop bridge readiness", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();

    const tauriWindow = window as Window & {
      __TAURI__?: { core?: { invoke?: unknown } };
      __TAURI_INTERNALS__?: { invoke?: unknown };
    };
    delete tauriWindow.__TAURI__;
    tauriWindow.__TAURI_INTERNALS__ = {};
  });

  it("waits for the Tauri invoke bridge instead of eagerly falling back to localStorage", async () => {
    vi.useFakeTimers();

    localStorage.setItem("lattice-settings", JSON.stringify({ onboardingCompleted: false }));

    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "get_setting" && args?.key === "lattice-settings") {
        return { onboardingCompleted: true };
      }
      return null;
    });

    const pending = getStorageAdapter().get("lattice-settings");

    vi.advanceTimersByTime(50);
    (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__ = {
      invoke: invoke as TauriInvoke,
    };

    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ onboardingCompleted: true });
    expect(invoke).toHaveBeenCalledWith("get_setting", { key: "lattice-settings" }, undefined);
    expect(localStorage.getItem("lattice-settings")).toContain("false");

    vi.useRealTimers();
  });

  it("rejects a critical desktop checkpoint write instead of hiding it in a stale fallback", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('disk full'));
    (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__ = { invoke: invoke as TauriInvoke };
    await expect(getStorageAdapter().setStrict!('checkpoint', { batch: 2 })).rejects.toThrow('disk full');
    expect(localStorage.getItem('checkpoint')).toBeNull();
  });

  it('does not interpret a failed desktop read as an empty configuration', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('synthetic store unavailable'));
    (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__ = { invoke: invoke as TauriInvoke };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(getStorageAdapter().get('lattice-ai-provider-profiles')).resolves.toBeNull();
    await expect(getStorageAdapter().getStrict!('lattice-ai-provider-profiles')).rejects.toThrow('synthetic store unavailable');
    expect(invoke).not.toHaveBeenCalledWith('set_setting', expect.anything(), expect.anything());
  });

  it('migrates legacy profiles only after a successful durable desktop save', async () => {
    localStorage.setItem('profiles', JSON.stringify({ profiles: [{ id: 'synthetic-profile' }] }));
    const invoke = vi.fn(async (command: string) => command === 'get_setting' ? null : undefined);
    (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__ = { invoke: invoke as TauriInvoke };
    await expect(getStorageAdapter().getStrict!('profiles')).resolves.toEqual({ profiles: [{ id: 'synthetic-profile' }] });
    expect(invoke).toHaveBeenCalledWith('set_setting', { key: 'profiles', value: { profiles: [{ id: 'synthetic-profile' }] } }, undefined);
    expect(localStorage.getItem('profiles')).toBeNull();
  });

  it('preserves legacy profiles when migration cannot save them', async () => {
    localStorage.setItem('profiles', JSON.stringify({ profiles: [{ id: 'synthetic-profile' }] }));
    const invoke = vi.fn(async (command: string) => { if (command === 'get_setting') return null; throw new Error('synthetic disk failure'); });
    (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__ = { invoke: invoke as TauriInvoke };
    await expect(getStorageAdapter().getStrict!('profiles')).rejects.toThrow('synthetic disk failure');
    expect(localStorage.getItem('profiles')).toContain('synthetic-profile');
  });

  it("propagates browser quota errors for critical writes", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.resetModules();
    const { getStorageAdapter: freshAdapter } = await import('../storage-adapter');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota full', 'QuotaExceededError'); });
    await expect(freshAdapter().setStrict!('checkpoint', { batch: 2 })).rejects.toThrow('quota full');
  });
});
