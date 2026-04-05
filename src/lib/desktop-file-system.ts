"use client";

import { isTauri, waitForTauriInvokeReady } from "@/lib/storage-adapter";

interface DesktopDirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

interface DesktopHandleMarker {
  readonly __latticeDesktopHandle: true;
  readonly fullPath: string;
}

function normalizeDesktopPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function getPathName(path: string): string {
  const normalized = normalizeDesktopPath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function joinDesktopPath(parentPath: string, name: string): string {
  return `${normalizeDesktopPath(parentPath)}/${name}`;
}

async function invokeDesktopFs<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const invoke = await waitForTauriInvokeReady();
  if (!isTauri() || !invoke) {
    throw new Error("Desktop file system is unavailable outside Tauri.");
  }

  return invoke<T>(command, args);
}

async function readDesktopDir(path: string): Promise<DesktopDirEntry[]> {
  return invokeDesktopFs<DesktopDirEntry[]>("desktop_read_dir", { path: normalizeDesktopPath(path) });
}

async function readDesktopFileBytes(path: string): Promise<Uint8Array> {
  const bytes = await invokeDesktopFs<Uint8Array | ArrayBuffer | number[]>("desktop_read_file_bytes_raw", {
    path: normalizeDesktopPath(path),
  });
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }
  return Uint8Array.from(bytes);
}

async function writeDesktopFileBytes(path: string, bytes: Uint8Array): Promise<void> {
  await invokeDesktopFs("desktop_write_file_bytes", {
    path: normalizeDesktopPath(path),
    data: Array.from(bytes),
  });
}

async function desktopPathExists(path: string): Promise<boolean> {
  return invokeDesktopFs<boolean>("desktop_exists_path", { path: normalizeDesktopPath(path) });
}

async function createDesktopDir(path: string, recursive = false): Promise<void> {
  await invokeDesktopFs("desktop_create_dir", {
    path: normalizeDesktopPath(path),
    recursive,
  });
}

async function removeDesktopPath(path: string, recursive = false): Promise<void> {
  await invokeDesktopFs("desktop_remove_path", {
    path: normalizeDesktopPath(path),
    recursive,
  });
}

async function ensureDesktopFile(path: string): Promise<void> {
  await writeDesktopFileBytes(path, new Uint8Array());
}

async function toUint8Array(data: FileSystemWriteChunkType): Promise<Uint8Array> {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }

  if (data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }

  if (typeof data === "object" && data !== null && "type" in data) {
    const command = data as FileSystemWriteChunkType & { type?: string; data?: FileSystemWriteChunkType; size?: number };
    if (command.type === "write" && command.data !== undefined) {
      return toUint8Array(command.data);
    }
    if (command.type === "truncate" && command.size === 0) {
      return new Uint8Array();
    }
  }

  throw new Error("Unsupported desktop writable payload.");
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return merged;
}

class DesktopWritableFileStream {
  private readonly chunks: Uint8Array[] = [];

  constructor(private readonly path: string) {}

  async write(data: FileSystemWriteChunkType): Promise<void> {
    const nextChunk = await toUint8Array(data);
    if (nextChunk.byteLength === 0 && this.chunks.length === 0) {
      return;
    }
    this.chunks.push(nextChunk);
  }

  async close(): Promise<void> {
    await writeDesktopFileBytes(this.path, concatUint8Arrays(this.chunks));
  }

  async seek(_position: number): Promise<void> {
    throw new Error("Desktop writable seek is not implemented.");
  }

  async truncate(size: number): Promise<void> {
    if (size === 0) {
      this.chunks.length = 0;
      return;
    }
    throw new Error("Desktop writable truncate is only implemented for size 0.");
  }
}

export class DesktopFileHandle implements FileSystemFileHandle, DesktopHandleMarker {
  readonly kind = "file" as const;
  readonly __latticeDesktopHandle = true as const;

  constructor(
    public readonly name: string,
    public readonly fullPath: string,
  ) {}

