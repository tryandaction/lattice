import { isDesktopFileHandle, readDesktopFileRevision } from './desktop-file-system';

/** Read current source metadata without materializing desktop file bytes. */
export async function readFileSourceRevision(handle: FileSystemFileHandle, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (isDesktopFileHandle(handle)) {
    const metadata = await readDesktopFileRevision(handle.fullPath);
    signal?.throwIfAborted();
    return `${metadata.size}:${metadata.modifiedMs}`;
  }
  const file = await handle.getFile();
  signal?.throwIfAborted();
  return `${file.size}:${file.lastModified}`;
}
