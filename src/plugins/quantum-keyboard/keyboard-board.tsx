import { useLayoutEffect, useRef } from "react";
import { KEY_LABELS, QWERTY_LAYOUT, type QuantumLayerId } from "@/config/quantum-keymap";
import type { QuantumCatalogEntry } from "./catalog";
import { FormulaPreview } from "./formula-card";
import { parseMatrixTemplate } from "./matrix-size";

const COMPACT_ENGLISH_LABELS: Record<string, string> = {
  "Schröd.": "Schr.", "Arrhenius": "Arrh.", "Absorb.": "Abs.", "Impulse": "Imp.",
  "Laplace": "Lap.", "Volume": "Vol.", "Inertia": "Inert.", "Enzyme": "Enz.",
};
const COMPACT_FORMULA_PREVIEWS: Record<string, string> = {
  "功微分": "\\mathrm{d}W", "薛定谔": "\\hat H\\psi", "期望值": "\\langle A\\rangle",
  "反应速率": "r", "阿伦尼乌斯": "k(T)", "瞬时功率": "P", "定压热容": "C_p",
  "吸光度": "A", "作用量": "S", "傅里叶": "\\hat f", "转动惯量": "I",
  "区域体积": "V", "冲量": "J", "拉普模板": "\\mathcal L", "能斯特": "E",
  "正态分布": "\\mathcal N", "酶催化": "E+S", "幂律速率": "r",
};
function KeycapMeaning({ entry, zh }: { entry: QuantumCatalogEntry; zh: boolean }) {
  if (entry.shortLabel) {
    const formula = COMPACT_FORMULA_PREVIEWS[entry.shortLabel.zh];
    if (formula) return <FormulaPreview latex={formula} />;
    return <span className="qk-keycap-label"><span>{zh ? entry.shortLabel.zh : COMPACT_ENGLISH_LABELS[entry.shortLabel.en] ?? entry.shortLabel.en}</span></span>;
  }
  const matrix = parseMatrixTemplate(entry.latex);
  if (matrix) {
    const size = matrix.rows + "×" + matrix.columns;
    const brackets: Record<string, [string, string]> = { pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"], vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"] };
    const [left, right] = brackets[matrix.environment] ?? ["", ""];
    return <span className="qk-keycap-label qk-matrix-label">{left + size + right}</span>;
  }
  if (entry.latex.includes("\\begin{cases}")) return <span className="qk-keycap-label">{zh ? "分段" : "cases"}</span>;
  const preview = entry.latex
    .replace(/\\dfrac/g, "\\frac")
    .replace(/\\lim_\{\{\}\\to\{\}\}\s*\{\}/g, "\\lim_{\\to}")
    .replace(/\\braket\{\}\{\}/g, "\\langle\\cdot|\\cdot\\rangle");
  return <FormulaPreview latex={preview} />;
}

interface KeyboardBoardProps {
  catalog: QuantumCatalogEntry[];
  layer: QuantumLayerId;
  selectedKey: string;
  pendingIndex: number | null;
  activeIndex?: number | null;
  zh: boolean;
  onSelectKey: (keyCode: string) => void;
  onInsert: (entry: QuantumCatalogEntry) => void;
  onInspect: (id: string) => void;
}
export function KeyboardBoard({ catalog, layer, selectedKey, pendingIndex, activeIndex, zh, onSelectKey, onInsert, onInspect }: KeyboardBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const fit = () => {
      board.querySelectorAll<HTMLElement>('.qk-keycap-symbol .qk-formula').forEach(container => {
        const formula = container.querySelector<HTMLElement>('.katex');
        if (!formula) return;
        const scale = Math.min(1, Math.max(1, container.clientWidth - 2) / Math.max(1, formula.offsetWidth), Math.max(1, container.clientHeight - 4) / Math.max(1, formula.offsetHeight));
        formula.style.transform = 'scale(' + scale + ')';
        formula.style.transformOrigin = 'center';
      });
      board.querySelectorAll<HTMLElement>('.qk-keycap-label > span').forEach(label => {
        const available = label.parentElement!.clientWidth;
        label.style.transform = 'scale(' + Math.min(1, available / Math.max(1, label.offsetWidth)) + ')';
      });
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(board);
    let active = true;
    void document.fonts?.ready.then(() => { if (active) fit(); });
    return () => { active = false; observer?.disconnect(); };
  }, [catalog, layer, zh]);
  return <div ref={boardRef} className="qk-physical-board" role="group" aria-label={zh ? "QWERTY 公式键盘" : "QWERTY formula keyboard"}>
    {QWERTY_LAYOUT.map((row, rowIndex) => <div key={rowIndex} className={"qk-physical-row qk-physical-row-" + rowIndex}>
      {row.keys.map(keyCode => {
        const candidates = catalog.filter(entry => entry.keyCode === keyCode && entry.layer === layer);
        const name = KEY_LABELS[keyCode];
        return <div key={keyCode} className={"qk-keycap" + (selectedKey === keyCode ? " is-selected" : "")}
          role="group" aria-label={name + (zh ? " 键全部符号" : " key symbols")} data-keycode={keyCode}>
          <button className="qk-keycap-title btn-sm" type="button" aria-label={name + (zh ? " 键候选" : " key candidates")}
            aria-pressed={selectedKey === keyCode} onPointerDown={event => event.preventDefault()} onClick={() => onSelectKey(keyCode)}>
            <kbd>{name}</kbd><span>{candidates.length}</span>
          </button>
          <div className={"qk-keycap-symbols" + (candidates.length <= 4 ? " is-compact" : " is-full")}
            data-density={candidates.length <= 4 ? "compact" : "full"}>
            {candidates.map((entry, index) => <button key={entry.id} type="button"
              className={"qk-keycap-symbol btn-sm" + (pendingIndex === index + 1 || (selectedKey === keyCode && activeIndex === index + 1) ? " is-pending" : "")}
              aria-label={name + (zh ? " 键 " : " key ") + (index + 1) + " " + (zh ? entry.nameZh : entry.nameEn)}
              title={(zh ? entry.nameZh : entry.nameEn) + " · " + (index < 9 ? (layer === "ctrl" ? "Shift+" : "") + name + " → " + (index + 1) : (zh ? "选中键帽，← → 选择，Enter 输入" : "Select key, use arrows, then Enter"))}
              onPointerDown={event => event.preventDefault()} onMouseEnter={() => onInspect(entry.id)} onFocus={() => onInspect(entry.id)}
              onClick={() => onInsert(entry)} data-meaning-id={entry.id}>
              <sup>{index + 1}</sup><KeycapMeaning entry={entry} zh={zh} />
            </button>)}
          </div>
        </div>;
      })}
    </div>)}
  </div>;
}
