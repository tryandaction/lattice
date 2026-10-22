/** Web exits cannot await an IPC/Promise queue. Desktop durability is handled by
 * strict checkpoints and an awaited flush in the native close handler. */
export function writeWebSessionCheckpoint(key: string, value: unknown): boolean {
  if (typeof window === 'undefined' || '__TAURI_INTERNALS__' in window || '__TAURI__' in window
    || /tauri/i.test(navigator.userAgent) || location.protocol === 'tauri:') return false;
  window.localStorage.setItem(key, JSON.stringify(value));
  return true;
}

export function installChatSessionCheckpointListeners(
  flush: () => Promise<void>,
  writeSync: () => void,
  onError: (error: unknown) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const checkpoint = () => {
    try { writeSync(); } catch (error) { onError(error); }
    void flush().catch(onError);
  };
  const onVisibility = () => { if (document.visibilityState === 'hidden') checkpoint(); };
  window.addEventListener('pagehide', checkpoint);
  window.addEventListener('beforeunload', checkpoint);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('pagehide', checkpoint);
    window.removeEventListener('beforeunload', checkpoint);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