  async getFile(): Promise<File> {
    const bytes = await readDesktopFileBytes(this.fullPath);
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new File([arrayBuffer], this.name);
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    return new DesktopWritableFileStream(this.fullPath) as unknown as FileSystemWritableFileStream;
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return isDesktopFileHandle(other) && normalizeDesktopPath(other.fullPath) === normalizeDesktopPath(this.fullPath);
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }
}

export class DesktopDirectoryHandle implements FileSystemDirectoryHandle, DesktopHandleMarker {
  readonly kind = "directory" as const;
  readonly __latticeDesktopHandle = true as const;

  constructor(
    public readonly name: string,
    public readonly fullPath: string,
  ) {}

  async *values(): AsyncGenerator<FileSystemDirectoryHandle | FileSystemFileHandle> {
    const entries = await readDesktopDir(this.fullPath);
    for (const entry of entries) {
      const entryPath = joinDesktopPath(this.fullPath, entry.name);
      if (entry.isDirectory) {
        yield new DesktopDirectoryHandle(entry.name, entryPath) as unknown as FileSystemDirectoryHandle;
        continue;
      }

      if (entry.isFile) {
        yield new DesktopFileHandle(entry.name, entryPath) as unknown as FileSystemFileHandle;
      }
    }
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
    const nextPath = joinDesktopPath(this.fullPath, name);
    const exists = await desktopPathExists(nextPath);
    if (!exists) {
      if (!options?.create) {
        throw new DOMException(`Directory not found: ${name}`, "NotFoundError");
      }
      await createDesktopDir(nextPath, false);
    }

    return new DesktopDirectoryHandle(name, nextPath) as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    const nextPath = joinDesktopPath(this.fullPath, name);
    const exists = await desktopPathExists(nextPath);
    if (!exists) {
      if (!options?.create) {
        throw new DOMException(`File not found: ${name}`, "NotFoundError");
      }
      await ensureDesktopFile(nextPath);
    }

    return new DesktopFileHandle(name, nextPath) as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
    await removeDesktopPath(joinDesktopPath(this.fullPath, name), Boolean(options?.recursive));
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return isDesktopDirectoryHandle(other) && normalizeDesktopPath(other.fullPath) === normalizeDesktopPath(this.fullPath);
  }

  async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
    const descendantPath = getDesktopHandlePath(possibleDescendant);
    if (!descendantPath) {
      return null;
    }

    const basePath = `${normalizeDesktopPath(this.fullPath)}/`;
    if (!descendantPath.startsWith(basePath)) {
      return null;
    }

    return descendantPath.slice(basePath.length).split("/").filter(Boolean);
  }

  async *keys(): AsyncIterableIterator<string> {
    for await (const [name] of this.entries()) {
      yield name;
    }
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]> {
    for await (const entry of this.values()) {
      yield [entry.name, entry];
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]> {
    return this.entries();
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }
}

export function createDesktopDirectoryHandle(path: string): FileSystemDirectoryHandle {
  const normalizedPath = normalizeDesktopPath(path);
  return new DesktopDirectoryHandle(getPathName(normalizedPath), normalizedPath) as unknown as FileSystemDirectoryHandle;
}

export function isDesktopDirectoryHandle(handle: unknown): handle is DesktopDirectoryHandle {
  return typeof handle === "object" &&
    handle !== null &&
    "__latticeDesktopHandle" in handle &&
    "kind" in handle &&
    (handle as { kind?: string }).kind === "directory";
}

export function isDesktopFileHandle(handle: unknown): handle is DesktopFileHandle {
  return typeof handle === "object" &&
    handle !== null &&
    "__latticeDesktopHandle" in handle &&
    "kind" in handle &&
    (handle as { kind?: string }).kind === "file";
}

export function getDesktopHandlePath(handle: FileSystemHandle | null | undefined): string | null {
  if (!handle || typeof handle !== "object" || !("__latticeDesktopHandle" in handle)) {
    return null;
  }

  return normalizeDesktopPath((handle as unknown as DesktopHandleMarker).fullPath);
}
