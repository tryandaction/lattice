import { describe, expect, it, vi } from 'vitest';
import { createAgentSession } from '../agent-session';
import type { StorageAdapter } from '@/lib/storage-adapter';

type Data = { sessions: ReturnType<typeof createAgentSession>[]; activeSessionId: string | null };
const legacyKey = 'lattice-agent-sessions-v1';
const data = (id: string): Data => ({ sessions: [createAgentSession({ id, profile: 'research', task: 'Synthetic durable task' })], activeSessionId: id });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

/** Only the request/transaction event ordering used by this module, not an IDB implementation. */
function database(initial?: Data) {
  let value = initial;
  let created = false;
  let reads = 0;
  const ready: Array<() => void> = [];
  const state = { autoCommit: true, abortNext: false, blocked: false, readError: false, putError: false, closes: 0,
    get value() { return value; }, get reads() { return reads; }, commit: () => { ready.shift()?.(); } };
  const db = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => { created = true; },
    close: () => { state.closes++; },
    transaction: () => {
      let pending: Data | undefined;
      let operationCount = 0;
      let settled = false;
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null,
        abort: () => { if (settled) return; settled = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore: () => ({
          get: () => {
            reads++; operationCount++;
            const request = { result: undefined, error: null, onsuccess: null, onerror: null } as {
              result: Data | undefined; error: DOMException | null; onsuccess: (() => void) | null; onerror: (() => void) | null;
            };
            queueMicrotask(() => {
              if (state.readError) { tx.error = new DOMException('Synthetic read error', 'UnknownError'); tx.onerror?.(); tx.abort(); return; }
              request.result = value === undefined ? undefined : structuredClone(value);
              request.onsuccess?.(); operationCount--; done();
            });
            return request;
          },
          put: (next: Data) => {
            if (state.putError) throw new DOMException('Synthetic put quota', 'QuotaExceededError');
            pending = structuredClone(next); operationCount++;
            const request = { onsuccess: null } as { onsuccess: (() => void) | null };
            queueMicrotask(() => { request.onsuccess?.(); operationCount--; done(); });
            return request;
          },
        }),
      } as unknown as {
        oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; error: DOMException | null;
        abort: () => void; objectStore: () => { get: () => { result: Data | undefined; onsuccess: (() => void) | null }; put: (value: Data) => unknown };
      };
      const done = () => {
        if (operationCount || settled) return;
        const complete = () => {
          if (settled) return;
          if (state.abortNext) { state.abortNext = false; tx.error = new DOMException('Synthetic quota', 'QuotaExceededError'); tx.abort(); return; }
          settled = true; if (pending !== undefined) value = pending; tx.oncomplete?.();
        };
        ready.push(complete);
        if (state.autoCommit) queueMicrotask(() => state.commit());
      };
      return tx;
    },
  };
  const factory = { open: () => {
    const request = { result: db, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null } as unknown as {
      result: typeof db; error: DOMException | null; onupgradeneeded: (() => void) | null; onsuccess: (() => void) | null;
      onerror: (() => void) | null; onblocked: (() => void) | null;
    };
    queueMicrotask(() => { if (state.blocked) request.onblocked?.(); else { if (!created) request.onupgradeneeded?.(); request.onsuccess?.(); } });
    return request;
  } } as unknown as IDBFactory;
  return { factory, state };
}
function legacy(initial: Data | null = null) {
  return { get: vi.fn().mockResolvedValue(initial), getStrict: vi.fn().mockResolvedValue(initial),
    set: vi.fn().mockResolvedValue(undefined), setStrict: vi.fn().mockResolvedValue(undefined), remove: vi.fn(), clear: vi.fn() } satisfies StorageAdapter;
}
async function factory() {
  const implementation = await import('../agent-session-persistence').catch(() => null);
  expect(implementation?.createAgentSessionPersistence).toBeTypeOf('function');
  if (!implementation) throw new Error('Agent session persistence is not implemented');
  return implementation.createAgentSessionPersistence;
}

