'use client';

import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  KEY_LABELS,
  QWERTY_LAYOUT,
  getAllQuantumLayerMeanings,
  getQuantumLayerMeanings,
  type QuantumLayerId,
} from '@/config/quantum-keymap';
import {
  applyQuantumMeaningOverride,
  getEffectiveQuantumLayerMeanings,
  useQuantumKeymapStore,
} from '@/stores/quantum-keymap-store';
import { cn } from '@/lib/utils';
import { FormulaPreview } from './formula-card';
import { MyFormulasEditor } from './my-formulas-editor';
import { useQuantumPreferences } from './preferences';
import { useI18n } from '@/hooks/use-i18n';
import { useQuantumCustomStore } from '@/stores/quantum-custom-store';

const LAYERS: { id: QuantumLayerId; label: string; hint: string }[] = [
  { id: 'base', label: 'Base', hint: 'Letter → number' },
  { id: 'ctrl', label: 'Extended', hint: 'Shift+letter → number' },
];
const KEY_CODES = QWERTY_LAYOUT.flatMap(row => row.keys);

export function QuantumKeyboardEditor() {
  const { t, locale } = useI18n();
  const zh = locale !== 'en-US';
  const [selectedKey, setSelectedKey] = useState(() => useQuantumPreferences.getState().selectedKey);
  const [selectedLayer, setSelectedLayer] = useState<QuantumLayerId>(() => useQuantumPreferences.getState().layer);
  const overrides = useQuantumKeymapStore((state) => state.overrides);
  const updateMeaning = useQuantumKeymapStore((state) => state.updateMeaning);
  const resetMeaning = useQuantumKeymapStore((state) => state.resetMeaning);
  const resetKey = useQuantumKeymapStore((state) => state.resetKey);
  const resetAll = useQuantumKeymapStore((state) => state.resetAll);
  const customMappings = useQuantumCustomStore(state => state.customMappings);
  const customSymbols = customMappings[selectedKey]?.customSymbols ?? [];
  const [customLatex, setCustomLatex] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const keySelector = useRef<HTMLDivElement>(null);

  const selectedLetter = KEY_LABELS[selectedKey] ?? selectedKey.replace(/^Key/, '');
  const officialMeanings = useMemo(
    () => getQuantumLayerMeanings(selectedKey, selectedLayer),
    [selectedKey, selectedLayer],
  );
  const effectiveMeanings = useMemo(
    () => getEffectiveQuantumLayerMeanings(selectedKey, selectedLayer, overrides),
    [overrides, selectedKey, selectedLayer],
  );
  const archivedMeanings = useMemo(() => {
    const visibleIds = new Set(officialMeanings.map(meaning => meaning.id));
    return getAllQuantumLayerMeanings(selectedKey, selectedLayer).filter(meaning => !visibleIds.has(meaning.id));
  }, [officialMeanings, selectedKey, selectedLayer]);

  return (
    <section className="rounded-lg border border-border bg-card/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('quantum.keymap.title')}
          </div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            {t('quantum.keymap.description')}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
          onClick={() => { resetAll(); useQuantumCustomStore.getState().resetAll(); }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('quantum.keymap.resetAll')}
        </button>
      </div>

      <div ref={keySelector} className="mt-3 space-y-1.5" role="group" aria-label={zh ? '选择映射按键，按字母或左右箭头切换' : 'Select a key with a letter or left and right arrows'}>
        {QWERTY_LAYOUT.map((row) => (
          <div
            key={row.keys.join('-')}
            className="flex gap-1"
            style={{ paddingLeft: `${row.offset * 1.6}rem` }}
          >
            {row.keys.map((keyCode) => (
              <button
                key={keyCode}
                type="button"
                data-key={keyCode}
                aria-pressed={selectedKey === keyCode}
                tabIndex={selectedKey === keyCode ? 0 : -1}
                className={cn(
                  'h-8 min-w-0 flex-1 rounded-md border px-1 text-xs font-semibold transition-colors',
                  selectedKey === keyCode
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
                onClick={() => { setSelectedKey(keyCode); setCustomLatex(''); setCustomMessage(''); useQuantumPreferences.setState({ selectedKey: keyCode }); }}
                onKeyDown={event => {
                  const index = KEY_CODES.indexOf(keyCode);
                  const letterKey = /^[a-z]$/i.test(event.key) ? `Key${event.key.toUpperCase()}` : null;
                  const next = letterKey ?? (event.key === 'ArrowRight' ? KEY_CODES[(index + 1) % KEY_CODES.length]
                    : event.key === 'ArrowLeft' ? KEY_CODES[(index + KEY_CODES.length - 1) % KEY_CODES.length] : null);
                  if (!next) return;
                  event.preventDefault(); event.stopPropagation();
                  setSelectedKey(next); setCustomLatex(''); setCustomMessage('');
                  useQuantumPreferences.setState({ selectedKey: next });
                  keySelector.current?.querySelector<HTMLButtonElement>(`[data-key="${next}"]`)?.focus();
                }}
              >
                {KEY_LABELS[keyCode] ?? keyCode.replace(/^Key/, '')}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
          {LAYERS.map((layer) => (
            <button
              key={layer.id}
              type="button"
              aria-pressed={selectedLayer === layer.id}
              className={cn(
                'rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
                selectedLayer === layer.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title={zh
                ? layer.id === 'base' ? '字母 → 数字' : 'Shift+字母 → 数字'
                : layer.hint}
              onClick={() => { setSelectedLayer(layer.id); useQuantumPreferences.setState({ layer: layer.id }); }}
            >
              {layer.id === 'base' ? t('quantum.keymap.shiftLayer') : t('quantum.keymap.ctrlLayer')}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
          onClick={() => { resetKey(selectedKey); useQuantumCustomStore.getState().resetKey(selectedKey); }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('quantum.keymap.resetKey', { key: selectedLetter })}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {effectiveMeanings.map((meaning, index) => {
          const official = officialMeanings[index];
          const override = overrides[selectedKey]?.[selectedLayer]?.[meaning.id];
          return (
            <div
              key={meaning.id}
              className="grid gap-2 rounded-md border border-border bg-background/80 p-2 md:grid-cols-[2rem_minmax(8rem,1fr)_minmax(12rem,2fr)_auto]"
            >
              <div className="flex flex-col items-center justify-center gap-1 rounded bg-muted p-1 text-xs text-muted-foreground">
                <span>{index + 1}</span>
                <FormulaPreview latex={meaning.latex} />
              </div>
              <label className="min-w-0">
                <span className="sr-only">{t('quantum.keymap.labelField')}</span>
                <input
                  aria-label={`${selectedLetter} · ${index + 1} · ${t('quantum.keymap.labelField')}`}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  value={override?.label ?? official?.label ?? meaning.label}
                  placeholder={official?.label ?? 'label'}
                  onChange={(event) => { useQuantumPreferences.setState({ mappingSource: 'custom' }); updateMeaning(selectedKey, selectedLayer, meaning.id, { label: event.target.value }); }}
                />
              </label>
              <label className="min-w-0">
                <span className="sr-only">{t('quantum.keymap.latexField')}</span>
                <input
                  aria-label={`${selectedLetter} · ${index + 1} · LaTeX`}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-sm text-foreground"
                  value={override?.latex ?? official?.latex ?? meaning.latex}
                  placeholder={official?.latex ?? '\\alpha'}
                  onChange={(event) => { useQuantumPreferences.setState({ mappingSource: 'custom' }); updateMeaning(selectedKey, selectedLayer, meaning.id, { latex: event.target.value }); }}
                />
              </label>
              <button
                type="button"
                aria-label={`${t('common.reset')} ${selectedLetter} · ${index + 1}`}
                className="h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
                onClick={() => resetMeaning(selectedKey, selectedLayer, meaning.id)}
              >
                {t('common.reset')}
              </button>
            </div>
          );
        })}
      </div>
      {archivedMeanings.length > 0 && <details className="mt-3 space-y-2 border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-semibold">{zh ? '归档含义 · 仅用于查找' : 'Archived meanings · search only'}</summary>
        <p className="text-xs text-muted-foreground">{zh ? '保留原有配置，可在查找、收藏和最近使用中调用，不占用键帽编号。' : 'Existing mappings remain available in search, favorites and recents, without a keycap number.'}</p>
        {archivedMeanings.map(official => {
          const override = overrides[selectedKey]?.[selectedLayer]?.[official.id];
          const meaning = applyQuantumMeaningOverride(official, override);
          return <div key={official.id} className="grid min-w-0 gap-2 rounded-md border border-border bg-background/80 p-2 md:grid-cols-[minmax(8rem,1fr)_minmax(12rem,2fr)_auto]">
            <input aria-label={`${selectedLetter} · ${zh ? '归档' : 'Archived'} ${official.id} · ${t('quantum.keymap.labelField')}`}
              className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs" value={override?.label ?? official.label}
              onChange={event => { useQuantumPreferences.setState({ mappingSource: 'custom' }); updateMeaning(selectedKey, selectedLayer, official.id, { label: event.target.value }); }} />
            <input aria-label={`${selectedLetter} · ${zh ? '归档' : 'Archived'} ${official.id} · LaTeX`}
              className="h-8 min-w-0 rounded-md border border-input bg-background px-2 font-mono text-xs" value={override?.latex ?? official.latex}
              onChange={event => { useQuantumPreferences.setState({ mappingSource: 'custom' }); updateMeaning(selectedKey, selectedLayer, official.id, { latex: event.target.value }); }} />
            <button type="button" className="h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
              aria-label={`${t('common.reset')} ${official.id}`} onClick={() => resetMeaning(selectedKey, selectedLayer, official.id)}>{t('common.reset')}</button>
            <FormulaPreview latex={meaning.latex} />
          </div>;
        })}
      </details>}
      {selectedLayer === 'base' && <div className="mt-3 space-y-2 border-t border-border pt-3">
        {customSymbols.map((latex, index) => <div key={`${selectedKey}:custom:${index}`} className="flex items-center gap-2">
          <span className="w-8 text-center text-xs text-muted-foreground">+{index + 1}</span>
          <FormulaPreview latex={latex} />
          <input className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs"
            aria-label={`${selectedLetter} · ${zh ? '自定义' : 'Custom'} ${index + 1} · LaTeX`} defaultValue={latex}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
            onBlur={event => {
              const replacement = event.target.value.trim();
              const duplicateOfficial = effectiveMeanings.some(meaning => meaning.latex === replacement);
              const duplicateCustom = customSymbols.some((value, candidateIndex) => candidateIndex !== index && value === replacement);
              if (!replacement || duplicateOfficial || duplicateCustom) {
                event.target.value = latex;
                setCustomMessage(zh ? '不能与此键已有候选重复。' : 'The candidate duplicates an existing key meaning.');
                return;
              }
              useQuantumCustomStore.getState().updateCustomSymbol(selectedKey, latex, replacement);
              event.target.value = replacement;
              useQuantumPreferences.setState({ mappingSource: 'custom' });
            }} />
          <button type="button" className="qk-icon" aria-label={`${zh ? '移除' : 'Remove'} ${selectedLetter} · ${zh ? '自定义' : 'Custom'} ${index + 1}`}
            onClick={() => useQuantumCustomStore.getState().removeCustomSymbol(selectedKey, latex)}><Trash2 size={13} /></button>
        </div>)}
        <form className="flex gap-2" aria-label={zh ? `添加 ${selectedLetter} 键候选` : `Add a candidate to ${selectedLetter}`} onSubmit={event => {
          event.preventDefault();
          const value = customLatex.trim();
          if (!value) return;
          if (customSymbols.includes(value) || effectiveMeanings.some(meaning => meaning.latex === value)) {
            setCustomMessage(zh ? '此键已有相同候选。' : 'This key already contains that candidate.'); return;
          }
          useQuantumCustomStore.getState().addCustomSymbol(selectedKey, value);
          useQuantumPreferences.setState({ mappingSource: 'custom' });
          setCustomLatex(''); setCustomMessage(zh ? '候选已添加' : 'Candidate added');
        }}>
          <input className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs" value={customLatex}
            aria-label={zh ? `添加 ${selectedLetter} 键候选 LaTeX` : `New ${selectedLetter} candidate LaTeX`}
            placeholder={zh ? '添加此键的 LaTeX 候选' : 'Add a LaTeX candidate to this key'}
            onChange={event => { setCustomLatex(event.target.value); setCustomMessage(''); }} />
          <button type="submit" disabled={!customLatex.trim()} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted disabled:opacity-50"><Plus size={13} />{zh ? '添加候选' : 'Add candidate'}</button>
        </form>
        {customMessage && <p role="status" className="text-xs text-muted-foreground">{customMessage}</p>}
      </div>}
      <MyFormulasEditor />
    </section>
  );
}
