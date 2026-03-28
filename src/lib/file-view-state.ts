import { getStorageAdapter } from "@/lib/storage-adapter";

const FILE_VIEW_STATE_STORAGE_KEY = "lattice-file-view-state";
const MAX_PERSISTED_FILE_VIEW_STATES = 400;

export interface PersistedFileViewState {
  cursorPosition?: number;
  scrollTop?: number;
  scrollLeft?: number;
  selection?: { from: number; to: number };
  viewState?: Record<string, unknown>;
  updatedAt?: number;
}

export interface MarkdownViewState {
  mode?: "live" | "source" | "reading";
  showOutline?: boolean;
  activeHeading?: number;
}

export interface CodeViewState {
  scrollTop?: number;
  scrollLeft?: number;
  cursorPosition?: number;
  selection?: { from: number; to: number };
}

export interface NotebookViewState {
  activeCellId?: string | null;
}

export interface PdfViewStateSnapshot {
  scale?: number;
  zoomMode?: "manual" | "fit-width" | "fit-page";
  showSidebar?: boolean;
  sidebarSize?: number;
  selectedAnnotationId?: string | null;
}

export interface ImageViewState {
  fitMode?: "fit" | "width" | "height" | "actual";
  manualZoom?: number;
  rotation?: number;
  panOffset?: { x: number; y: number };
}

export interface HtmlViewState {
  showSource?: boolean;
}

type PersistedFileViewStateMap = Record<string, PersistedFileViewState>;

function normalizeStorageKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  return trimmed ? trimmed : null;
}

async function readStateMap(): Promise<PersistedFileViewStateMap> {
  const storage = getStorageAdapter();
  const persisted = await storage.get<PersistedFileViewStateMap>(FILE_VIEW_STATE_STORAGE_KEY);
  return persisted && typeof persisted === "object" ? persisted : {};
}

async function writeStateMap(next: PersistedFileViewStateMap): Promise<void> {
  const storage = getStorageAdapter();
  await storage.set(FILE_VIEW_STATE_STORAGE_KEY, next);
}

function trimStateMapEntries(map: PersistedFileViewStateMap): PersistedFileViewStateMap {
  const entries = Object.entries(map);
  if (entries.length <= MAX_PERSISTED_FILE_VIEW_STATES) {
    return map;
  }

  entries.sort((left, right) => (right[1].updatedAt ?? 0) - (left[1].updatedAt ?? 0));
  return Object.fromEntries(entries.slice(0, MAX_PERSISTED_FILE_VIEW_STATES));
}

export function buildPersistedFileViewStateKey(input: {
  kind: string;
  workspaceRootPath?: string | null;
  filePath?: string | null;
  fallbackName?: string | null;
}): string | null {
  const target = normalizeStorageKey(input.filePath) ?? normalizeStorageKey(input.fallbackName);
  if (!target) {
    return null;
  }

  const root = normalizeStorageKey(input.workspaceRootPath) ?? "__workspace__";
  return `${input.kind}:${root}:${target}`;
}

export async function loadPersistedFileViewState(
  storageKey: string | null | undefined,
): Promise<PersistedFileViewState | null> {
  const normalizedKey = normalizeStorageKey(storageKey);
  if (!normalizedKey) {
    return null;
  }

  const map = await readStateMap();
  return map[normalizedKey] ?? null;
}

export async function savePersistedFileViewState(
  storageKey: string | null | undefined,
  state: PersistedFileViewState | null | undefined,
): Promise<void> {
  const normalizedKey = normalizeStorageKey(storageKey);
  if (!normalizedKey || !state) {
    return;
  }

  const map = await readStateMap();
  const next = trimStateMapEntries({
    ...map,
    [normalizedKey]: {
      ...state,
      updatedAt: Date.now(),
    },
  });
  await writeStateMap(next);
}

export async function deletePersistedFileViewState(
  storageKey: string | null | undefined,
): Promise<void> {
  const normalizedKey = normalizeStorageKey(storageKey);
  if (!normalizedKey) {
    return;
  }

  const map = await readStateMap();
  if (!(normalizedKey in map)) {
    return;
  }

  delete map[normalizedKey];
  await writeStateMap(map);
}