describe('large agent session persistence', () => {
  it('commits a six MiB browser record through IDB without writing localStorage', async () => {
    const create = await factory(); const idb = database(); const storage = legacy();
    const persistence = create({ indexedDB: idb.factory, storage, desktop: false });
    const large = data('six-mib'); large.sessions[0].result = 'x'.repeat(6 * 1024 * 1024);
    await persistence.save(large);
    expect((await persistence.load())?.sessions[0].result).toHaveLength(6 * 1024 * 1024);
    expect(storage.setStrict).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled();
  });

  it('clones input synchronously and does not acknowledge a request until transaction complete', async () => {
    const create = await factory(); const idb = database(data('old')); const storage = legacy();
    const persistence = create({ indexedDB: idb.factory, storage, desktop: false });
    idb.state.autoCommit = false;
    const next = data('captured'); let committed = false;
    const save = persistence.save(next).then(() => { committed = true; });
    next.sessions[0].task = 'MUTATED AFTER SAVE';
    await tick();
    expect(committed).toBe(false); expect(idb.state.value?.activeSessionId).toBe('old');
    idb.state.commit(); await save;
    expect(idb.state.value?.sessions[0].task).toBe('Synthetic durable task');
  });

  it('rejects quota/abort without overwriting the last committed record or falling back to legacy', async () => {
    const create = await factory(); const idb = database(data('old')); const storage = legacy(data('legacy'));
    const persistence = create({ indexedDB: idb.factory, storage, desktop: false });
    idb.state.abortNext = true;
    await expect(persistence.save(data('new'))).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect((await persistence.load())?.activeSessionId).toBe('old');
    expect(storage.setStrict).not.toHaveBeenCalled(); expect(storage.getStrict).not.toHaveBeenCalled();
  });

  it('migrates an old record only after a committed transaction and retains the legacy copy', async () => {
    const create = await factory(); const idb = database(); const old = data('legacy'); const storage = legacy(old);
    const persistence = create({ indexedDB: idb.factory, storage, desktop: false });
    expect(await persistence.load()).toEqual(old);
    expect(idb.state.value).toEqual(old);
    expect(storage.getStrict).toHaveBeenCalledWith(legacyKey); expect(storage.remove).not.toHaveBeenCalled();
    idb.state.value!.sessions = []; idb.state.value!.activeSessionId = null;
    expect(await persistence.load()).toEqual({ sessions: [], activeSessionId: null });
    expect(storage.getStrict).toHaveBeenCalledTimes(1);
  });

  it('does not treat a blocked or failed read as an empty database', async () => {
    const create = await factory(); const idb = database(data('old')); const storage = legacy();
    const persistence = create({ indexedDB: idb.factory, storage, desktop: false });
    idb.state.readError = true;
    await expect(persistence.load()).rejects.toThrow('Synthetic read error');
    expect(storage.getStrict).not.toHaveBeenCalled();
    idb.state.readError = false; idb.state.blocked = true;
    await expect(persistence.load()).rejects.toThrow(/blocked|阻塞|打开/);
    expect(idb.state.value?.activeSessionId).toBe('old');
  });

  it('keeps the old localStorage record after a failed migration', async () => {
    const create = await factory(); const idb = database(); const storage = legacy(data('legacy'));
    const persistence = create({ indexedDB: idb.factory, storage, desktop: false });
    // First transaction is a readonly miss, second migration transaction aborts.
    const get = storage.getStrict.mockImplementation(async () => { idb.state.abortNext = true; return data('legacy'); });
    await expect(persistence.load()).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(idb.state.value).toBeUndefined(); expect(storage.remove).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a newer save when legacy migration completes late', async () => {
    const create = await factory(); const idb = database(); const storage = legacy();
    let release!: (value: Data) => void;
    storage.getStrict.mockImplementationOnce(() => new Promise<Data>(resolve => { release = resolve; }));
    const persistence = create({ indexedDB: idb.factory, storage, desktop: false });
    const load = persistence.load(); await tick();
    await persistence.save(data('newer'));
    release(data('legacy'));
    expect((await load)?.activeSessionId).toBe('newer');
    expect((await persistence.load())?.activeSessionId).toBe('newer');
  });

  it('retains native strict storage on desktop even when IndexedDB exists', async () => {
    const create = await factory(); const idb = database(); const storage = legacy(data('native'));
    const persistence = create({ indexedDB: idb.factory, storage, desktop: true });
    expect((await persistence.load())?.activeSessionId).toBe('native');
    const next = data('native-new'); await persistence.save(next);
    expect(storage.setStrict).toHaveBeenCalledWith(legacyKey, next);
    expect(idb.state.reads).toBe(0);
  });

  it('rejects an invalid stored record without consulting or replacing legacy data', async () => {
    const create = await factory();
    const idb = database({ sessions: [], activeSessionId: 42 } as unknown as Data);
    const storage = legacy(data('legacy'));
    const persistence = create({ indexedDB: idb.factory, storage, desktop: false });
    await expect(persistence.load()).rejects.toThrow('Invalid agent session storage');
    expect(storage.getStrict).not.toHaveBeenCalled(); expect(storage.setStrict).not.toHaveBeenCalled();
    expect(idb.state.value?.activeSessionId).toBe(42);
  });

  it('rejects a non-cloneable snapshot before starting a write or modifying the old value', async () => {
    const create = await factory(); const idb = database(data('old'));
    const persistence = create({ indexedDB: idb.factory, storage: legacy(), desktop: false });
    const invalid = Object.assign(data('new'), { notPersistable: () => {} });
    expect(() => persistence.save(invalid)).toThrow();
    expect(idb.state.value?.activeSessionId).toBe('old'); expect(idb.state.closes).toBe(0);
  });

  it('normalizes a missing legacy active id without losing valid historical sessions', async () => {
    const create = await factory(); const idb = database();
    const saved = data('legacy-no-active');
    const storage = legacy({ sessions: saved.sessions } as unknown as Data);
    const persistence = create({ indexedDB: idb.factory, storage, desktop: false });
    expect(await persistence.load()).toEqual({ sessions: saved.sessions, activeSessionId: null });
    expect(idb.state.value).toEqual({ sessions: saved.sessions, activeSessionId: null });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('rejects a synchronous migration put error without losing its legacy recovery copy', async () => {
    const create = await factory(); const idb = database(); const storage = legacy(data('legacy'));
    idb.state.putError = true;
    const persistence = create({ indexedDB: idb.factory, storage, desktop: false });
    await expect(persistence.load()).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(storage.remove).not.toHaveBeenCalled(); expect(idb.state.value).toBeUndefined();
  }, 1500);
});
