import { describe, expect, it, vi } from "vitest";
import { createCoalescedAsyncRunner, TimeoutError, withTimeout } from "@/lib/async-task-guard";

describe("async-task-guard", () => {
  it("withTimeout resolves successful operations before the deadline", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 100, "quick task")).resolves.toBe("ok");
  });

  it("withTimeout rejects slow operations with TimeoutError", async () => {
    await expect(withTimeout(new Promise(() => {}), 10, "slow task")).rejects.toBeInstanceOf(TimeoutError);
  });

  it("coalesces bursts so only the latest pending task reruns after the current one", async () => {
    const calls: string[] = [];
    let resolveCurrentGate!: () => void;
    const currentGate = new Promise<void>((resolve) => {
      resolveCurrentGate = () => resolve();
    });

    const runner = createCoalescedAsyncRunner<string>(async (arg) => {
      calls.push(arg);
      if (arg === "first") {
        await currentGate;
      }
    });

    const first = runner.request("first");
    const second = runner.request("second");
    const third = runner.request("third");

    expect(calls).toEqual(["first"]);
    resolveCurrentGate();

    await Promise.all([first, second, third]);
    expect(calls).toEqual(["first", "third"]);
  });

  it("dispose prevents queued work from running", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const runner = createCoalescedAsyncRunner<string>(async (arg) => {
      calls.push(arg);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const pending = runner.request("first");
    runner.request("second");
    runner.dispose();
    await vi.advanceTimersByTimeAsync(60);
    await pending;

    expect(calls).toEqual(["first"]);
    vi.useRealTimers();
  });
});
