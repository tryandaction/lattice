import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};

vi.mock("@/lib/storage-adapter", () => ({
  getStorageAdapter: () => storage,
}));

import { createScheduledTaskStore } from "../scheduled-task-store";

describe("scheduled task store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.get.mockResolvedValue(null);
    storage.set.mockResolvedValue(undefined);
  });

  it("hydrates versioned tasks and ignores corrupt snapshots", async () => {
    storage.get.mockResolvedValue({
      version: 1,
      tasks: [{ id: "saved-task", title: "Saved", schedule: { kind: "once", runAt: 10 }, status: "paused", maxRetries: 0, retryCount: 0, createdAt: 1, updatedAt: 1 }],
      runs: [{ id: "saved-task-run-1", taskId: "saved-task", status: "succeeded", startedAt: 2, finishedAt: 3, attempt: 1 }],
    });
    const store = createScheduledTaskStore({ executor: async () => undefined, now: () => 100 });
    await store.hydrate();
    expect(store.get("saved-task")?.status).toBe("paused");
    expect(store.getRuns("saved-task")).toHaveLength(1);

    storage.get.mockResolvedValue({ version: 999, tasks: "broken" });
    const recovered = createScheduledTaskStore({ executor: async () => undefined, now: () => 100 });
    await recovered.hydrate();
    expect(recovered.list()).toEqual([]);
  });

  it("does not duplicate tasks or run history when hydrated more than once", async () => {
    storage.get.mockResolvedValue({
      version: 1,
      tasks: [{ id: "saved-task", title: "Saved", prompt: "Read notes", schedule: { kind: "once", runAt: 10 }, status: "paused", maxRetries: 0, retryCount: 0, createdAt: 1, updatedAt: 1 }],
      runs: [{ id: "saved-task-run-1", taskId: "saved-task", status: "succeeded", startedAt: 2, finishedAt: 3, attempt: 1 }],
    });
    const store = createScheduledTaskStore({ executor: async () => undefined, now: () => 100 });
    await store.hydrate();
    await store.hydrate();
    expect(store.list()).toHaveLength(1);
    expect(store.getRuns("saved-task")).toHaveLength(1);
  });

  it("persists transitions and records failed run history", async () => {
    const executor = vi.fn().mockRejectedValue(new Error("network disabled"));
    const store = createScheduledTaskStore({ executor, now: () => 100 });
    const task = store.create({ title: "Sync", prompt: "Sync the evidence index", schedule: { kind: "interval", everyMs: 1000 }, maxRetries: 1 });
    await expect(store.runNow(task.id)).rejects.toThrow("network disabled");
    expect(store.get(task.id)?.status).toBe("failed");
    expect(store.get(task.id)?.prompt).toBe("Sync the evidence index");
    expect(store.getRuns(task.id)[0]).toMatchObject({ status: "failed", error: "network disabled" });
    store.pause(task.id);
    store.resume(task.id);
    expect(storage.set).toHaveBeenCalledWith("lattice-scheduled-tasks-v1", expect.objectContaining({ version: 1 }));
  });
});
