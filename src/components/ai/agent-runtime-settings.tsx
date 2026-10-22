'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, RefreshCw, Settings2, X } from 'lucide-react';
import { useAiHarnessStore } from '@/stores/ai-harness-store';
import { isTauriHost } from '@/lib/storage-adapter';
import { Portal } from '@/components/ui/portal';
import { UI_LAYER_CLASS } from '@/lib/ui-layers';
import { normalizeHarnessModels } from '@/lib/ai/harness/discovery';
import { useI18n } from '@/hooks/use-i18n';

const ApiSettingsDialog = dynamic(() => import('@/components/settings/settings-dialog').then(module => module.SettingsDialog), { ssr: false });

interface SelectorProps {
  profiles?: Array<{ id: string; name: string }>;
  activeProfileId?: string | null;
  modelOptions?: Array<{ id: string; name: string }>;
  activeModelId?: string;
  onProfileChange?: (id: string) => void;
  onModelChange?: (id: string) => void;
  disabled?: boolean;
}

export function AgentRuntimeSelector({ profiles = [], activeProfileId, modelOptions = [], activeModelId = '', onProfileChange, onModelChange, disabled = false }: SelectorProps) {
  const { t } = useI18n();
  const config = useAiHarnessStore(state => state.config);
  const probes = useAiHarnessStore(state => state.probes);
  const discovering = useAiHarnessStore(state => state.isDiscovering);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const isLocal = config.engine !== 'api';
  const probe = isLocal ? probes[config.engine as 'codex' | 'claude' | 'deepseek'] : undefined;
  const models = isLocal ? normalizeHarnessModels(probe ?? null) : modelOptions;
  const model = isLocal ? config.model ?? '' : activeModelId;
  const unavailable = isLocal && probe && (!probe.installed || !probe.supported);
  const needsLogin = isLocal && probe?.authStatus === 'login-required';
  const selectClass = 'h-7 w-full min-w-0 rounded border border-border/70 bg-background px-1.5 text-[11px] disabled:opacity-50';

  useEffect(() => {
    const state = useAiHarnessStore.getState();
    void state.hydrate().then(() => {
      if (isTauriHost() && !useAiHarnessStore.getState().discoveryComplete) return state.discover();
    }).catch(() => {});
  }, []);

  function changeSource(value: string) {
    const state = useAiHarnessStore.getState();
    if (value === 'api' || value.startsWith('api:')) {
      state.selectEngine('api');
      onProfileChange?.(value.startsWith('api:') ? value.slice(4) : '');
    } else if (value === 'codex' || value === 'claude') {
      state.selectEngine(value);
      if (isTauriHost() && !state.probes[value]) void state.probe(value).catch(() => {});
    }
  }

  return <div className="agent-runtime-selector" data-testid="ai-runtime-selector">
    <label className="agent-runtime-source-field"><span className="sr-only">{t('chat.runtime.source')}</span>
      <select aria-label={t('chat.runtime.source')} title={t('chat.runtime.source')} data-testid="ai-runtime-engine" className={selectClass} disabled={disabled}
        value={isLocal ? config.engine : activeProfileId ? `api:${activeProfileId}` : 'api'} onChange={event => changeSource(event.target.value)}>
        <option value="api">{t(profiles.length ? 'chat.runtime.defaultApi' : 'chat.runtime.configuredApi')}</option>
        {profiles.map(profile => <option key={profile.id} value={`api:${profile.id}`}>{profile.name}</option>)}
        <optgroup label={t('chat.runtime.localAssistants')}>{(['codex', 'claude'] as const).map(engine => <option key={engine} value={engine}>{engine === 'codex' ? 'Codex' : 'Claude Code'}{probes[engine]?.installed === false ? ` · ${t('chat.runtime.notInstalled')}` : probes[engine]?.supported === false ? ` · ${t('chat.runtime.updateRequired')}` : probes[engine]?.authStatus === 'login-required' ? ` · ${t('chat.runtime.notSignedIn')}` : ''}</option>)}</optgroup>
      </select>
    </label>
    <label className="agent-runtime-model-field"><span className="sr-only">{t('chat.runtime.model')}</span>
      <select aria-label={t('chat.runtime.model')} title={t('chat.runtime.model')} data-testid={isLocal ? 'ai-harness-model-select' : 'ai-chat-model-select'} className={selectClass} disabled={disabled}
        value={model} onChange={event => {
          if (isLocal) useAiHarnessStore.getState().setConfig({ ...config, model: event.target.value || undefined });
          else onModelChange?.(event.target.value);
        }}>
        {isLocal ? <option value="">{t('chat.runtime.defaultModel')}</option> : !models.length ? <option value="">{t('chat.runtime.noModel')}</option> : null}
        {model && !models.some(option => option.id === model) ? <option value={model}>{model}</option> : null}
        {models.map(option => <option key={option.id} value={option.id}>{option.name || option.id}</option>)}
      </select>
    </label>
    {discovering ? <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" aria-label={t('chat.runtime.discovering')} /> : null}
    {needsLogin ? <span className="shrink-0 text-[10px] text-amber-600">{t('chat.runtime.notSignedIn')}</span> : null}
    {unavailable && profiles.length ? <button type="button" className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground" disabled={disabled} onClick={() => changeSource(`api:${activeProfileId ?? profiles[0].id}`)}>{t('chat.runtime.switchToApi')}</button> : null}
    <button type="button" title={t('chat.runtime.settings')} aria-label={t('chat.runtime.settings')} aria-haspopup="dialog" disabled={disabled} onClick={() => setSettingsOpen(true)} className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
      <Settings2 className="size-3.5" />
    </button>
    {settingsOpen ? isLocal ? <RuntimeSettingsDialog onClose={closeSettings} /> : <Portal><ApiSettingsDialog isOpen initialTab="ai" onClose={closeSettings} /></Portal> : null}
  </div>;
}

function RuntimeSettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []);
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const controls = focusable(); const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [onClose]);
  return <Portal><div className={`fixed inset-0 flex items-center justify-center bg-black/35 p-4 ${UI_LAYER_CLASS.dialogElevated}`} onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label={t('chat.runtime.settings')} className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-background p-4 text-foreground shadow-xl">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-medium">{t('chat.runtime.settings')}</h2><button type="button" autoFocus aria-label={t('chat.runtime.closeSettings')} className="inline-flex size-7 items-center justify-center rounded hover:bg-accent" onClick={onClose}><X className="size-4" /></button></div>
      <AgentRuntimeSettings embedded />
    </div>
  </div></Portal>;
}

