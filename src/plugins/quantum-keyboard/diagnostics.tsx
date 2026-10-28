"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { runPluginCommand, syncPlugins } from "@/lib/plugins/runtime";
import { useQuantumPluginRuntime } from "./runtime";
import { setLocale } from "@/lib/i18n";
import { useI18n } from "@/hooks/use-i18n";
import { useTheme } from "@/hooks/use-theme";

const LivePreviewEditor = dynamic(() => import("@/components/editor/codemirror/live-preview/live-preview-editor").then(module => module.LivePreviewEditor), { ssr: false });
export function QuantumKeyboardDiagnostics() {
  const { locale } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const [content, setContent] = useState("# 量子键盘输入练习\n\n在这里输入公式：\n\n已有公式：$E=mc^2$\n\n");
  const [error, setError] = useState("");
  const active = useQuantumPluginRuntime(state => state.active);
  useEffect(() => {
    void syncPlugins({ pluginsEnabled: true, enabledPluginIds: ["quantum-keyboard"] }).catch(cause => setError(String(cause)));
  }, []);
  return <main className="min-h-screen bg-background p-6 text-foreground" data-testid="quantum-diagnostics">
    <h1 className="text-xl font-semibold">量子键盘交互验收</h1>
    <p className="mt-2 text-sm text-muted-foreground">真实 Markdown 编辑器与独立文本输入框，用于检查搜索、插入、填空、连续输入和插件启停。</p>
    <div className="my-4 flex flex-wrap gap-2">
      <button className="rounded border px-3 py-2 text-sm" disabled={!active} onClick={() => void runPluginCommand("quantum-keyboard.open")}>打开量子键盘</button>
      <button className="rounded border px-3 py-2 text-sm" onClick={() => void syncPlugins({ pluginsEnabled: !active, enabledPluginIds: active ? [] : ["quantum-keyboard"] })}>{active ? "停用插件" : "启用插件"}</button>
      <button className="rounded border px-3 py-2 text-sm" onClick={toggleTheme}>{isDark ? "浅色" : "深色"}</button>
      <select aria-label="界面语言" className="rounded border bg-background px-3 py-2 text-sm" value={locale} onChange={event => setLocale(event.target.value as "zh-CN" | "en-US")}>
        <option value="zh-CN">简体中文</option><option value="en-US">English</option>
      </select>
    </div>
    {error && <p role="alert">{error}</p>}
    <section className="h-[calc(100vh-200px)] min-h-64 rounded border" aria-label="Markdown 编辑区域">
      <LivePreviewEditor content={content} onChange={setContent} mode="live" fileId="quantum-keyboard-acceptance.md" />
    </section>
    <label className="mt-4 block text-sm">独立文本输入<textarea aria-label="独立文本输入" className="mt-2 block h-16 w-full rounded border bg-background p-2" defaultValue="f=" /></label>
    <details className="mt-4"><summary>Markdown 源码</summary><pre data-testid="markdown-source" className="whitespace-pre-wrap text-xs">{content}</pre></details>
  </main>;
}
