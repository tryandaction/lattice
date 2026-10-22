import type { StorageAdapter } from './storage-adapter';

const queues = new WeakMap<StorageAdapter, Map<string, Promise<unknown>>>();

/** Keep read-modify-write registry updates atomic within this application instance. */
export function withStorageMutation<T>(storage: StorageAdapter, key: string, operation: () => Promise<T>): Promise<T> {
  let byKey = queues.get(storage);
  if (!byKey) { byKey = new Map(); queues.set(storage, byKey); }
  const result = (byKey.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
  byKey.set(key, result);
  void result.finally(() => { if (byKey!.get(key) === result) byKey!.delete(key); }).catch(() => undefined);
  return result;
}
