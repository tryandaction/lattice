"use client";

import { useState } from "react";
import { X, FolderOpen, Trash2, Save, AlertCircle } from "lucide-react";
import { useTauriSettings } from "@/hooks/use-tauri-settings";

interface DesktopSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DesktopSettingsDialog({
  isOpen,
  onClose,
}: DesktopSettingsDialogProps) {
  const {
    settings,
    isLoading,
    error,
    isTauri,
    setDefaultFolder,
    clearDefaultFolder,
  } = useTauriSettings();

  const [newDefaultFolder, setNewDefaultFolder] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!isOpen || !isTauri) return null;

  const handleSelectFolder = async () => {
    try {
      // 使用 Tauri 的文件对话框选择文件夹
      const selected = await window.__TAURI__!.core.invoke<string | null>(
        "plugin:dialog|open",
        {
          directory: true,
          multiple: false,
          title: "选择默认文件夹",
        }
      );

      if (selected) {
        setNewDefaultFolder(selected);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "选择文件夹失败");
    }
  };

  const handleSave = async () => {
    if (!newDefaultFolder) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      await setDefaultFolder(newDefaultFolder);
      setNewDefaultFolder("");
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsSaving(true);
    setSaveError(null);

    try {
      await clearDefaultFolder();
      setNewDefaultFolder("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "清除失败");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="关闭"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        {/* 内容 */}
        <div className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            桌面应用设置
          </h2>

          {isLoading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : (
            <div className="space-y-4">
              {/* 当前默认文件夹 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  当前默认文件夹
                </label>
                {settings.defaultFolder ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm text-gray-900 dark:text-white truncate">
                      {settings.defaultFolder}
                    </div>
                    <button
                      onClick={handleClear}
                      disabled={isSaving}
                      className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                      title="清除默认文件夹"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm text-gray-500 dark:text-gray-400">
                    未设置
                  </div>
                )}
              </div>

              {/* 上次打开的文件夹 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  上次打开的文件夹
                </label>
                <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm text-gray-900 dark:text-white truncate">
                  {settings.lastOpenedFolder || "无"}
                </div>
              </div>

              {/* 设置新的默认文件夹 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  设置新的默认文件夹
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectFolder}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <FolderOpen className="w-4 h-4" />
                    选择文件夹
                  </button>
                  {newDefaultFolder && (
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      {isSaving ? "保存中..." : "保存"}
                    </button>
                  )}
                </div>
                {newDefaultFolder && (
                  <div className="mt-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-900 dark:text-blue-300 truncate">
                    {newDefaultFolder}
                  </div>
                )}
              </div>

              {/* 错误提示 */}
              {(error || saveError) && (
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {error || saveError}
                  </p>
                </div>
              )}

              {/* 说明 */}
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="text-sm text-blue-900 dark:text-blue-300">
                  💡 设置默认文件夹后，应用启动时会自动打开该文件夹。
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
