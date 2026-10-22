"use client";

import { useI18n } from "@/hooks/use-i18n";
import type { TranslationKey } from "@/lib/i18n";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Plus, RefreshCw, Server, Trash2, X } from "lucide-react";
import type { AiConnectionChannel, AiConnectionTestResult, AiModel, AiModelConfig, AiProviderId, AiProviderProfile } from "@/lib/ai/types";
import { AI_PROVIDER_PRESETS } from "@/lib/ai/provider-profiles";
import { clearProfileApiKey, loadProfileApiKey, setProfileApiKey } from "@/lib/ai/key-storage";

const PROTOCOL_OPTIONS: Array<{ value: AiProviderProfile["protocol"]; label: string; authMode: AiProviderProfile["authMode"] }> = [
  { value: "openai-chat-completions", label: "OpenAI Chat Completions", authMode: "bearer" },
  { value: "openai-responses", label: "OpenAI Responses", authMode: "bearer" },
  { value: "anthropic-messages", label: "Anthropic Messages", authMode: "x-api-key" },
  { value: "gemini-generate-content", label: "Google Gemini", authMode: "api-key" },
  { value: "ollama-native", label: "Ollama Native", authMode: "none" },
];

const MODEL_PROVIDER_OPTIONS: Array<{ value: AiProviderId; label: string }> = [
  { value: "custom", label: "Not specified / Custom" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic / Claude" },
  { value: "google", label: "Google / Gemini" },
  { value: "ollama", label: "Ollama / Local" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "moonshot", label: "Moonshot / Kimi" },
  { value: "zhipu", label: "Zhipu / GLM" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "groq", label: "Groq" },
  { value: "together", label: "Together AI" },
  { value: "fireworks", label: "Fireworks AI" },
  { value: "siliconflow", label: "SiliconFlow" },
  { value: "azure-openai", label: "Azure OpenAI" },
];

function profileConnectionIdentity(profile: Pick<AiProviderProfile, "provider" | "protocol" | "channel" | "baseUrl">): string {
  return [profile.provider, profile.protocol, profile.channel ?? "", profile.baseUrl.trim()].join("\u001f");
}

interface AiProviderProfilesPanelProps {
  persistenceError?: string | null;
  retryPersistence?: () => Promise<void>;
  profiles: AiProviderProfile[];
  activeProfileId: string | null;
  createProfile: (presetId: string, overrides?: Partial<Pick<AiProviderProfile, "id" | "name" | "model" | "baseUrl">>) => AiProviderProfile;
  setActiveProfile: (id: string | null) => void;
  setDefaultProfile: (id: string) => void;
  updateProfile: (id: string, updates: Partial<Omit<AiProviderProfile, "id">>) => void;
  removeModel?: (profileId: string, modelId: string) => void;
  reconcileRemoteModels?: (profileId: string, models: AiModelConfig[]) => void;
  setModelProvider?: (profileId: string, provider: AiProviderId) => void;
  removeProfile: (id: string) => void;
  testProfile: (profile: AiProviderProfile) => Promise<AiConnectionTestResult>;
  refreshModels: (profile: AiProviderProfile) => Promise<AiModel[]>;
}

export function AiProviderProfilesPanel({ profiles, activeProfileId, createProfile, setActiveProfile, setDefaultProfile, updateProfile, removeProfile, removeModel, reconcileRemoteModels, setModelProvider, testProfile, refreshModels, persistenceError, retryPersistence }: AiProviderProfilesPanelProps) {
  const { t } = useI18n();
  const [selectedPreset, setSelectedPreset] = useState(AI_PROVIDER_PRESETS[0]?.id ?? "custom-openai-compatible");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [resultById, setResultById] = useState<Record<string, AiConnectionTestResult>>({});
  const [modelsById, setModelsById] = useState<Record<string, { identity: string; models: AiModel[] }>>({});
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshErrorById, setRefreshErrorById] = useState<Record<string, string>>({});
  const [keysById, setKeysById] = useState<Record<string, string>>({});
  const [keyErrorsById, setKeyErrorsById] = useState<Record<string, TranslationKey | "">>({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  const keySaveSequence = useRef<Record<string, number>>({});
  const [addingModelProfileId, setAddingModelProfileId] = useState<string | null>(null);
  const [newModelIdByProfile, setNewModelIdByProfile] = useState<Record<string, string>>({});
  const [modelAddErrorById, setModelAddErrorById] = useState<Record<string, TranslationKey>>({});
  const profilesRef = useRef(profiles);
  const refreshSequenceRef = useRef<Record<string, number>>({});
  profilesRef.current = profiles;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;

  const loadProfileKey = async (profileId: string) => {
    const sequence = keySaveSequence.current[profileId] ?? 0;
    try {
      const key = await loadProfileApiKey(profileId);
      // A late read must not replace a value the user has already started editing.
      setKeysById((current) => profileId in current ? current : { ...current, [profileId]: key });
      if ((keySaveSequence.current[profileId] ?? 0) === sequence) setKeyErrorsById(current => ({ ...current, [profileId]: '' }));
    } catch {
      if ((keySaveSequence.current[profileId] ?? 0) === sequence) setKeyErrorsById(current => ({ ...current, [profileId]: "settings.aiProfiles.keyLoadFailed" }));
    }
  };

  const saveProfileKey = async (profileId: string, value: string) => {
    const sequence = (keySaveSequence.current[profileId] ?? 0) + 1;
    keySaveSequence.current[profileId] = sequence;
    setKeysById(current => ({ ...current, [profileId]: value }));
    setKeyErrorsById(current => ({ ...current, [profileId]: '' }));
    setSavingKeys(current => ({ ...current, [profileId]: true }));
    try {
      if (value) await setProfileApiKey(profileId, value);
      else await clearProfileApiKey(profileId);
    } catch {
      if (keySaveSequence.current[profileId] === sequence) {
        setKeyErrorsById(current => ({ ...current, [profileId]: "settings.aiProfiles.keySaveFailed" }));
      }
    } finally {
      if (keySaveSequence.current[profileId] === sequence) setSavingKeys(current => ({ ...current, [profileId]: false }));
    }
  };

  useEffect(() => {
    if (activeProfile && !(activeProfile.id in keysById)) {
      void loadProfileKey(activeProfile.id);
    }
  }, [activeProfile, keysById]);

  const runTest = async (profile: AiProviderProfile) => {
    setTestingId(profile.id);
    try {
      const result = await testProfile(profile);
      setResultById((current) => ({ ...current, [profile.id]: result }));
    } catch (error) {
      setResultById((current) => ({
        ...current,
        [profile.id]: {
          ok: false,
          code: "unknown",
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const runRefreshModels = async (profile: AiProviderProfile) => {
    const requestSequence = (refreshSequenceRef.current[profile.id] ?? 0) + 1;
    refreshSequenceRef.current[profile.id] = requestSequence;
    const refreshIdentity = profileConnectionIdentity(profile);
    const isCurrentRefresh = () => {
      const current = profilesRef.current.find((candidate) => candidate.id === profile.id);
      return Boolean(
        refreshSequenceRef.current[profile.id] === requestSequence
          && current
          && profileConnectionIdentity(current) === refreshIdentity,
      );
    };
    setRefreshingId(profile.id);
    setRefreshErrorById((current) => {
      const next = { ...current };
      delete next[profile.id];
      return next;
    });
    try {
      const models = await refreshModels(profile);
      if (!isCurrentRefresh()) {
        return;
      }
      setModelsById((current) => ({ ...current, [profile.id]: { identity: refreshIdentity, models } }));
      if (models.length > 0) {
        const existing = profile.models ?? [];
        const byId = new Map(existing.map((model) => [model.id, model]));
        models.forEach((model) => {
          const current = byId.get(model.id);
          byId.set(model.id, current ?? {
            id: model.id,
            name: model.name || model.id,
            contextWindow: model.contextWindow,
            maxOutputTokens: 8192,
            enabled: true,
            supportsStreaming: model.supportsStreaming,
          });
        });
        const nextModels = Array.from(byId.values());
        if (reconcileRemoteModels) {
          reconcileRemoteModels(profile.id, models.map((model) => ({
            id: model.id,
            name: model.name || model.id,
            contextWindow: model.contextWindow,
            maxOutputTokens: 8192,
            enabled: true,
            supportsStreaming: model.supportsStreaming,
          })));
        } else {
          updateProfile(profile.id, { models: nextModels });
        }
      }
    } catch (error) {
      if (!isCurrentRefresh()) {
        return;
      }
      setRefreshErrorById((current) => ({
        ...current,
        [profile.id]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (refreshSequenceRef.current[profile.id] === requestSequence) {
        setRefreshingId(null);
      }
    }
  };

  const submitNewModel = (profile: AiProviderProfile) => {
    const modelId = (newModelIdByProfile[profile.id] ?? "").trim();
    const existingModels = profile.models ?? [];
    if (!modelId) {
      setModelAddErrorById((current) => ({ ...current, [profile.id]: "settings.aiProfiles.modelIdRequired" }));
      return;
    }
    if (existingModels.some((model) => model.id === modelId)) {
      setModelAddErrorById((current) => ({ ...current, [profile.id]: "settings.aiProfiles.modelExists" }));
      return;
    }

    const currentDefault = profile.defaultModelId ?? profile.model;
    const hasCurrentDefault = Boolean(currentDefault && existingModels.some((model) => model.id === currentDefault));
    const nextModel: AiModelConfig = {
      id: modelId,
      name: modelId,
      contextWindow: 128000,
      maxOutputTokens: 8192,
      enabled: true,
      supportsStreaming: true,
    };
    updateProfile(profile.id, {
      models: [...existingModels, nextModel],
      defaultModelId: hasCurrentDefault ? currentDefault : modelId,
      model: hasCurrentDefault ? currentDefault : modelId,
    });
    setNewModelIdByProfile((current) => ({ ...current, [profile.id]: "" }));
    setModelAddErrorById((current) => {
      const next = { ...current };
      delete next[profile.id];
      return next;
    });
    setAddingModelProfileId(null);
  };

  return (
    <div className="space-y-4" data-testid="ai-provider-profiles-panel">
      {persistenceError ? <div role="alert" className="rounded-md border border-destructive/30 p-2 text-xs text-destructive">
        {persistenceError}
        {retryPersistence ? <button type="button" className="ml-2 underline" onClick={() => void retryPersistence()}>{t("settings.aiProfiles.retrySave")}</button> : null}
      </div> : null}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{t("settings.aiProfiles.title")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.aiProfiles.description")}</p>
          </div>
          <Server className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-3 flex gap-2">
          <select aria-label={t("settings.aiProfiles.template")} value={selectedPreset} onChange={(event) => setSelectedPreset(event.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm">
            {AI_PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.id === "custom-openai-compatible" ? t("settings.aiProfiles.presetCustomOpenAi") : preset.id === "custom-anthropic-messages" ? t("settings.aiProfiles.presetCustomAnthropic") : preset.id === "ollama-native" ? t("settings.aiProfiles.presetOllama") : preset.name}</option>)}
          </select>
          <button type="button" aria-label={t("settings.aiProfiles.add")} onClick={() => { const profile = createProfile(selectedPreset); setActiveProfile(profile.id); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent"><Plus className="h-3.5 w-3.5" /> {t("settings.aiProfiles.add")}</button>
        </div>
      </div>

      {profiles.length === 0 ? <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{t("settings.aiProfiles.empty")}</div> : <div className="space-y-2">
        {profiles.map((profile) => {
          const result = resultById[profile.id];
          const keyError = keyErrorsById[profile.id];
          const profileModels = modelsById[profile.id];
          const models = profileModels?.identity === profileConnectionIdentity(profile) ? profileModels.models : [];
          return <div key={profile.id} className={`rounded-lg border p-3 ${profile.id === activeProfileId ? "border-primary/50 bg-primary/5" : "border-border"}`}>
            <div className="flex items-start gap-2">
              <button type="button" onClick={() => setActiveProfile(profile.id)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{profile.name}</span>{profile.isDefault ? <span className="shrink-0 text-[10px] font-normal text-muted-foreground">{t("settings.aiProfiles.default")}</span> : null}</div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">{profile.protocol} · {profile.baseUrl}</div>
              </button>
              <button type="button" title={profile.isDefault ? t("settings.aiProfiles.defaultConnection") : t("settings.aiProfiles.setDefault")} aria-label={t("settings.aiProfiles.setDefaultFor", { name: profile.name })} onClick={() => setDefaultProfile(profile.id)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Check className="h-3.5 w-3.5" /></button>
              <button type="button" title={t("settings.aiProfiles.duplicate")} aria-label={t("settings.aiProfiles.duplicateFor", { name: profile.name })} onClick={() => { const preset = AI_PROVIDER_PRESETS.find((candidate) => candidate.provider === profile.provider && candidate.protocol === profile.protocol) ?? AI_PROVIDER_PRESETS.find((candidate) => candidate.provider === profile.provider) ?? AI_PROVIDER_PRESETS[0]!; const copy = createProfile(preset.id, { name: t("settings.aiProfiles.copyName", { name: profile.name }), model: profile.model, baseUrl: profile.baseUrl }); setActiveProfile(copy.id); }} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
              <button type="button" title={t("settings.aiProfiles.delete")} aria-label={t("settings.aiProfiles.deleteFor", { name: profile.name })} onClick={() => removeProfile(profile.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            {profile.id === activeProfileId ? <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.vendor")}<select aria-label={t("settings.aiProfiles.vendor")} value={profile.provider} onChange={(event) => { const provider = event.target.value as AiProviderId; if (setModelProvider) setModelProvider(profile.id, provider); else updateProfile(profile.id, { provider }); }} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">{MODEL_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === "custom" ? t("settings.aiProfiles.vendorCustom") : option.value === "ollama" ? t("settings.aiProfiles.vendorOllama") : option.label}</option>)}</select></label>
                <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.channel")}<select aria-label={t("settings.aiProfiles.channel")} value={profile.channel ?? (profile.provider === "custom" ? "custom" : "official")} onChange={(event) => updateProfile(profile.id, { channel: event.target.value as AiConnectionChannel })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"><option value="official">{t("settings.aiProfiles.officialApi")}</option><option value="custom">{t("settings.aiProfiles.customEndpoint")}</option></select></label>
                <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.protocol")}<select aria-label={t("settings.aiProfiles.protocol")} value={profile.protocol} onChange={(event) => { const option = PROTOCOL_OPTIONS.find((candidate) => candidate.value === event.target.value); if (option) updateProfile(profile.id, { protocol: option.value, authMode: option.authMode, models: [], model: null, defaultModelId: null, modelTombstones: [] }); }} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">{PROTOCOL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === "ollama-native" ? t("settings.aiProfiles.ollamaNative") : option.label}</option>)}</select></label>
                {profile.authMode !== "none" ? <div className="grid gap-1">
                  <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.apiKey")}
                    <input type="password" value={keysById[profile.id] ?? ""} onFocus={() => { if (!(profile.id in keysById)) void loadProfileKey(profile.id); }} onChange={event => void saveProfileKey(profile.id, event.target.value)} placeholder={t("settings.aiProfiles.keyPlaceholder")} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono" autoComplete="off" />
                  </label>
                  {savingKeys[profile.id] ? <span role="status" className="text-[11px] text-muted-foreground">{t("settings.aiProfiles.savingKey")}</span> : null}
                  {keyError ? <div role="alert" className="text-[11px] text-destructive">{t(keyError)} <button type="button" className="underline" onClick={() => void (profile.id in keysById ? saveProfileKey(profile.id, keysById[profile.id]) : loadProfileKey(profile.id))}>{t("settings.aiProfiles.retry")}</button></div> : null}
                </div> : null}
                <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.baseUrl")}<input type="url" value={profile.baseUrl} onChange={(event) => updateProfile(profile.id, { baseUrl: event.target.value })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" /></label>
              </div>
              <div className="rounded-md border border-border/70 bg-muted/10 p-2.5" data-testid={`model-catalog-${profile.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-foreground">{t("settings.aiProfiles.models")}</div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t("settings.aiProfiles.modelsHint")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(profile.models ?? []).length > 0 ? (
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="sr-only">{t("settings.aiProfiles.defaultModel")}</span>
                        <select
                          aria-label={t("settings.aiProfiles.defaultModel")}
                          value={profile.defaultModelId ?? profile.model ?? profile.models[0]?.id ?? ""}
                          onChange={(event) => updateProfile(profile.id, { defaultModelId: event.target.value, model: event.target.value })}
                          className="max-w-[14rem] rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                        >
                          {(profile.models ?? []).map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
                        </select>
                      </label>
                    ) : null}
                    <button
                      type="button"
                      aria-label={t("settings.aiProfiles.addModel")}
                      aria-expanded={addingModelProfileId === profile.id}
                      onClick={() => {
                        setAddingModelProfileId((current) => current === profile.id ? null : profile.id);
                        setModelAddErrorById((current) => {
                          const next = { ...current };
                          delete next[profile.id];
                          return next;
                        });
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                    ><Plus className="h-3.5 w-3.5" /> {t("settings.aiProfiles.addModel")}</button>
                  </div>
                </div>
                {addingModelProfileId === profile.id ? (
                  <form
                    className="mt-2 flex items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitNewModel(profile);
                    }}
                  >
                    <label className="grid min-w-0 flex-1 gap-1 text-[11px] text-muted-foreground">
                      {t("settings.aiProfiles.modelId")}
                      <input
                        aria-label={t("settings.aiProfiles.newModelId")}
                        type="text"
                        autoFocus
                        value={newModelIdByProfile[profile.id] ?? ""}
                        onChange={(event) => setNewModelIdByProfile((current) => ({ ...current, [profile.id]: event.target.value }))}
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono text-foreground"
                      />
                    </label>
                    <button type="submit" aria-label={t("settings.aiProfiles.confirmModel")} title={t("settings.aiProfiles.addModel")} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border hover:bg-accent"><Check className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label={t("settings.aiProfiles.cancelModel")} title={t("common.cancel")} onClick={() => setAddingModelProfileId(null)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
                  </form>
                ) : null}
                {modelAddErrorById[profile.id] ? <div className="mt-1 text-[11px] text-destructive" role="alert">{t(modelAddErrorById[profile.id])}</div> : null}
                {(profile.models ?? []).length === 0 ? <div className="mt-2 rounded border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">{t("settings.aiProfiles.emptyModels")}</div> : <div className="mt-2 space-y-2">
                  {(profile.models ?? []).map((model) => {
                    const isDefault = profile.defaultModelId === model.id || (!profile.defaultModelId && profile.model === model.id);
                    return <div key={model.id} className="rounded-md border border-border/70 bg-background p-2">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate text-xs font-medium">{model.name || model.id}</div>
                        {isDefault ? <span className="text-[10px] text-muted-foreground">{t("settings.aiProfiles.default")}</span> : null}
                        <button type="button" title={t("settings.aiProfiles.deleteModel")} aria-label={t("settings.aiProfiles.deleteModelFor", { model: model.id })} onClick={() => { const next = (profile.models ?? []).filter((candidate) => candidate.id !== model.id); if (removeModel) removeModel(profile.id, model.id); else updateProfile(profile.id, { models: next, defaultModelId: next.some((candidate) => candidate.id === profile.defaultModelId) ? profile.defaultModelId : next[0]?.id ?? null, model: next[0]?.id ?? null }); }} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.modelId")}<input aria-label={t("settings.aiProfiles.modelIdFor", { model: model.id })} type="text" value={model.id} onChange={(event) => { const id = event.target.value; if (!id.trim()) return; const next = (profile.models ?? []).map((candidate) => candidate.id === model.id ? { ...candidate, id, name: candidate.name === model.id ? id : candidate.name } : candidate); updateProfile(profile.id, { models: next, defaultModelId: profile.defaultModelId === model.id ? id : profile.defaultModelId, model: profile.model === model.id ? id : profile.model }); }} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono" /></label>
                        <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.displayName")}<input aria-label={t("settings.aiProfiles.modelNameFor", { model: model.id })} type="text" value={model.name} onChange={(event) => updateProfile(profile.id, { models: (profile.models ?? []).map((candidate) => candidate.id === model.id ? { ...candidate, name: event.target.value } : candidate) })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" /></label>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-muted-foreground">{t("settings.aiProfiles.modelLimits")}</summary>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.contextWindow")}<input aria-label={t("settings.aiProfiles.contextWindowFor", { model: model.id })} type="number" min={1} value={model.contextWindow} onChange={(event) => updateProfile(profile.id, { models: (profile.models ?? []).map((candidate) => candidate.id === model.id ? { ...candidate, contextWindow: Math.max(1, Number(event.target.value) || 1) } : candidate) })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" /></label>
                          <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.maxOutputTokens")}<input aria-label={t("settings.aiProfiles.maxOutputTokensFor", { model: model.id })} type="number" min={1} value={model.maxOutputTokens} onChange={(event) => updateProfile(profile.id, { models: (profile.models ?? []).map((candidate) => candidate.id === model.id ? { ...candidate, maxOutputTokens: Math.max(1, Number(event.target.value) || 1) } : candidate) })} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" /></label>
                        </div>
                      </details>
                    </div>;
                  })}
                </div>}
              </div>
              <details className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
                <summary className="cursor-pointer text-xs font-medium text-foreground">{t("settings.aiProfiles.advanced")}</summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.idleTimeout")}<input type="number" min={1000} max={300000} defaultValue={profile.timeoutMs} key={profile.id + '-idle-' + profile.timeoutMs} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateProfile(profile.id, { timeoutMs: Math.max(1000, Math.min(300000, Math.round(value))) }); }} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" /></label>
                  <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.firstResponse")}<input type="number" min={1000} max={300000} defaultValue={profile.firstResponseTimeoutMs ?? 120000} key={profile.id + '-first-' + profile.firstResponseTimeoutMs} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateProfile(profile.id, { firstResponseTimeoutMs: Math.max(1000, Math.min(300000, Math.round(value))) }); }} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" /></label>
                  <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.requestBudget")}<input type="number" min={1000} max={1800000} defaultValue={profile.maxRequestDurationMs ?? 600000} key={profile.id + '-total-' + profile.maxRequestDurationMs} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateProfile(profile.id, { maxRequestDurationMs: Math.max(1000, Math.min(1800000, Math.round(value))) }); }} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" /></label>
                  <label className="grid gap-1 text-[11px] text-muted-foreground">{t("settings.aiProfiles.retries")}<input type="number" min={0} max={5} value={profile.maxRetries} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateProfile(profile.id, { maxRetries: Math.max(0, Math.min(5, Math.round(value))) }); }} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" /></label>
                </div>
              </details>
              <div className="flex flex-wrap items-center gap-2">
              <button type="button" aria-label={t("settings.aiProfiles.test")} disabled={testingId === profile.id || savingKeys[profile.id] || Boolean(keyErrorsById[profile.id])} onClick={() => void runTest(profile)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50">{testingId === profile.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t("settings.aiProfiles.test")}</button>
                  <button type="button" aria-label={t("settings.aiProfiles.fetchModels")} disabled={refreshingId === profile.id || savingKeys[profile.id] || Boolean(keyErrorsById[profile.id])} onClick={() => void runRefreshModels(profile)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${refreshingId === profile.id ? "animate-spin" : ""}`} /> {t("settings.aiProfiles.fetchModels")}</button>
              {result ? <span className={result.ok ? "text-xs text-emerald-600" : "text-xs text-destructive"}>{result.message}{result.latencyMs ? ` (${result.latencyMs} ms)` : ""}</span> : null}
              {refreshErrorById[profile.id] ? <span data-testid={`model-catalog-error-${profile.id}`} className="w-full text-xs text-destructive">{t("settings.aiProfiles.discoveryFailed", { error: refreshErrorById[profile.id] })}</span> : null}
              {models.length > 0 ? <span className="w-full text-xs text-muted-foreground">{t("settings.aiProfiles.modelSummary", { count: models.length, models: models.slice(0, 5).map((model) => model.id).join(", ") })}</span> : null}
              </div>
            </div> : null}
          </div>;
        })}
      </div>}
      {activeProfile ? <p className="text-[11px] text-muted-foreground">{t("settings.aiProfiles.activeProfile", { name: activeProfile.name })}</p> : null}
    </div>
  );
}
