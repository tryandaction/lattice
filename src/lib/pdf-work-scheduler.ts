export type PdfWorkPriority = "visible" | "background";

export interface PdfScheduledWork {
  promise: Promise<boolean>;
  cancel: () => void;
  setPriority: (priority: PdfWorkPriority) => void;
}

export interface PdfWorkScheduler {
  schedule: (input: {
    priority: PdfWorkPriority;
    run: () => Promise<void> | void;
  }) => PdfScheduledWork;
  getSnapshot: () => { active: number; queued: number };
}

interface PendingPdfWork {
  priority: PdfWorkPriority;
  run: () => Promise<void> | void;
  started: boolean;
  settled: boolean;
  resolve: (completed: boolean) => void;
  reject: (error: unknown) => void;
}

export function createPdfWorkScheduler(input: { maxConcurrency: number }): PdfWorkScheduler {
  const maxConcurrency = Math.max(1, Math.floor(input.maxConcurrency));
  const queue: PendingPdfWork[] = [];
  let active = 0;

  const takeNext = (): PendingPdfWork | undefined => {
    const visibleIndex = queue.findIndex((item) => item.priority === "visible");
    const index = visibleIndex >= 0 ? visibleIndex : 0;
    return queue.splice(index, 1)[0];
  };

  const drain = () => {
    while (active < maxConcurrency && queue.length > 0) {
      const item = takeNext();
      if (!item || item.settled) {
        continue;
      }

      item.started = true;
      active += 1;
      void Promise.resolve()
        .then(item.run)
        .then(() => {
          item.settled = true;
          item.resolve(true);
        }, (error: unknown) => {
          item.settled = true;
          item.reject(error);
        })
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  };

  return {
    schedule: ({ priority, run }) => {
      let item!: PendingPdfWork;
      const promise = new Promise<boolean>((resolve, reject) => {
        item = {
          priority,
          run,
          started: false,
          settled: false,
          resolve,
          reject,
        };
      });
      queue.push(item);
      drain();

      return {
        promise,
        setPriority: (nextPriority) => { item.priority = nextPriority; },
        cancel: () => {
          if (item.started || item.settled) {
            return;
          }
          item.settled = true;
          const index = queue.indexOf(item);
          if (index >= 0) {
            queue.splice(index, 1);
          }
          item.resolve(false);
        },
      };
    },
    getSnapshot: () => ({ active, queued: queue.length }),
  };
}
