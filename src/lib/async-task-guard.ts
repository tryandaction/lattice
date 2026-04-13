"use client";

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function createLatestRunGuard() {
  let currentRunId = 0;

  return {
    begin() {
      currentRunId += 1;
      return currentRunId;
    },
    invalidate() {
      currentRunId += 1;
      return currentRunId;
    },
    isCurrent(runId: number) {
      return runId === currentRunId;
    },
  };
}

export function createCoalescedAsyncRunner<TArg>(
  task: (arg: TArg) => Promise<void>,
): {
  request: (arg: TArg) => Promise<void>;
  dispose: () => void;
} {
  let disposed = false;
  let running = false;
  let pending = false;
  let latestArg: TArg | null = null;
  let waiter: Promise<void> | null = null;

  const pump = async () => {
    if (running || disposed) {
      return;
    }

    running = true;
    try {
      while (!disposed && pending && latestArg !== null) {
        const arg = latestArg;
        pending = false;
        await task(arg);
      }
    } finally {
      running = false;
      waiter = null;
    }
  };

  return {
    async request(arg: TArg) {
      if (disposed) {
        return;
      }
      latestArg = arg;
      pending = true;
      if (!waiter) {
        waiter = pump();
      }
      await waiter;
    },
    dispose() {
      disposed = true;
      pending = false;
      latestArg = null;
    },
  };
}
