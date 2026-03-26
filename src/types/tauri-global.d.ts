interface TauriCoreApi {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
}

interface TauriGlobalApi {
  core: TauriCoreApi;
}

interface TauriInternalsApi {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>, options?: unknown): Promise<T>;
}

interface Window {
  __TAURI__?: TauriGlobalApi;
  __TAURI_INTERNALS__?: Partial<TauriInternalsApi> & Record<string, unknown>;
}
