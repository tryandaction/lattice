interface TauriCoreApi {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
}

interface TauriGlobalApi {
  core: TauriCoreApi;
}

interface Window {
  __TAURI__?: TauriGlobalApi;
}
