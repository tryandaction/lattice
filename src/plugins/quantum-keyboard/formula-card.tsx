import { memo, useLayoutEffect, useMemo, useRef } from "react";
import katex from "katex";
import { Star } from "lucide-react";
import { previewQuantumLatex, type QuantumCatalogEntry } from "./catalog";

export const FormulaPreview = memo(function FormulaPreview({ latex, fit = false }: { latex: string; fit?: boolean }) {
  const previewRef = useRef<HTMLSpanElement>(null);
  const markup = useMemo(() => {
    try {
      return katex.renderToString(previewQuantumLatex(latex), {
        throwOnError: true, strict: "ignore", trust: false, output: "html", displayMode: false,
      });
    } catch { return null; }
  }, [latex]);
  useLayoutEffect(() => {
    const container = previewRef.current;
    if (!fit || !container || !markup) return;
    const resize = () => {
      const formula = container.querySelector<HTMLElement>(".katex");
      if (!formula) return;
      const scale = Math.min(1, Math.max(1, container.clientWidth - 2) / Math.max(1, formula.offsetWidth), Math.max(1, container.clientHeight - 2) / Math.max(1, formula.offsetHeight));
      formula.style.transform = "scale(" + scale + ")";
      formula.style.transformOrigin = "center";
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(container);
    let active = true;
    void document.fonts?.ready.then(() => { if (active) resize(); });
    return () => { active = false; observer?.disconnect(); };
  }, [fit, markup]);
  return markup
    ? <span ref={previewRef} className={"qk-formula" + (fit ? " is-fitted" : "")} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />
    : <code className="qk-formula-fallback" aria-hidden="true">{latex}</code>;
});
export function quantumShortcut(entry: QuantumCatalogEntry): string {
  if (!entry.letter || !entry.index) return "";
  const key = (entry.layer === "ctrl" ? "Shift+" : "") + entry.letter;
  return key + (entry.index > 9 ? " · ← → Enter" : " → " + entry.index);
}
interface FormulaCardProps {
  entry: QuantumCatalogEntry; zh: boolean; favorite: boolean; showShortcut?: boolean; selected?: boolean;
  onInsert: (entry: QuantumCatalogEntry) => void;
  onFavorite: (id: string) => void;
  onInspect: (id: string) => void;
}
export const FormulaCard = memo(function FormulaCard({ entry, zh, favorite, showShortcut, selected, onInsert, onFavorite, onInspect }: FormulaCardProps) {
  const name = zh ? entry.nameZh : entry.nameEn;
  return (
    <div className={"qk-card" + (selected ? " is-selected" : "")} onMouseEnter={() => onInspect(entry.id)} onFocus={() => onInspect(entry.id)}>
      <button type="button" className="qk-card-insert" data-formula-id={entry.id}
        aria-label={(zh ? "插入 " : "Insert ") + name}
        onPointerDown={event => event.preventDefault()} onClick={() => onInsert(entry)}>
        <FormulaPreview latex={entry.latex} />
        <span className="qk-card-name">{name}</span>
        {showShortcut && <kbd className="qk-card-shortcut">{quantumShortcut(entry)}</kbd>}
      </button>
      <button type="button" className={"qk-favorite" + (favorite ? " is-active" : "")} aria-pressed={favorite}
        aria-label={(zh ? (favorite ? "取消收藏 " : "收藏 ") : (favorite ? "Unfavorite " : "Favorite ")) + name}
        onPointerDown={event => event.preventDefault()} onClick={() => onFavorite(entry.id)}>
        <Star size={12} fill={favorite ? "currentColor" : "none"} />
      </button>
    </div>
  );
});
