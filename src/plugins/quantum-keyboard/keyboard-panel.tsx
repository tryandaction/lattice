"use client";
import "katex/dist/katex.min.css";
import "./keyboard.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, GripHorizontal, Keyboard, RotateCcw, Search, Settings2, X } from "lucide-react";
import { useHUDStore } from "@/stores/hud-store";
import { useQuantumKeymapStore } from "@/stores/quantum-keymap-store";
import { useQuantumCustomStore } from "@/stores/quantum-custom-store";
import { useQuantumFormulaLibraryStore } from "@/stores/quantum-formula-library-store";
import { getActiveInputTarget, getLastActiveInputTarget } from "@/lib/unified-input-handler";
import { useI18n } from "@/hooks/use-i18n";
import { KEY_LABELS } from "@/config/quantum-keymap";
import type { QuantumInsertPayload } from "./provider";
import { buildQuantumCatalog, CATALOG_CATEGORIES, portableQuantumLatex, searchQuantumCatalog, uniqueQuantumEntries, type QuantumCatalogEntry } from "./catalog";
import { FormulaCard, FormulaPreview, quantumShortcut } from "./formula-card";
import { useQuantumPreferences } from "./preferences";
import { useQuantumPluginRuntime } from "./runtime";
import { usePanelPosition } from "./use-panel-position";
import { QuantumKeyboardEditor } from "./keymap-editor";
import { KeyboardBoard } from "./keyboard-board";
import { entryNeedsFilling } from "./input-policy";
import { finishQuantumFormula, useKeyboardInput } from "./use-keyboard-input";
import { buildMatrixLatex, MATRIX_SIZE_LIMITS, parseMatrixTemplate, type MatrixTemplate } from "./matrix-size";
import { MatrixSizeForm } from "./matrix-size-form";
import type { ControlFormulaChord } from "./shortcut-engine";

