// Share concurrent reads only. Settled data belongs to the content cache, where
// dirty edits and invalidation are tracked; it must never remain hidden here.
const pendingReads = new WeakMap<FileSystemFileHandle, Map<string, Promise<unknown>>>();

export function readFileOnce<T>(
  handle: FileSystemFileHandle,
  operation: string,
  read: () => Promise<T>,
): Promise<T> {
  let operations = pendingReads.get(handle);
  if (!operations) {
    operations = new Map();
    pendingReads.set(handle, operations);
  }
  const existing = operations.get(operation);
  if (existing) return existing as Promise<T>;
  const pending = Promise.resolve().then(read).finally(() => {
    if (operations.get(operation) === pending) operations.delete(operation);
    if (operations.size === 0) pendingReads.delete(handle);
  });
  operations.set(operation, pending);
  return pending;
}
