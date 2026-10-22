const revisions = new Map<string, number>();
const listeners = new Set<() => void>();

export const getWorkspaceFileRevision = (tabId: string | undefined) => tabId ? revisions.get(tabId) ?? 0 : 0;
export const subscribeWorkspaceFileRevisions = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function notifyWorkspaceFileChanged(tabId: string): void {
  revisions.set(tabId, (revisions.get(tabId) ?? 0) + 1);
  if (revisions.size > 512) revisions.delete(revisions.keys().next().value!);
  for (const listener of listeners) listener();
}
