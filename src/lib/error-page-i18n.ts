import { SETTINGS_STORAGE_KEY, type Locale } from "@/types/settings";

export interface ErrorPageCopy {
  title: string;
  description: string;
  reload: string;
  clearStorage: string;
  technicalDetails: string;
  clearStorageConfirm: string;
}

const ERROR_PAGE_COPY: Record<Locale, ErrorPageCopy> = {
  "zh-CN": {
    title: "应用加载失败",
    description: "检测到客户端运行时异常。请先尝试刷新，或清空本地缓存后重新加载。",
    reload: "重新加载",
    clearStorage: "清空本地缓存并重载",
    technicalDetails: "技术详情",
    clearStorageConfirm: [
      "危险操作检测！",
      "操作类型：清空本地缓存",
      "影响范围：本地设置、插件缓存、临时状态",
      "风险评估：将丢失本地偏好设置，需要重新配置",
      "",
      "请确认是否继续？",
    ].join("\n"),
  },
  "en-US": {
    title: "Application Failed To Load",
    description: "A client runtime error was detected. Try reloading first, or clear local cache and reload.",
    reload: "Reload",
    clearStorage: "Clear Local Cache And Reload",
    technicalDetails: "Technical Details",
    clearStorageConfirm: [
      "Risky operation detected.",
      "Operation: clear local cache",
      "Scope: local settings, plugin cache, temporary state",
      "Risk: local preferences will be lost and need to be configured again",
      "",
      "Continue?",
    ].join("\n"),
  },
};

function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { language?: unknown };
    return parsed.language === "zh-CN" || parsed.language === "en-US" ? parsed.language : null;
  } catch {
    return null;
  }
}

function readNavigatorLocale(): Locale {
  if (typeof navigator === "undefined") {
    return "zh-CN";
  }
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function detectErrorPageLocale(): Locale {
  return readStoredLocale() ?? readNavigatorLocale();
}

export function getErrorPageCopy(locale: Locale = detectErrorPageLocale()): ErrorPageCopy {
  return ERROR_PAGE_COPY[locale] ?? ERROR_PAGE_COPY["zh-CN"];
}
