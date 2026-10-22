import { describe, expect, it } from "vitest";
import { createPdfWorkScheduler } from "@/lib/pdf-work-scheduler";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("pdf-work-scheduler", () => {
  it("updates queued priority without cancelling or restarting a paint", async () => {
    const scheduler = createPdfWorkScheduler({ maxConcurrency: 1 });
    const gate = createDeferred();
    const order: string[] = [];
    const active = scheduler.schedule({ priority: 'visible', run: () => gate.promise });
    const early = scheduler.schedule({ priority: 'background', run: () => { order.push('early'); } });
    const target = scheduler.schedule({ priority: 'background', run: () => { order.push('target'); } });
    target.setPriority('visible');
    active.setPriority('background');
    gate.resolve();
    await Promise.all([active.promise, target.promise, early.promise]);
    expect(order).toEqual(['target', 'early']);
  });
  it("honors the concurrency limit and starts visible work before queued background work", async () => {
    const scheduler = createPdfWorkScheduler({ maxConcurrency: 1 });
    const firstGate = createDeferred();
    const order: string[] = [];

    const first = scheduler.schedule({
      priority: "visible",
      run: async () => {
        order.push("first");
        await firstGate.promise;
      },
    });
    const background = scheduler.schedule({
      priority: "background",
      run: async () => {
        order.push("background");
      },
    });
    const nextVisible = scheduler.schedule({
      priority: "visible",
      run: async () => {
        order.push("next-visible");
      },
    });

    await flushMicrotasks();
    expect(order).toEqual(["first"]);

    firstGate.resolve();
    await Promise.all([first.promise, nextVisible.promise, background.promise]);

    expect(order).toEqual(["first", "next-visible", "background"]);
    expect(scheduler.getSnapshot()).toEqual({ active: 0, queued: 0 });
  });

  it("cancels queued work without running it", async () => {
    const scheduler = createPdfWorkScheduler({ maxConcurrency: 1 });
    const firstGate = createDeferred();
    let backgroundRan = false;
    const first = scheduler.schedule({
      priority: "visible",
      run: () => firstGate.promise,
    });
    const background = scheduler.schedule({
      priority: "background",
      run: async () => {
        backgroundRan = true;
      },
    });

    background.cancel();
    firstGate.resolve();

    expect(await background.promise).toBe(false);
    expect(await first.promise).toBe(true);
    expect(backgroundRan).toBe(false);
  });
});
