import { getStorageAdapter, isTauriHost, type StorageAdapter } from '@/lib/storage-adapter';
import type { AgentSession } from './agent-session';

export const AGENT_SESSION_STORAGE_KEY = 'lattice-agent-sessions-v1';
export const AGENT_SESSION_DATABASE = 'lattice-agent-sessions-v2';
const STORE = 'state';
const RECORD = 'sessions';

export interface AgentSessionPersistenceData {
  sessions: AgentSession[];
  activeSessionId: string | null;
}
export interface AgentSessionPersistence {
  load(): Promise<AgentSessionPersistenceData | null>;
  save(data: AgentSessionPersistenceData): Promise<void>;
}
export interface AgentSessionPersistenceOptions {
  storage?: StorageAdapter;
  indexedDB?: IDBFactory | null;
  desktop?: boolean;
  databaseName?: string;
}
function checked(value: unknown): AgentSessionPersistenceData {
  if (!value || typeof value !== 'object' || !Array.isArray((value as AgentSessionPersistenceData).sessions)
    || ((value as AgentSessionPersistenceData).activeSessionId !== undefined && (value as AgentSessionPersistenceData).activeSessionId !== null
      && typeof (value as AgentSessionPersistenceData).activeSessionId !== 'string')) {
    throw new Error('Invalid agent session storage; existing data was not replaced.');
  }
  const data = value as AgentSessionPersistenceData;
  return data.activeSessionId === undefined ? { ...data, activeSessionId: null } : data;
}

/** Large browser checkpoints use IDB; native settings and credential stores are unchanged. */
export function createAgentSessionPersistence(options: AgentSessionPersistenceOptions = {}): AgentSessionPersistence {
  const storage = options.storage ?? getStorageAdapter();
  const factory = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  const readLegacy = async () => {
    const value = await (storage.getStrict ? storage.getStrict<unknown>(AGENT_SESSION_STORAGE_KEY) : storage.get<unknown>(AGENT_SESSION_STORAGE_KEY));
    return value == null ? null : checked(value);
  };
  if (options.desktop || !factory) return {
    load: readLegacy,
    save: data => {
      // Capture before the first Promise/IPC turn; caller mutation cannot alter this write.
      const value = structuredClone(checked(data));
      return storage.setStrict ? storage.setStrict(AGENT_SESSION_STORAGE_KEY, value) : storage.set(AGENT_SESSION_STORAGE_KEY, value);
    },
  };
  const databaseName = options.databaseName ?? AGENT_SESSION_DATABASE;
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    let settled = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => {
      settled = true;
      reject(request.error ?? new Error('Agent session database could not be opened.'));
    };
    // Open requests are still pending during blocked; reading request.error then throws.
    request.onblocked = () => { settled = true; reject(new Error('Agent session database open is blocked.')); };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
  const transaction = async <T,>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let value: T;
        let failure: unknown;
        // Request success only stages a value. A transaction abort must still reject.
        tx.oncomplete = () => resolve(value);
        tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Agent session transaction failed.'));
        const fail = (error: unknown) => {
          failure = error;
          try { tx.abort(); } catch { reject(error); }
        };
        try { run(tx.objectStore(STORE), result => { value = result; }, fail); }
        catch (error) { fail(error); }
      });
    } finally { db.close(); }
  };
  const read = () => transaction<unknown>('readonly', (store, done) => {
    const request = store.get(RECORD);
    request.onsuccess = () => done(request.result);
  });
  return {
    async load() {
      const current = await read();
      if (current !== undefined) return checked(current);
      const legacy = await readLegacy();
      if (legacy === null) return null;
      const captured = structuredClone(legacy);
      // A concurrent new save wins over migration; check and put share one transaction.
      const migrated = await transaction<unknown>('readwrite', (store, done, fail) => {
        const request = store.get(RECORD);
        request.onsuccess = () => {
          try {
            if (request.result !== undefined) done(request.result);
            else { store.put(captured, RECORD); done(captured); }
          } catch (error) { fail(error); }
        };
      });
      // Preserve legacy as a recovery copy. Any IDB record, including empty, is authoritative.
      return checked(migrated);
    },
    save(data) {
      const captured = structuredClone(checked(data));
      return transaction<void>('readwrite', store => { store.put(captured, RECORD); });
    },
  };
}

let cached: { storage: StorageAdapter; factory: IDBFactory | null; desktop: boolean; persistence: AgentSessionPersistence } | undefined;
export function getAgentSessionPersistence(): AgentSessionPersistence {
  const storage = getStorageAdapter();
  const factory = typeof indexedDB === 'undefined' ? null : indexedDB;
  // Environments without IDB already use the existing adapter (including SSR/test doubles).
  const desktop = factory ? isTauriHost() : false;
  if (!cached || cached.storage !== storage || cached.factory !== factory || cached.desktop !== desktop) {
    cached = { storage, factory, desktop, persistence: createAgentSessionPersistence({ storage, indexedDB: factory, desktop }) };
  }
  return cached.persistence;
}
