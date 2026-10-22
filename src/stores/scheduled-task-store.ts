import {
  createScheduledTaskStore as createCoreScheduledTaskStore,
  type ScheduledTask,
  type ScheduledTaskExecutor,
  type ScheduledTaskRun,
  type ScheduledTaskSchedule,
  type ScheduledTaskStore,
} from "@/lib/ai/scheduled-tasks";
import { getStorageAdapter, type StorageAdapter } from "@/lib/storage-adapter";
import { create } from "zustand";

const SCHEDULED_TASKS_STORAGE_KEY = "lattice-scheduled-tasks-v1";
const SCHEDULED_TASKS_SCHEMA_VERSION = 1;

export interface PersistentScheduledTaskStore extends ScheduledTaskStore {
  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
}

export interface PersistentScheduledTaskStoreOptions {
  executor: ScheduledTaskExecutor;
  now?: () => number;
  storage?: StorageAdapter;
  key?: string;
}

export interface ScheduledTaskStoreState {
  tasks: ScheduledTask[];
  runs: ScheduledTaskRun[];
  hydrated: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  createTask: (input: { title: string; prompt?: string; schedule: ScheduledTaskSchedule; maxRetries?: number }) => ScheduledTask;
  pauseTask: (id: string) => void;
  resumeTask: (id: string) => void;
  removeTask: (id: string) => void;
  runTaskNow: (id: string) => Promise<void>;
  retryTask: (id: string) => Promise<void>;
  startScheduler: () => void;
  stopScheduler: () => void;
  resetForTests: () => void;
  executorAvailable: boolean;
}

let defaultRuntime: PersistentScheduledTaskStore | null = null;
const defaultExecutorAvailable = false;
function getDefaultRuntime(): PersistentScheduledTaskStore {
  if (!defaultRuntime) {
    defaultRuntime = createScheduledTaskStore({
      executor: async () => {
        throw new Error("No approved executor is configured for this scheduled task");
      },
    });
  }
  return defaultRuntime;
}

function snapshotState(runtime: PersistentScheduledTaskStore) {
  return {
    tasks: runtime.list(),
    runs: runtime.list().flatMap((task) => runtime.getRuns(task.id)),
  };
}

export const useScheduledTaskStore = create<ScheduledTaskStoreState>((set) => ({
  tasks: [],
  runs: [],
  hydrated: false,
  error: null,
  executorAvailable: false,
  hydrate: async () => {
    try {
      const runtime = getDefaultRuntime();
      await runtime.hydrate();
      const snapshot = snapshotState(runtime);
      set({ ...snapshot, hydrated: true, error: null });
    } catch (error) {
      set({ hydrated: true, error: error instanceof Error ? error.message : String(error) });
    }
  },
  createTask: (input) => {
    if (!defaultExecutorAvailable) throw new Error("No approved executor is configured for scheduled tasks");
    const runtime = getDefaultRuntime();
    const task = runtime.create(input);
    set({ ...snapshotState(runtime) });
    return task;
  },
  pauseTask: (id) => {
    const runtime = getDefaultRuntime();
    runtime.pause(id);
    set({ ...snapshotState(runtime) });
  },
  resumeTask: (id) => {
    if (!defaultExecutorAvailable) return;
    const runtime = getDefaultRuntime();
    runtime.resume(id);
    set({ ...snapshotState(runtime) });
  },
  removeTask: (id) => {
    const runtime = getDefaultRuntime();
    runtime.remove(id);
    set({ ...snapshotState(runtime) });
  },
  runTaskNow: async (id) => {
    if (!defaultExecutorAvailable) throw new Error("No approved executor is configured for scheduled tasks");
    const runtime = getDefaultRuntime();
    try {
      await runtime.runNow(id);
      set({ ...snapshotState(runtime), error: null });
    } catch (error) {
      set({ ...snapshotState(runtime), error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },
  retryTask: async (id) => {
    if (!defaultExecutorAvailable) throw new Error("No approved executor is configured for scheduled tasks");
    const runtime = getDefaultRuntime();
    try {
      await runtime.retry(id);
      set({ ...snapshotState(runtime), error: null });
    } catch (error) {
      set({ ...snapshotState(runtime), error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },
  startScheduler: () => { if (defaultExecutorAvailable) getDefaultRuntime().start(1000); },
  stopScheduler: () => getDefaultRuntime().stop(),
  resetForTests: () => {
    defaultRuntime = null;
    set({ tasks: [], runs: [], hydrated: false, error: null });
  },
}));

export function createScheduledTaskStore(options: PersistentScheduledTaskStoreOptions): PersistentScheduledTaskStore {
  const core = createCoreScheduledTaskStore({ executor: options.executor, now: options.now });
  const storage = options.storage ?? getStorageAdapter();
  const key = options.key ?? SCHEDULED_TASKS_STORAGE_KEY;
  let persistTail: Promise<void> = Promise.resolve();

  const persist = async () => {
    persistTail = persistTail.then(() => storage.set(key, {
      version: SCHEDULED_TASKS_SCHEMA_VERSION,
      ...core.exportSnapshot(),
    }));
    await persistTail;
  };

  return {
    ...core,
    create(input) {
      const task = core.create(input);
      void persist();
      return task;
    },
    pause(id) {
      core.pause(id);
      void persist();
    },
    resume(id) {
      core.resume(id);
      void persist();
    },
    remove(id) {
      core.remove(id);
      void persist();
    },
    async runNow(id) {
      try {
        await core.runNow(id);
      } finally {
        await persist();
      }
    },
    async retry(id) {
      try {
        await core.retry(id);
      } finally {
        await persist();
      }
    },
    async runDue(at) {
      await core.runDue(at);
      await persist();
    },
    hydrate: async () => {
      const snapshot = await storage.get<unknown>(key);
      if (!snapshot || typeof snapshot !== "object") return;
      const version = (snapshot as { version?: unknown }).version;
      if (version !== SCHEDULED_TASKS_SCHEMA_VERSION) return;
      core.restoreSnapshot(snapshot);
    },
    persist,
  };
}

export type { ScheduledTask, ScheduledTaskRun, ScheduledTaskSchedule };
