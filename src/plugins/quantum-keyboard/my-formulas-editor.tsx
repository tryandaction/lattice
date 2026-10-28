"use client";
import { useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useQuantumFormulaLibraryStore } from "@/stores/quantum-formula-library-store";
import { useQuantumCustomStore } from "@/stores/quantum-custom-store";
import { buildFormulaRecord } from "@/lib/formula-composer";
import { FormulaPreview } from "./formula-card";

export function MyFormulasEditor() {
  const { locale } = useI18n();
  const zh = locale !== "en-US";
  const [label, setLabel] = useState("");
  const [latex, setLatex] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const records = useQuantumFormulaLibraryStore(state => state.records);
  const mappings = useQuantumCustomStore(state => state.customMappings);
  const customs = Object.entries(mappings).flatMap(([keyCode, mapping]) => mapping.customSymbols.map(value => ({ keyCode, latex: value })));
  return <details className="mt-4 border-t border-border pt-3">
    <summary className="cursor-pointer text-xs font-semibold">{zh ? "我的公式" : "My formulas"}</summary>
    <p className="my-2 text-xs text-muted-foreground">{zh ? "给常用公式起一个容易想到的名字，保存后可在面板中搜索和直接输入。仅保存在本机。" : "Name a formula so you can find and insert it. Saved on this device."}</p>
    <form className="grid gap-2" aria-label={zh ? "我的公式编辑器" : "My formula editor"} onKeyDown={event => {
      if (event.key === "Escape" && editingId) {
        event.preventDefault();
        event.stopPropagation();
        setEditingId(null); setLabel(""); setLatex(""); setMessage(""); setInvalid(false);
      }
    }} onSubmit={event => {
      event.preventDefault();
      if (!label.trim() || !latex.trim()) return;
      const record = buildFormulaRecord(latex, { label });
      if (!record.latex) {
        setInvalid(true); setMessage(zh ? "请输入有效的公式内容。" : "Enter formula content before saving.");
        return;
      }
      if (editingId) useQuantumFormulaLibraryStore.getState().updateFormulaRecord(editingId, label, latex);
      else useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(record);
      setMessage(zh ? (editingId ? "公式已更新" : "公式已保存") : (editingId ? "Formula updated" : "Formula saved"));
      setInvalid(false); setEditingId(null); setLabel(""); setLatex("");
      nameInput.current?.focus();
    }}>
      <input ref={nameInput} className="h-8 min-w-0 rounded border border-input bg-background px-2 text-xs" aria-label={zh ? "公式名称" : "Formula name"} placeholder={zh ? "名称，如 我的常用展开式" : "Formula name"} value={label} onChange={event => setLabel(event.target.value)} required />
      <textarea id="quantum-formula-latex" className="min-h-16 min-w-0 rounded border border-input bg-background p-2 font-mono text-xs" aria-label={zh ? "公式 LaTeX" : "Formula LaTeX"} aria-invalid={invalid} aria-describedby={invalid ? "quantum-formula-error" : undefined} placeholder={"\\frac{a}{b}"} value={latex} onChange={event => { setLatex(event.target.value); setInvalid(false); setMessage(""); }} onKeyDown={event => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
      }} required />
      {latex.trim() && <FormulaPreview latex={latex} />}
      <button className="inline-flex items-center justify-center gap-1 rounded border border-border p-2 text-xs hover:bg-muted" type="submit" disabled={!label.trim() || !latex.trim()}><Plus size={12} />{editingId ? (zh ? "更新公式" : "Update formula") : (zh ? "保存公式" : "Save formula")}</button>
      {editingId && <button type="button" className="text-xs text-muted-foreground" onClick={() => { setEditingId(null); setLabel(""); setLatex(""); setMessage(""); setInvalid(false); }}>{zh ? "取消编辑" : "Cancel editing"}</button>}
      {message && <p id={invalid ? "quantum-formula-error" : undefined} role={invalid ? "alert" : "status"} className="text-xs text-muted-foreground">{message}</p>}
    </form>
    <div className="mt-3 space-y-2">
      {records.map(record => <div key={record.id} className="flex min-w-0 items-center gap-2 rounded border border-border p-2">
        <span className="min-w-0 flex-1"><span className="block text-xs">{record.label}</span><FormulaPreview latex={record.latex} /></span>
        <button type="button" className="qk-icon" aria-label={(zh ? "编辑 " : "Edit ") + record.label} onClick={() => {
          setEditingId(record.id); setLabel(record.label); setLatex(record.latex); setMessage(""); setInvalid(false); nameInput.current?.focus();
        }}><Pencil size={13} /></button>
        <button type="button" className="qk-icon" aria-label={(zh ? "移除 " : "Remove ") + record.label}
          onClick={() => {
            useQuantumFormulaLibraryStore.getState().removeFormulaRecord(record.id);
            if (editingId === record.id) { setEditingId(null); setLabel(""); setLatex(""); setMessage(""); setInvalid(false); }
          }}><Trash2 size={13} /></button>
      </div>)}
      {customs.map(custom => <div key={custom.keyCode + custom.latex} className="flex min-w-0 items-center gap-2 rounded border border-border p-2">
        <span className="min-w-0 flex-1"><span className="text-xs text-muted-foreground">{zh ? "原有自定义符号 · " : "Existing custom symbol · "}{custom.keyCode.replace("Key", "")}</span><FormulaPreview latex={custom.latex} /></span>
        <button type="button" className="qk-icon" aria-label={(zh ? "移除 " : "Remove ") + custom.latex} onClick={() => useQuantumCustomStore.getState().removeCustomSymbol(custom.keyCode, custom.latex)}><Trash2 size={13} /></button>
      </div>)}
    </div>
  </details>;
}
