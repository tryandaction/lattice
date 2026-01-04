"use client";

import { useEffect, useState } from "react";
import { X, Download, Check, Zap, FolderOpen, Gauge } from "lucide-react";
import { isTauri } from "@/hooks/use-tauri-settings";

export function DownloadAppDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    // 如果已经在 Tauri 环境中，不显示
    if (isTauri()) return;

    // 检查是否已经选择不再显示
    const dismissed = localStorage.getItem("lattice-download-dismissed");
    if (dismissed === "true") return;

    // 延迟 2 秒后显示，让用户先看到应用
    const timer = setTimeout(() => {
      setIsOpen(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem("lattice-download-dismissed", "true");
    }
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700">
        {/* 关闭按钮 */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="关闭"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        {/* 内容 */}
        <div className="p-6">
          {/* 标题 */}
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Download className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                下载桌面应用
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                获得更好的使用体验
              </p>
            </div>
          </div>

          {/* 优势列表 */}
          <div className="space-y-3 mb-6">
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-green-100 dark:bg-green-900/30 rounded-md mt-0.5">
                <Zap className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  启动更快，体积更小
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  仅 6MB，启动速度提升 3 倍，内存占用降低 50%
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-purple-100 dark:bg-purple-900/30 rounded-md mt-0.5">
                <FolderOpen className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  记住工作目录
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  自动记住上次打开的文件夹，设置默认工作目录
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-orange-100 dark:bg-orange-900/30 rounded-md mt-0.5">
                <Gauge className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  原生窗口体验
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  无需浏览器，双击即用，更好的文件系统访问权限
                </p>
              </div>
            </div>
          </div>

          {/* 下载按钮 */}
          <div className="space-y-3">
            <a
              href="https://github.com/tryandaction/lattice/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              onClick={handleClose}
            >
              <Download className="w-5 h-5" />
              前往下载页面
            </a>

            <button
              onClick={handleClose}
              className="w-full px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium transition-colors"
            >
              继续使用网页版
            </button>
          </div>

          {/* 不再显示选项 */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                不再显示此提示
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
