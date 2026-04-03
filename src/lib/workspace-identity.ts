"use client";

import type { RegisteredWorkspaceHandle, WorkspaceHostKind, WorkspaceIdentity } from "@/types/workspace-identity";
import { normalizeWorkspacePath } from "@/lib/link-router/path-utils";

const WORKSPACE_HANDLE_DB = "lattice-workspace-handles";
const WORKSPACE_HANDLE_STORE = "handles";

function normalizeDisplayPath(path: string | null | undefined, fallback: string): string {
  if (typeof path !== "string" || !path.trim()) {
    return normalizeWorkspacePath(fallback);
  }

  return normalizeWorkspacePath(path);
}

function toWorkspaceRecord(
  handle: FileSystemDirectoryHandle,
  identity: WorkspaceIdentity,
): RegisteredWorkspaceHandle {
  return {
    ...identity,
    handle,
  };
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

async function openWorkspaceHandleDb(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(WORKSPACE_HANDLE_STORE, { keyPath: "workspaceKey" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function listWorkspaceHandleRecords(): Promise<RegisteredWorkspaceHandle[]> {
  const db = await openWorkspaceHandleDb();
  if (!db) {
    return [];
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(WORKSPACE_HANDLE_STORE, "readonly");
    const request = tx.objectStore(WORKSPACE_HANDLE_STORE).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as RegisteredWorkspaceHandle[]);
    request.onerror = () => reject(request.error);
  });
}

async function saveWorkspaceHandleRecord(record: RegisteredWorkspaceHandle): Promise<void> {
  const db = await openWorkspaceHandleDb();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WORKSPACE_HANDLE_STORE, "readwrite");
    tx.objectStore(WORKSPACE_HANDLE_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadWorkspaceHandleRegistration(
  workspaceKey: string | null | undefined,
): Promise<RegisteredWorkspaceHandle | null> {
  if (!workspaceKey?.trim()) {
    return null;
  }

  const records = await listWorkspaceHandleRecords();
  return records.find((record) => record.workspaceKey === workspaceKey) ?? null;
}

export async function resolveWorkspaceIdentity(
  handle: FileSystemDirectoryHandle,
  options: {
    hostKind: WorkspaceHostKind;
    displayPath?: string | null;
    workspaceKey?: string | null;
  },
): Promise<WorkspaceIdentity> {
  const displayPath = normalizeDisplayPath(options.displayPath, handle.name);
  const baseIdentity = {
    displayPath,
    rootName: handle.name,
    hostKind: options.hostKind,
    handleFingerprint: null,
    lastUsedAt: Date.now(),
  } satisfies Omit<WorkspaceIdentity, "workspaceKey">;

  if (options.hostKind === "desktop") {
    return {
      workspaceKey: options.workspaceKey?.trim() || `desktop:${displayPath}`,
      ...baseIdentity,
    };
  }

  const existingRecords = await listWorkspaceHandleRecords();
  const directRecord = options.workspaceKey
    ? existingRecords.find((record) => record.workspaceKey === options.workspaceKey)
    : null;

  if (directRecord && await handle.isSameEntry(directRecord.handle)) {
    const nextRecord = toWorkspaceRecord(handle, {
      ...baseIdentity,
      workspaceKey: directRecord.workspaceKey,
    });
    await saveWorkspaceHandleRecord(nextRecord);
    return nextRecord;
  }

  for (const record of existingRecords) {
    try {
      if (await handle.isSameEntry(record.handle)) {
        const nextRecord = toWorkspaceRecord(handle, {
          ...baseIdentity,
          workspaceKey: record.workspaceKey,
        });
        await saveWorkspaceHandleRecord(nextRecord);
        return nextRecord;
      }
    } catch {
      // Ignore stale registrations and continue.
    }
  }

  const workspaceKey = options.workspaceKey?.trim() || `web:${crypto.randomUUID()}`;
  const nextRecord = toWorkspaceRecord(handle, {
    workspaceKey,
    ...baseIdentity,
  });
  await saveWorkspaceHandleRecord(nextRecord);
  return nextRecord;
}
