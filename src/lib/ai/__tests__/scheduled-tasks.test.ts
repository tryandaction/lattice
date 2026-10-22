import { describe, expect, it, vi } from "vitest";
import { createScheduledTaskStore, type ScheduledTaskExecutor } from "../scheduled-tasks";

describe("local scheduled task state machine", () => {
  it("supports create, pause, resume, run now, retry and run history", async () => {
    const executions: string[] = [];
    let attempts = 0;
    const executor: ScheduledTaskExecutor = async (task) => {
      attempts += 1;
      executions.push(task.id);
      if (attempts === 1) throw new Error("temporary failure");
      return { summary: "ok" };
    };
    const store = createScheduledTaskStore({ executor, now: () => 1000 });
    const task = store.create({ title: "Daily digest", prompt: "Summarize today's evidence", schedule: { kind: "interval", everyMs: 60_000 }, maxRetries: 1 });

    expect(store.get(task.id)?.status).toBe("active");
    expect(store.get(task.id)?.prompt).toBe("Summarize today's evidence");
    await expect(store.runNow(task.id)).rejects.toThrow("temporary failure");
    expect(store.get(task.id)?.status).toBe("failed");
    expect(store.getRuns(task.id)).toHaveLength(1);
    await store.retry(task.id);
    expect(store.get(task.id)?.status).toBe("active");
    expect(store.getRuns(task.id)).toHaveLength(2);
    expect(executions).toEqual([task.id, task.id]);

    store.pause(task.id);
    await expect(store.runNow(task.id)).rejects.toThrow("paused");
    store.resume(task.id);
    expect(store.get(task.id)?.status).toBe("active");
  });

  it("runs due interval tasks while started and stops after shutdown", async () => {
    vi.useFakeTimers();
    try {
      let executions = 0;
      const store = createScheduledTaskStore({
        executor: async () => { executions += 1; },
        now: () => Date.now(),
      });
      const task = store.create({ title: "Periodic", schedule: { kind: "interval", everyMs: 1000 } });
      store.start(100);
      await vi.advanceTimersByTimeAsync(1100);
      expect(executions).toBe(1);
      store.stop();
      await vi.advanceTimersByTimeAsync(2000);
      expect(executions).toBe(1);
      expect(store.get(task.id)?.status).toBe("active");
    } finally {
      vi.useRealTimers();
    }
  });
});
