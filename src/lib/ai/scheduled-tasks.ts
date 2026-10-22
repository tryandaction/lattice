export type ScheduledTaskSchedule =
  | { kind: "once"; runAt: number }
  | { kind: "interval"; everyMs: number };

export type ScheduledTaskStatus = "active" | "paused" | "running" | "failed" | "completed" | "deleted";

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  schedule: ScheduledTaskSchedule;
  status: ScheduledTaskStatus;
  maxRetries: number;
  retryCount: number;
  nextRunAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  status: "running" | "succeeded" | "failed";
  startedAt: number;
  finishedAt?: number;
  attempt: number;
  error?: string;
  resultSummary?: string;
}

export interface ScheduledTaskExecutor {
  (task: ScheduledTask, signal: AbortSignal): Promise<{ summary?: string } | void>;
}

interface ScheduledTaskStoreOptions {
  executor: ScheduledTaskExecutor;
  now?: () => number;
}

export interface ScheduledTaskStore {
  create(input: { id?: string; title: string; prompt?: string; schedule: ScheduledTaskSchedule; maxRetries?: number }): ScheduledTask;
  get(id: string): ScheduledTask | null;
  list(): ScheduledTask[];
  getRuns(taskId: string): ScheduledTaskRun[];
  pause(id: string): void;
  resume(id: string): void;
  remove(id: string): void;
  runNow(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  runDue(at?: number): Promise<void>;
  start(intervalMs?: number): void;
  stop(): void;
  exportSnapshot(): { tasks: ScheduledTask[]; runs: ScheduledTaskRun[] };
  restoreSnapshot(snapshot: unknown): void;
}

function nextRunAt(schedule: ScheduledTaskSchedule, now: number): number | undefined {
  return schedule.kind === "once" ? schedule.runAt : now + schedule.everyMs;
}

export function createScheduledTaskStore(options: ScheduledTaskStoreOptions): ScheduledTaskStore {
  const tasks = new Map<string, ScheduledTask>();
  const runs = new Map<string, ScheduledTaskRun[]>();
  let sequence = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const now = options.now ?? (() => Date.now());

  const getTask = (id: string): ScheduledTask => {
    const task = tasks.get(id);
    if (!task || task.status === "deleted") throw new Error("scheduled task not found");
    return task;
  };

  const store: ScheduledTaskStore = {
    create(input) {
      const timestamp = now();
      const id = input.id ?? `scheduled-task-${++sequence}`;
      const task: ScheduledTask = {
        id,
        title: input.title.trim() || "Scheduled task",
        prompt: input.prompt?.trim() || "",
        schedule: input.schedule,
        status: "active",
        maxRetries: Math.max(0, Math.floor(input.maxRetries ?? 0)),
        retryCount: 0,
        nextRunAt: input.schedule.kind === "once" ? input.schedule.runAt : timestamp + input.schedule.everyMs,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tasks.set(id, task);
      return task;
    },
    get: (id) => tasks.get(id) ?? null,
    list: () => [...tasks.values()].filter((task) => task.status !== "deleted"),
    getRuns: (taskId) => [...(runs.get(taskId) ?? [])],
    pause(id) {
      const task = getTask(id);
      if (task.status === "running") throw new Error("cannot pause a running scheduled task");
      task.status = "paused";
      task.updatedAt = now();
    },
    resume(id) {
      const task = getTask(id);
      if (task.status !== "paused" && task.status !== "failed") return;
      task.status = "active";
      task.lastError = undefined;
      task.updatedAt = now();
    },
    remove(id) {
      const task = getTask(id);
      task.status = "deleted";
      task.updatedAt = now();
    },
    async runNow(id) {
      const task = getTask(id);
      if (task.status === "paused") throw new Error("scheduled task is paused");
      if (task.status === "running") throw new Error("scheduled task is already running");
      if (task.status === "completed" && task.schedule.kind === "once") throw new Error("scheduled task is completed");
      const startedAt = now();
      const run: ScheduledTaskRun = {
        id: `${task.id}-run-${(runs.get(task.id)?.length ?? 0) + 1}`,
        taskId: task.id,
        status: "running",
        startedAt,
        attempt: task.retryCount + 1,
      };
      runs.set(task.id, [...(runs.get(task.id) ?? []), run]);
      task.status = "running";
      task.updatedAt = startedAt;
      const controller = new AbortController();
      try {
        const result = await options.executor(task, controller.signal);
        run.status = "succeeded";
        run.finishedAt = now();
        run.resultSummary = result?.summary;
        task.retryCount = 0;
        task.lastError = undefined;
        task.status = task.schedule.kind === "once" ? "completed" : "active";
        task.nextRunAt = nextRunAt(task.schedule, run.finishedAt);
        task.updatedAt = run.finishedAt;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run.status = "failed";
        run.finishedAt = now();
        run.error = message;
        task.retryCount += 1;
        task.lastError = message;
        task.status = "failed";
        task.updatedAt = run.finishedAt;
        throw error;
      }
    },
    async retry(id) {
      const task = getTask(id);
      if (task.status !== "failed") return;
      if (task.retryCount > task.maxRetries) throw new Error("scheduled task retry limit reached");
      task.status = "active";
      await store.runNow(id);
    },
    async runDue(at = now()) {
      for (const task of store.list()) {
        if (task.status === "active" && task.nextRunAt !== undefined && task.nextRunAt <= at) {
          try { await store.runNow(task.id); } catch { /* failure is recorded on the task */ }
        }
      }
    },
    start(intervalMs = 1000) {
      if (timer) return;
      timer = setInterval(() => { void store.runDue(); }, Math.max(250, intervalMs));
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    exportSnapshot: () => ({
      tasks: store.list(),
      runs: [...runs.values()].flat(),
    }),
    restoreSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== "object") return;
      const candidate = snapshot as { tasks?: unknown; runs?: unknown };
      tasks.clear();
      runs.clear();
      if (Array.isArray(candidate.tasks)) {
        candidate.tasks.forEach((value) => {
          if (!value || typeof value !== "object") return;
          const task = value as ScheduledTask;
          if (typeof task.id === "string" && typeof task.title === "string" && typeof task.createdAt === "number") {
            tasks.set(task.id, { ...task });
          }
        });
      }
      if (Array.isArray(candidate.runs)) {
        candidate.runs.forEach((value) => {
          if (!value || typeof value !== "object") return;
          const run = value as ScheduledTaskRun;
          if (typeof run.taskId === "string" && typeof run.id === "string") {
            runs.set(run.taskId, [...(runs.get(run.taskId) ?? []), { ...run }]);
          }
        });
      }
    },
  };

  return store;
}
