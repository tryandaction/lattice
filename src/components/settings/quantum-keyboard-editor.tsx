'use client';

import { RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  KEY_LABELS,
  QWERTY_LAYOUT,
  getQuantumLayerMeanings,
  type QuantumLayerId,
} from '@/config/quantum-keymap';
import {
  getEffectiveQuantumLayerMeanings,
  useQuantumKeymapStore,
} from '@/stores/quantum-keymap-store';
import { cn } from '@/lib/utils';
import { useI18n } from '@/hooks/use-i18n';

const LAYERS: { id: QuantumLayerId; label: string; hint: string }[] = [
  { id: 'base', label: 'Shift layer', hint: 'Shift + number + letter' },
  { id: 'ctrl', label: 'Ctrl layer', hint: 'Ctrl + number + letter' },
];

export function QuantumKeyboardEditor() {
  const { t } = useI18n();
  const [selectedKey, setSelectedKey] = useState('KeyI');
  const [selectedLayer, setSelectedLayer] = useState<QuantumLayerId>('base');
  const overrides = useQuantumKeymapStore((state) => state.overrides);
  const updateMeaning = useQuantumKeymapStore((state) => state.updateMeaning);
  const resetMeaning = useQuantumKeymapStore((state) => state.resetMeaning);
  const resetKey = useQuantumKeymapStore((state) => state.resetKey);
  const resetAll = useQuantumKeymapStore((state) => state.resetAll);

  const selectedLetter = KEY_LABELS[selectedKey] ?? selectedKey.replace(/^Key/, '');
  const officialMeanings = useMemo(
    () => getQuantumLayerMeanings(selectedKey, selectedLayer),
    [selectedKey, selectedLayer],
  );
  const effectiveMeanings = useMemo(
    () => getEffectiveQuantumLayerMeanings(selectedKey, selectedLayer, overrides),
    [overrides, selectedKey, selectedLayer],
  );

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
          onClick={resetAll}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('quantum.keymap.resetAll')}
        </button>
      </div>

      <div className="mt-3 space-y-1.5">
        {QWERTY_LAYOUT.map((row) => (
          <div
            key={row.keys.join('-')}
            className="flex gap-1.5"
            style={{ paddingLeft: `${row.offset * 1.6}rem` }}
          >
            {row.keys.map((keyCode) => (
              <button
                key={keyCode}
                type="button"
                className={cn(
                  'h-8 min-w-10 rounded-md border px-2 text-sm font-semibold transition-colors',
                  selectedKey === keyCode
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
                onClick={() => setSelectedKey(keyCode)}
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
              className={cn(
                'rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
                selectedLayer === layer.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title={layer.hint}
              onClick={() => setSelectedLayer(layer.id)}
            >
              {layer.id === 'base' ? t('quantum.keymap.shiftLayer') : t('quantum.keymap.ctrlLayer')}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
          onClick={() => resetKey(selectedKey)}
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
              <div className="flex h-8 items-center justify-center rounded bg-muted text-xs font-semibold text-muted-foreground">
                {index + 1}
              </div>
              <label className="min-w-0">
                <span className="sr-only">{t('quantum.keymap.labelField')}</span>
                <input
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  value={override?.label ?? official?.label ?? meaning.label}
                  placeholder={official?.label ?? 'label'}
                  onChange={(event) => updateMeaning(selectedKey, selectedLayer, meaning.id, { label: event.target.value })}
                />
              </label>
              <label className="min-w-0">
                <span className="sr-only">{t('quantum.keymap.latexField')}</span>
                <input
                  className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-sm text-foreground"
                  value={override?.latex ?? official?.latex ?? meaning.latex}
                  placeholder={official?.latex ?? '\\alpha'}
                  onChange={(event) => updateMeaning(selectedKey, selectedLayer, meaning.id, { latex: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
                onClick={() => resetMeaning(selectedKey, selectedLayer, meaning.id)}
              >
                {t('common.reset')}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