export interface KeyboardPanelProps { onInsertSymbol: (payload: QuantumInsertPayload) => boolean | void }
export function KeyboardPanel({ onInsertSymbol }: KeyboardPanelProps) {
  const { locale } = useI18n();
  const zh = locale !== "en-US";
  const tr = useCallback((cn: string, en: string) => zh ? cn : en, [zh]);
  const overrides = useQuantumKeymapStore(state => state.overrides);
  const customMappings = useQuantumCustomStore(state => state.customMappings);
  const records = useQuantumFormulaLibraryStore(state => state.records);
  const prefs = useQuantumPreferences();
  const { view, section, favorites, recent, mappingSource } = prefs;
  const tab = useQuantumPluginRuntime(state => state.tab);
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [inspected, setInspected] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [matrixDraft, setMatrixDraft] = useState<{ entry: QuantumCatalogEntry; template: MatrixTemplate } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const catalog = useMemo(() => buildQuantumCatalog(mappingSource === "official" ? {} : overrides, mappingSource === "official" ? {} : customMappings, records),
    [mappingSource, overrides, customMappings, records]);
  const entryById = useMemo(() => new Map(catalog.map(entry => [entry.id, entry])), [catalog]);
  const unique = useMemo(() => uniqueQuantumEntries(catalog), [catalog]);
  const isSearching = Boolean(query.trim());
  const auxiliary = view === "browse" || isSearching;
  const { panelRef, style: panelStyle, custom: customPosition, dragProps } = usePanelPosition({ fitContent: tab !== "settings" && !auxiliary });
  const visible = useMemo(() => {
    if (query.trim()) return uniqueQuantumEntries(searchQuantumCatalog(catalog, query));
    if (section === "favorites" || section === "recent") return (section === "favorites" ? favorites : recent).map(id => entryById.get(id)).filter((entry): entry is QuantumCatalogEntry => Boolean(entry));
    if (section === "custom") return catalog.filter(entry => entry.category === "custom");
    if (section === "all" || section === "common") return unique;
    return unique.filter(entry => entry.category === section);
  }, [query, catalog, section, favorites, recent, entryById, unique]);
  const selectedSearchIndex = Math.min(searchIndex, Math.max(0, visible.length - 1));
  useEffect(() => {
    if (auxiliary) document.querySelector<HTMLElement>("[data-quantum-keyboard] .qk-card.is-selected")?.scrollIntoView?.({ block: "nearest" });
  }, [auxiliary, selectedSearchIndex]);
  const close = useCallback(() => {
    const target = getActiveInputTarget() ?? getLastActiveInputTarget();
    useHUDStore.getState().closeHUD();
    target?.focus();
  }, []);
  const returnToEditor = useCallback(() => {
    const target = getActiveInputTarget() ?? getLastActiveInputTarget();
    if (target?.element.isConnected) target.focus();
    else setStatus(tr("请先在文档中点击一个输入位置。", "Choose an editing position in your document first."));
  }, [tr]);
  const commitInsert = useCallback((entry: QuantumCatalogEntry) => {
    let inserted: boolean | void;
    try { inserted = onInsertSymbol({ latex: portableQuantumLatex(entry.latex), mathLiveLatex: entry.mathlive, displayMode: entry.displayMode }); }
    catch { setStatus(tr("公式未能插入，请重新选择文档输入位置。", "Could not insert. Select an editing position and try again.")); return false; }
    if (inserted === false) { setStatus(tr("请先在文档中点击一个输入位置，再选择公式。", "Click an editing position in your document, then choose a formula.")); return false; }
    useQuantumPreferences.getState().recordUse(entry.id);
    if (entryNeedsFilling(entry)) useQuantumPreferences.setState({ shortcutMode: false });
    setInspected(entry.id);
    setStatus((zh ? entry.nameZh : entry.nameEn) + (entryNeedsFilling(entry) ? tr(" · 直接填写，Tab 下一空位", " · Fill directly; Tab for next slot") : tr(" · 已输入", " · Inserted")));
    return true;
  }, [onInsertSymbol, tr, zh]);
  const insert = useCallback((entry: QuantumCatalogEntry) => {
    const template = parseMatrixTemplate(entry.latex);
    if (template) {
      setMatrixDraft({ entry, template });
      setInspected(entry.id);
      setStatus(tr("输入行数和列数，Enter 生成矩阵并从第一格填写。", "Enter rows and columns; press Enter to insert and fill the first cell."));
    } else {
      if (commitInsert(entry)) setMatrixDraft(null);
    }
  }, [commitInsert, tr]);
  const openLookup = useCallback(() => {
    useQuantumPreferences.setState({ view: "browse", section: "all" }); setQuery(""); setSearchIndex(0);
    queueMicrotask(() => searchRef.current?.focus());
  }, []);
  const commitControlChord = useCallback((chord: ControlFormulaChord) => {
    if (chord.kind === "formula") {
      const entry = catalog.find(candidate => candidate.latex === chord.latex);
      if (entry) {
        useQuantumPreferences.setState({ selectedKey: "KeyI", layer: "base" });
        commitInsert(entry);
      } else setStatus(tr("没有匹配的积分公式。", "No matching integral formula."));
      return;
    }
    const template = catalog.find(candidate => candidate.keyCode === "KeyM" && candidate.layer === "base");
    if (!template) { setStatus(tr("矩阵模板不可用。", "Matrix template is unavailable.")); return; }
    const latex = buildMatrixLatex("pmatrix", chord.rows, chord.columns);
    useQuantumPreferences.setState({ selectedKey: "KeyM", layer: "base" });
    commitInsert({
      ...template,
      latex,
      nameZh: "矩阵 " + chord.rows + "×" + chord.columns,
      nameEn: chord.rows + "×" + chord.columns + " matrix",
      shortLabel: undefined,
      mathlive: undefined,
      displayMode: true,
    });
    setMatrixDraft(null);
  }, [catalog, commitInsert, setStatus, tr]);
  const input = useKeyboardInput({ catalog, insert, close, report: setStatus, zh, lookup: openLookup, commitControlChord });
  const activeLayer = input.choosingKey ? input.choosingLayer : prefs.layer;
  const selectedCandidates = input.choosingKey ? catalog.filter(entry => entry.keyCode === input.choosingKey && entry.layer === input.choosingLayer) : [];
  const detail = inspected ? entryById.get(inspected) : null;
  const selectKey = (keyCode: string) => {
    input.chooseKey(keyCode, prefs.layer);
    const entry = catalog.find(candidate => candidate.keyCode === keyCode && candidate.layer === prefs.layer);
    if (entry) setInspected(entry.id);
    returnToEditor();
  };
  const returnToKeyboard = () => { setQuery(""); useQuantumPreferences.setState({ view: "keys" }); returnToEditor(); };
  const insertFromLookup = (entry: QuantumCatalogEntry) => {
    setQuery(""); useQuantumPreferences.setState({ view: "keys" }); insert(entry);
  };
  const command = (value: string) => {
    const target = getActiveInputTarget() ?? getLastActiveInputTarget();
    if (target?.type === "mathlive") {
      (target.element as HTMLElement & { executeCommand?: (command: string) => unknown }).executeCommand?.(value);
      target.focus();
    } else returnToEditor();
  };
  return <section ref={panelRef} data-quantum-keyboard className={"qk-panel qk-keyboard-product" + (auxiliary ? " qk-auxiliary" : "")}
    role="dialog" aria-modal="false" aria-label={tr("量子键盘", "Quantum Keyboard")} style={panelStyle}>
    <header className="qk-header" {...dragProps}>
      <div className="qk-heading"><Keyboard size={18} /><strong>{tr("量子键盘", "Quantum Keyboard")}</strong><GripHorizontal className="qk-grip" size={16} /></div>
      <div className="qk-header-actions">
        {customPosition && <button type="button" className="qk-icon btn-sm" aria-label={tr("重置位置", "Reset position")} onClick={() => useHUDStore.getState().resetPosition()}><RotateCcw size={15} /></button>}
        <button type="button" className="qk-icon btn-sm" aria-label={tr("键位设置", "Key mapping settings")} title="F4" onClick={() => useQuantumPluginRuntime.setState({ tab: tab === "settings" ? "input" : "settings" })}><Settings2 size={16} /></button>
        <button type="button" className="qk-icon btn-sm" aria-label={tr("关闭量子键盘", "Close Quantum Keyboard")} title="Esc" onClick={close}><X size={18} /></button>
      </div>
    </header>
    {tab === "settings" ? <div className="qk-settings" onKeyDown={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing && !event.defaultPrevented) { event.preventDefault(); useQuantumPluginRuntime.setState({ tab: "input" }); returnToEditor(); }
    }}>
      <button type="button" className="qk-text-button btn-sm" onClick={() => { useQuantumPluginRuntime.setState({ tab: "input" }); returnToEditor(); }}><ArrowLeft size={14} />{tr("返回公式输入", "Back to keyboard")}</button>
      <QuantumKeyboardEditor />
    </div> : <>
      <div className="qk-physical-toolbar">
        <div className="qk-layer-switch" aria-label={tr("键位层", "Key layer")}>
          <button type="button" className="btn-sm" aria-pressed={activeLayer === "base"} onClick={() => { input.clearChoice(); useQuantumPreferences.setState({ layer: "base" }); returnToEditor(); }}>{tr("常用层", "Base")}</button>
          <button type="button" className="btn-sm" aria-pressed={activeLayer === "ctrl"} onClick={() => { input.clearChoice(); useQuantumPreferences.setState({ layer: "ctrl" }); returnToEditor(); }}>{tr("扩展层", "Extended")}</button><kbd>F3</kbd>
        </div>
        <div className="qk-mapping-switch" aria-label={tr("映射方案", "Mapping")}>
          <button type="button" className="btn-sm" aria-pressed={mappingSource === "official"} onClick={() => useQuantumPreferences.setState({ mappingSource: "official" })}>{tr("官方推荐", "Official")}</button>
          <button type="button" className="btn-sm" aria-pressed={mappingSource === "custom"} onClick={() => useQuantumPreferences.setState({ mappingSource: "custom" })}>{tr("我的映射", "My mapping")}</button>
        </div>
        <button type="button" className="qk-mode-button btn-sm" aria-pressed={prefs.shortcutMode} onClick={() => { useQuantumPreferences.setState({ shortcutMode: !prefs.shortcutMode }); returnToEditor(); }}>
          <kbd>F2</kbd>{prefs.shortcutMode ? tr("符号直输", "Symbol input") : tr("变量填写", "Type variables")}
        </button>
        <button type="button" className="qk-lookup-toggle btn-sm" aria-label={tr("查找更多公式", "Find more formulas")} aria-pressed={auxiliary}
          title={tr("符号直输时 /，填写时 Alt+/", "/ in symbol mode; Alt+/ while filling")}
          onClick={() => auxiliary ? returnToKeyboard() : openLookup()}><Search size={14} />{tr("查找", "Find")}<kbd>/</kbd></button>
      </div>
      {auxiliary ? <>
        <div className="qk-search" data-quantum-search onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); returnToKeyboard(); }
        }}><Search size={15} /><input type="search" ref={searchRef} value={query} aria-label={tr("搜索公式", "Search formulas")}
          placeholder={tr("中文、英文、LaTeX · ↑↓ 选择，Enter 输入", "Names or LaTeX · arrows to choose, Enter to insert")} onChange={event => { setQuery(event.target.value); setSearchIndex(0); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setSearchIndex(index => Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
            }
            if (event.key === "Enter" && visible[selectedSearchIndex]) { event.preventDefault(); insertFromLookup(visible[selectedSearchIndex]); }
          }} />
          <button type="button" className="qk-icon btn-sm" aria-label={tr("返回键盘", "Return to keyboard")} onClick={returnToKeyboard}><X size={14} /></button></div>
        <div className="qk-workspace"><nav className="qk-categories" aria-label={tr("公式分类", "Formula categories")}>
          {CATALOG_CATEGORIES.filter(category => category.id !== "common").map(category => <button type="button" className="btn-sm" key={category.id}
            aria-label={(zh ? category.zh : category.en) + " " + (category.id === "favorites" ? favorites.length : category.id === "recent" ? recent.length : category.id === "all" ? unique.length : unique.filter(entry => entry.category === category.id).length)}
            aria-pressed={section === category.id && !query} onClick={() => { setQuery(""); setSearchIndex(0); useQuantumPreferences.setState({ section: category.id }); }}>{zh ? category.zh : category.en}</button>)}
        </nav><div className="qk-results"><div className="qk-results-heading"><strong>{tr("查找与收藏", "Find & favorites")}</strong><span>{visible.length} {tr("项", "items")}</span></div>
          <div className="qk-grid">{visible.map((entry, index) => <FormulaCard key={entry.id} entry={entry} zh={zh} selected={selectedSearchIndex === index} favorite={favorites.includes(entry.id)} onInsert={insertFromLookup} onFavorite={prefs.toggleFavorite} onInspect={setInspected} />)}</div>
          {!visible.length && <div className="qk-empty"><strong>{tr("没有匹配公式", "No matching formulas")}</strong><p>{tr("试试符号名、中文或 LaTeX。", "Try a symbol name or LaTeX.")}</p><button type="button" className="qk-text-button btn-sm" onClick={() => { setQuery(""); useQuantumPreferences.setState({ section: "all" }); }}>{tr("浏览全部公式", "Show all formulas")}</button></div>}
        </div></div>
      </> : <div className="qk-board-scroll">
        <div className="qk-physical-deck">
          <KeyboardBoard catalog={catalog} layer={activeLayer} selectedKey={input.choosingKey ?? prefs.selectedKey} pendingIndex={input.prefix?.index ?? null}
            activeIndex={input.choosingKey ? input.candidateIndex : null} zh={zh} onSelectKey={selectKey} onInsert={entry => { input.clearChoice(); insert(entry); }} onInspect={setInspected} />
          <div className="qk-physical-bottom-row" role="group" aria-label={tr("公式编辑控制键", "Formula editing keys")}>
          <button type="button" className="qk-utility-key btn-sm" onPointerDown={event => event.preventDefault()} onClick={() => command("deleteBackward")}><kbd>⌫</kbd>{tr("删除", "Delete")}</button>
          <button type="button" className="qk-utility-key btn-sm" onPointerDown={event => event.preventDefault()} onClick={() => command("moveToPreviousPlaceholder")}><kbd>Shift Tab</kbd>{tr("上一空位", "Previous")}</button>
          <button type="button" className="qk-utility-key btn-sm" onPointerDown={event => event.preventDefault()} onClick={() => command("addRowAfter")}><kbd>Alt Enter</kbd>{tr("矩阵加行", "Add row")}</button>
          <button type="button" className="qk-utility-key btn-sm" onPointerDown={event => event.preventDefault()} onClick={() => command("addColumnAfter")}><kbd>Alt →</kbd>{tr("矩阵加列", "Add column")}</button>
          <button type="button" className="qk-utility-key qk-space-key btn-sm" onPointerDown={event => event.preventDefault()} onClick={() => { useQuantumPreferences.setState({ shortcutMode: !prefs.shortcutMode }); returnToEditor(); }}>
            <kbd>F2</kbd>{prefs.shortcutMode ? tr("字母 → 数字 · 选择符号", "Letter → number · choose symbol") : tr("变量填写 · 直接输入字母数字", "Variables · type letters and numbers")}
          </button>
          <button type="button" className="qk-utility-key btn-sm" onPointerDown={event => event.preventDefault()} onClick={() => command("moveToNextPlaceholder")}><kbd>Tab</kbd>{tr("下一空位", "Next")}</button>
          <button type="button" className="qk-utility-key btn-sm" onPointerDown={event => event.preventDefault()} onClick={() => { finishQuantumFormula(); useQuantumPreferences.setState({ shortcutMode: false }); }}><kbd>Ctrl Enter</kbd>{tr("完成 / 编辑", "Finish / edit")}</button>
          </div>
        </div>
      </div>}
      {!auxiliary && <div className="qk-scroll-hint">{tr("左右滑动查看完整键盘 ↔", "Scroll horizontally for all keys ↔")}</div>}
      <footer className="qk-footer">
        {matrixDraft ? <MatrixSizeForm key={matrixDraft.entry.id} initialSize={matrixDraft.template} zh={zh}
          onCancel={() => { setMatrixDraft(null); setStatus(tr("已取消矩阵尺寸输入。", "Matrix size entry cancelled.")); returnToEditor(); }}
          onConfirm={size => {
            const latex = buildMatrixLatex(matrixDraft.template.environment, size.rows, size.columns);
            const target = getActiveInputTarget() ?? getLastActiveInputTarget();
            if (target?.type === "mathlive") {
              const field = target.element as HTMLElement & { maxMatrixCols: number };
              field.maxMatrixCols = Math.max(field.maxMatrixCols, MATRIX_SIZE_LIMITS.max);
            }
            if (commitInsert({ ...matrixDraft.entry, latex, mathlive: undefined, displayMode: true })) setMatrixDraft(null);
          }} /> : input.choosingKey ? <div className="qk-candidate-strip" role="group" aria-label={tr("当前键全部候选", "Selected key candidates")}>
            <strong>{KEY_LABELS[input.choosingKey]}</strong>
            <div className="qk-candidate-options">{selectedCandidates.map((entry, index) => <button key={entry.id} type="button" className="btn-sm" aria-pressed={input.candidateIndex === index + 1}
              aria-label={tr("选择 ", "Choose ") + (index + 1) + " " + (zh ? entry.nameZh : entry.nameEn)}
              onPointerDown={event => event.preventDefault()} onClick={() => { input.clearChoice(); insert(entry); }}>
              <kbd>{index + 1}</kbd>{entry.shortLabel ? <strong>{zh ? entry.shortLabel.zh : entry.shortLabel.en}</strong> : <FormulaPreview latex={entry.latex} />}<span>{zh ? entry.nameZh : entry.nameEn}</span>
            </button>)}</div><span className="qk-candidate-hint">{tr("编号 / ← → Enter", "Number / ← → Enter")}</span>
          </div> : <div className="qk-key-help">
          <span><kbd>{tr("字母 + 数字", "Letter + number")}</kbd>{tr("输入对应候选", "insert that choice")}</span>
          <span><kbd>{tr("Shift + 字母 + 数字", "Shift + letter + number")}</kbd>{tr("扩展层候选", "extended choice")}</span>
          <span title={tr("按住 Ctrl，依次按 I、2、0，松开 Ctrl 输入。", "Hold Ctrl; press I, 2, 0, then release Ctrl to insert.")}><kbd>Ctrl+I+20</kbd>{tr("闭合曲面积分", "closed-surface integral")}</span>
          <span title={tr("按住 Ctrl，依次按 M、3、4，松开 Ctrl 输入。", "Hold Ctrl; press M, 3, 4, then release Ctrl to insert.")}><kbd>Ctrl+M+34</kbd>{tr("3×4 矩阵", "3×4 matrix")}</span>
        </div>}
        <div className={"qk-key-detail" + (status || (detail && !matrixDraft) ? " has-feedback" : "")}><span role="status">{status}</span>
          {detail && !matrixDraft && <span className="qk-detail-preview"><FormulaPreview latex={detail.latex} fit /><span>{zh ? detail.nameZh : detail.nameEn}</span><kbd>{quantumShortcut(detail)}</kbd></span>}
          <span className="qk-prefix-state">{input.prefix ? tr("兼容快捷键：按字母输入第 ", "Legacy shortcut: press a letter for choice ") + input.prefix.index + tr(" 项", "") : input.choosingKey ? KEY_LABELS[input.choosingKey] + tr(" 键：按编号", ": press a number") : "Esc " + tr("关闭", "close")}</span>
        </div>
      </footer>
    </>}
  </section>;
}
