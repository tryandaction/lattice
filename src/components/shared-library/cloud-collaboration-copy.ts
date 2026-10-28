import type { Locale } from "@/types/settings";

const zh = {
  history: "版本历史", close: "关闭历史", refresh: "刷新历史", loading: "正在读取…", empty: "尚无已同步的历史版本。", current: "当前版本",
  preview: "版本预览", compare: "与当前版本比较", original: "查看历史原文", compareHint: "- 历史内容 / + 当前内容", download: "下载此版本",
  restore: "恢复此版本", confirm: "恢复为新版本", cancel: "取消", restoreHint: "会创建新版本，原有历史和作者记录仍保留。", restoring: "正在恢复…",
  binary: "此版本是二进制文件，可下载原文件查看。", choose: "选择版本以查看作者、内容和修改差异。", truncated: "内容较长，仅显示部分预览；下载可获取完整内容。",
  share: "共享与成员", ai: "云端 AI", reload: "加载最新版本", remote: "有新版本", dirty: "存在未保存修改，请先保存后再恢复或加载新版本。",
  pending: "已保存到本机，等待同步", synced: "已同步", offline: "离线 · 本机保存", conflict: "同步有冲突", failed: "同步待处理", disconnected: "请连接所属云库",
  readOnly: "只读", manage: "查看同步详情", restored: "历史内容已保存为新版本，正在同步。", readonlyHistory: "当前角色可查看历史，恢复需要编辑权限。",
  author: "作者", unknownAuthor: "未记录作者", own: "我", version: "版本", error: "操作未完成，请重试。", syncFirst: "此文件有待同步修改，请先完成同步或处理冲突。", restoredFrom: "恢复自",
};
type Copy = { [K in keyof typeof zh]: string };
const en: Copy = {
  history: "Version history", close: "Close history", refresh: "Refresh history", loading: "Loading…", empty: "No synced versions yet.", current: "Current version",
  preview: "Version preview", compare: "Compare with current", original: "Historical text", compareHint: "- Historical content / + Current content", download: "Download this version",
  restore: "Restore this version", confirm: "Restore as new version", cancel: "Cancel", restoreHint: "Creates a new version and preserves the history and attribution.", restoring: "Restoring…",
  binary: "This is a binary file. Download the original to inspect it.", choose: "Select a version to inspect its author, content and changes.", truncated: "Showing a partial preview. Download for complete content.",
  share: "Sharing and members", ai: "Cloud AI", reload: "Load latest version", remote: "New version available", dirty: "There are unsaved edits. Save them before restoring or loading a version.",
  pending: "Saved locally, waiting to sync", synced: "Synced", offline: "Offline · saved locally", conflict: "Sync conflict", failed: "Sync needs attention", disconnected: "Connect this file's cloud library",
  readOnly: "Read only", manage: "View sync details", restored: "Historical content saved as a new version. Syncing now.", readonlyHistory: "Your role can inspect history. Restoring requires edit access.",
  author: "Author", unknownAuthor: "Author not recorded", own: "Me", version: "Version", error: "The operation could not finish. Please retry.", syncFirst: "This file has pending changes. Finish syncing or resolve conflicts first.", restoredFrom: "Restored from",
};
export function cloudCollaborationCopy(locale: Locale): Copy { return locale === "en-US" ? en : zh; }
