import type { CloudLibraryResource, CloudLibrarySourceProvider } from './shared-library/source-provider';

export interface CloudWorkspaceSnapshot {
  active: boolean;
  provider: CloudLibrarySourceProvider | null;
  resource: CloudLibraryResource | null;
}

export interface CloudWorkspaceAnchor {
  page?: number;
  line?: number;
  cellId?: string;
  snippet?: string;
}

export interface CloudWorkspaceOpenRequest {
  libraryId: string;
  itemId: string;
  anchor?: CloudWorkspaceAnchor;
}

export type CloudWorkspaceNavigator = (request: CloudWorkspaceOpenRequest) => Promise<boolean>;

const empty: CloudWorkspaceSnapshot = { active: false, provider: null, resource: null };
let snapshot = empty;
const listeners = new Set<() => void>();
let navigator: CloudWorkspaceNavigator | null = null;

/** The shell owns this registration; AI reads through the provider, never a
 * cloud display path via a local filesystem API. Every read still revalidates
 * permission/version at the provider boundary. */
export function getCloudWorkspaceSnapshot(): CloudWorkspaceSnapshot { return snapshot; }
export function subscribeCloudWorkspaceHost(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: CloudWorkspaceSnapshot): void {
  if (next.active === snapshot.active && next.provider === snapshot.provider && next.resource === snapshot.resource) return;
  snapshot = next;
  for (const listener of listeners) listener();
}
export function setCloudWorkspaceActive(active: boolean): void { publish({ ...snapshot, active }); }
export function setCloudWorkspaceProvider(provider: CloudLibrarySourceProvider | null): void {
  if (provider === snapshot.provider) return;
  // A replaced connection or logout cannot retain another account's source.
  publish({ ...snapshot, provider, resource: null });
}
export function setCloudWorkspaceResource(resource: CloudLibraryResource | null): void {
  publish({ ...snapshot, resource: snapshot.provider ? resource : null });
}
/** Register the mounted cloud reader's real open action. */
export function registerCloudWorkspaceNavigator(next: CloudWorkspaceNavigator | null): () => void {
  navigator = next;
  return () => { if (navigator === next) navigator = null; };
}
export async function openCloudWorkspaceResource(request: CloudWorkspaceOpenRequest): Promise<boolean> {
  const current = navigator;
  if (!current || !getCloudWorkspaceSnapshot().active) return false;
  return current(request);
}
export function resetCloudWorkspaceHost(): void { publish(empty); }