export function AgentRuntimeSettings({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useI18n();
  const config = useAiHarnessStore(state => state.config);
  const probes = useAiHarnessStore(state => state.probes);
  const error = useAiHarnessStore(state => state.error ?? state.discoveryError);
  const loading = useAiHarnessStore(state => state.isLoading || state.isDiscovering);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const result = config.engine === 'api' ? null : probes[config.engine];
  const browse = async () => {
    setBrowseError(null);
    try {
      if (!isTauriHost() || config.engine === 'api') throw new Error(t('chat.runtime.desktopRequired'));
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ title: t('chat.runtime.chooseAssistant'), directory: false, multiple: false, filters: [{ name: t('chat.runtime.executableFilter'), extensions: ['exe'] }] });
      if (typeof selected === 'string') {
        useAiHarnessStore.getState().setConfig({ ...config, executable: selected });
        await useAiHarnessStore.getState().probe(config.engine, selected);
      }
    } catch (cause) { setBrowseError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const field = 'mt-1 w-full rounded border border-border bg-background p-1.5';
  return <div className="space-y-3 text-xs" data-testid="agent-runtime-settings">
    {!embedded ? <h2 className="font-medium">{t('chat.runtime.settings')}</h2> : null}
    {config.engine === 'api' ? null : <>
      <div className="flex items-center justify-between gap-2"><span>{config.engine === 'codex' ? 'Codex' : config.engine === 'claude' ? 'Claude Code' : 'DeepSeek'} · {t(result?.authStatus === 'login-required' ? 'chat.runtime.loginRequired' : result?.supported ? 'chat.runtime.detected' : result?.installed ? 'chat.runtime.incompatible' : 'chat.runtime.notDetected')}</span>
        <button type="button" title={t('chat.runtime.refresh')} aria-label={t('chat.runtime.refresh')} disabled={loading} className="inline-flex size-7 items-center justify-center rounded hover:bg-accent" onClick={() => void useAiHarnessStore.getState().probe().catch(() => {})}><RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      <button type="button" className="rounded border border-border px-3 py-2" disabled={loading} onClick={() => void browse()}>{t('chat.runtime.chooseInstalledApp')}</button>
      {config.executable && result?.installed === false ? <button type="button" className="ml-2 rounded border border-border px-3 py-2" disabled={loading} onClick={() => {
        useAiHarnessStore.getState().setConfig({ ...config, executable: undefined });
        void useAiHarnessStore.getState().probe().catch(() => {});
      }}>{t('chat.runtime.autoFind')}</button> : null}
      {result?.authStatus === 'login-required' ? <p role="status" className="text-amber-600">{t('chat.runtime.loginHint')}</p> : null}
      <details open={result ? undefined : true}><summary className="cursor-pointer text-muted-foreground">{t('chat.runtime.advanced')}</summary>
        <label className="mt-2 block">{t('chat.runtime.location')}<input aria-label={t('chat.runtime.executable')} className={field} value={config.executable ?? ''} placeholder={result?.executable ?? t('chat.runtime.autoDiscover')} onChange={event => useAiHarnessStore.getState().setConfig({ ...config, executable: event.target.value || undefined })} /></label>
        <label className="mt-2 block">{t('chat.runtime.customModel')}<input aria-label={t('chat.runtime.agentModel')} className={field} value={config.model ?? ''} onChange={event => useAiHarnessStore.getState().setConfig({ ...config, model: event.target.value || undefined })} /></label>
        {result ? <div className="mt-2 break-words text-muted-foreground" data-testid="agent-runtime-probe-result">{result.version} · {result.protocol}{result.reason ? <p className="mt-1">{result.reason}</p> : null}</div> : null}
      </details>
    </>}
    {error || browseError ? <p role="alert" className="break-words text-destructive">{browseError ?? error}</p> : null}
  </div>;
}
