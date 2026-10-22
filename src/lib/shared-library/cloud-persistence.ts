import type { SharedLibraryItemContent } from "./content-store";

export interface CloudPersistence<T> {
  load(): Promise<T | null>;
  content(key: string): Promise<SharedLibraryItemContent | null>;
  commit(snapshot: T, contents?: ReadonlyArray<{ key: string; content: SharedLibraryItemContent | null }>, expectedRevision?: number): Promise<void>;
}
export class CloudPersistenceConflict extends Error { constructor() { super("另一窗口已保存同账号云库状态，请合并后重试。"); } }

/** Snapshot and new bytes commit in one transaction; no memory fallback on quota/storage failures. */
export function createCloudPersistence<T>(scope: string): CloudPersistence<T> {
  let database: Promise<IDBDatabase> | undefined;
  function open() {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lattice-cloud-library-v1", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("records"); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = undefined; reject(request.error); };
    });
    return database;
  }
  const key = (name: string) => JSON.stringify([scope, name]);
  async function read<R>(name: string): Promise<R | null> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("records", "readonly");
      const request = transaction.objectStore("records").get(key(name));
      transaction.oncomplete = () => resolve(request.result ?? null);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("缓存读取事务中止。"));
    });
  }
  return {
    load: () => read<T>("snapshot"),
    content: name => read<SharedLibraryItemContent>(`content:${name}`),
    async commit(snapshot, contents = [], expectedRevision) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("records", "readwrite");
        const records = transaction.objectStore("records");
        let conflict = false;
        const current = records.get(key("snapshot"));
        current.onsuccess = () => {
          if (expectedRevision !== undefined && ((current.result as { revision?: number } | undefined)?.revision ?? 0) !== expectedRevision) { conflict = true; transaction.abort(); return; }
          records.put(snapshot, key("snapshot"));
          for (const entry of contents) {
            const name = key(`content:${entry.key}`);
            if (entry.content) records.put(entry.content, name); else records.delete(name);
          }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("存储空间不足，文件未保存。"));
        transaction.onabort = () => reject(conflict ? new CloudPersistenceConflict() : transaction.error ?? new Error("保存事务中止，未显示成功。"));
      });
    },
  };
}
