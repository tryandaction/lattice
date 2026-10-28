import type { Locale } from "@/types/settings";

interface CloudAiLabels {
  open: string;
  folder: string;
  source: (name: string) => string;
  scopeChanged: string;
  invalidSource: string;
  generating: string;
  selected: string;
  opened: (name: string) => string;
  noOpenedFile: string;
  select: string;
  readingSelection: string;
  fileLabel: string;
  folderLabel: string;
}

const labels: Record<Locale, CloudAiLabels> = {
  "zh-CN": {
    open: "云端 AI",
    folder: "带入 AI",
    source: name => `将「${name}」带入 AI，发送前可编辑问题`,
    scopeChanged: "云端账号或连接已切换，请重新选择云来源。原草稿已保留。",
    invalidSource: "云来源无效，请重新选择文件或目录。",
    generating: "AI 正在处理当前问题，请完成或停止后再选择云来源。",
    selected: "已选 AI 云来源：",
    opened: name => `当前打开文件：${name}`,
    noOpenedFile: "请先打开云文件或带入云来源",
    select: "选择云来源",
    readingSelection: "选择要交给AI阅读的文件或文件夹",
    fileLabel: "云文件",
    folderLabel: "云文件夹",
  },
  "en-US": {
    open: "Cloud AI",
    folder: "Use with AI",
    source: name => `Use “${name}” with AI; edit your question before sending`,
    scopeChanged: "The cloud account or connection changed. Select the cloud source again. Your draft has been kept.",
    invalidSource: "The cloud source is invalid. Select the file or folder again.",
    generating: "AI is processing the current question. Finish or stop it before selecting a cloud source.",
    selected: "Selected cloud sources for AI:",
    opened: name => `Currently open file: ${name}`,
    noOpenedFile: "Open a cloud file or select a cloud source first",
    select: "Select cloud sources",
    readingSelection: "Choose files or folders for AI to read",
    fileLabel: "Cloud file",
    folderLabel: "Cloud folder",
  },
};

export function cloudAiLabels(locale: Locale = "zh-CN"): CloudAiLabels { return labels[locale]; }
