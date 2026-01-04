"use client";

import { useEffect, useState } from "react";

// 检测是否在 Tauri 环境中运行
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI__" in window;
}

// Tauri 命令类型定义
declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
    };
  }
}

export interface TauriSettings {
  defaultFolder: string | null;
  lastOpenedFolder: string | null;
}

export function useTauriSettings() {
  const [settings, setSettings] = useState<TauriSettings>({
    defaultFolder: null,
    lastOpenedFolder: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载设置
  const loadSettings = async () => {
    if (!isTauri()) {
      setIsLoading(false);
      return;
    }

    try {
      const [defaultFolder, lastOpenedFolder] = await Promise.all([
        window.__TAURI__!.core.invoke<string | null>("get_default_folder"),
        window.__TAURI__!.core.invoke<string | null>("get_last_opened_folder"),
      ]);

      setSettings({
        defaultFolder: defaultFolder || null,
        lastOpenedFolder: lastOpenedFolder || null,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  };

  // 设置默认文件夹
  const setDefaultFolder = async (folder: string) => {
    if (!isTauri()) return;

    try {
      await window.__TAURI__!.core.invoke("set_default_folder", { folder });
      setSettings((prev) => ({ ...prev, defaultFolder: folder }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set default folder");
      throw err;
    }
  };

  // 清除默认文件夹
  const clearDefaultFolder = async () => {
    if (!isTauri()) return;

    try {
      await window.__TAURI__!.core.invoke("clear_default_folder");
      setSettings((prev) => ({ ...prev, defaultFolder: null }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear default folder");
      throw err;
    }
  };

  // 保存上次打开的文件夹
  const setLastOpenedFolder = async (folder: string) => {
    if (!isTauri()) return;

    try {
      await window.__TAURI__!.core.invoke("set_last_opened_folder", { folder });
      setSettings((prev) => ({ ...prev, lastOpenedFolder: folder }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save last opened folder");
      throw err;
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  return {
    settings,
    isLoading,
    error,
    isTauri: isTauri(),
    setDefaultFolder,
    clearDefaultFolder,
    setLastOpenedFolder,
    reload: loadSettings,
  };
}
