import { create } from "zustand";
import { getStorageAdapter } from "@/lib/storage-adapter";
import { AI_PROVIDER_PRESETS, createDefaultAiProviderProfile } from "@/lib/ai/provider-profiles";
import type { AiConnectionChannel, AiModelConfig, AiProviderProfile, AiProtocol, AiProviderId } from "@/lib/ai/types";

const STORAGE_KEY = "lattice-ai-provider-profiles";
const SCHEMA_VERSION = 3;

const LEGACY_GENERATED_CATALOGS: Record<string, string[]> = {
  "openai:openai-chat-completions": ["gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini"],
  "openai:openai-responses": ["gpt-5", "gpt-5-mini", "gpt-4.1"],
  "anthropic:anthropic-messages": ["claude-sonnet-4-5-20250929", "claude-opus-4-6", "claude-3-5-haiku-20241022", "claude-sonnet-4-20250514"],
  "google:gemini-generate-content": ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  "ollama:ollama-native": ["llama3.2", "qwen2.5", "deepseek-r1"],
  "openrouter:openai-chat-completions": ["openai/gpt-4.1-mini", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash"],
  "groq:openai-chat-completions": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen-qwq-32b"],
  "together:openai-chat-completions": ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
  "fireworks:openai-chat-completions": ["accounts/fireworks/models/llama-v3p1-70b-instruct", "accounts/fireworks/models/qwen2p5-72b-instruct"],
  "siliconflow:openai-chat-completions": ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-235B-A22B", "deepseek-ai/DeepSeek-R1"],
  "azure-openai:openai-chat-completions": ["YOUR_DEPLOYMENT"],
};

interface PersistedProfiles {
  version: number;
  profiles: unknown[];
  activeProfileId: string | null;
}

export interface AiProviderProfileState {
  profiles: AiProviderProfile[];
  activeProfileId: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
}

export interface AiProviderProfileActions {
  hydrate: () => Promise<void>;
  loadProfiles: (seed?: AiProviderProfile[]) => Promise<void>;
  retryPersistence: () => Promise<void>;
  addProfile: (profile: AiProviderProfile) => void;
  createProfile: (presetId: string, overrides?: Partial<Pick<AiProviderProfile, "id" | "name" | "model" | "baseUrl">>) => AiProviderProfile;
  updateProfile: (id: string, updates: Partial<Omit<AiProviderProfile, "id">>) => void;
  setModels: (id: string, models: AiModelConfig[]) => void;
  addModel: (id: string, model: AiModelConfig) => void;
  updateModel: (profileId: string, modelId: string, updates: Partial<Omit<AiModelConfig, "id">>) => void;
  removeModel: (profileId: string, modelId: string) => void;
  reconcileRemoteModels: (profileId: string, models: AiModelConfig[]) => void;
  setModelProvider: (profileId: string, provider: AiProviderId) => void;
  setDefaultModel: (profileId: string, modelId: string) => void;
  removeProfile: (id: string) => void;
  setActiveProfile: (id: string | null) => void;
  setDefaultProfile: (id: string) => void;
  getActiveProfile: () => AiProviderProfile | null;
}

export type AiProviderProfileStore = AiProviderProfileState & AiProviderProfileActions;

const protocols = new Set<AiProtocol>([
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
  "gemini-generate-content",
  "ollama-native",
]);

const providers = new Set<AiProviderId>([
  "openai", "anthropic", "google", "ollama", "deepseek", "moonshot", "zhipu",
  "openrouter", "groq", "together", "fireworks", "siliconflow", "azure-openai", "custom",
]);
const authModes = new Set<AiProviderProfile["authMode"]>(["bearer", "api-key", "x-api-key", "query-key", "none"]);
const channels = new Set<AiConnectionChannel>(["official", "custom"]);

function normalizeProfile(value: unknown, options: { migrateLegacyModels?: boolean; clearGeneratedCatalog?: boolean } = {}): AiProviderProfile | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AiProviderProfile>;
  if (
    typeof raw.id !== "string" || !raw.id.trim() ||
    typeof raw.name !== "string" || !raw.name.trim() ||
    typeof raw.provider !== "string" || !providers.has(raw.provider as AiProviderId) ||
    typeof raw.protocol !== "string" || !protocols.has(raw.protocol as AiProtocol) ||
    typeof raw.baseUrl !== "string" ||
    typeof raw.enabled !== "boolean" || typeof raw.isDefault !== "boolean" ||
    typeof raw.authMode !== "string" || !authModes.has(raw.authMode as AiProviderProfile["authMode"]) ||
    typeof raw.timeoutMs !== "number" || !Number.isFinite(raw.timeoutMs) ||
    typeof raw.maxRetries !== "number" || !Number.isFinite(raw.maxRetries) ||
    !raw.customHeaders || typeof raw.customHeaders !== "object" ||
    !raw.privacy || typeof raw.privacy !== "object"
  ) {
    return null;
  }
  const privacy = raw.privacy as AiProviderProfile["privacy"];
  if (!Object.values(privacy).every((value) => typeof value === "boolean")) return null;
  const hasPersistedModels = Array.isArray(raw.models);
  const persistedModelTombstones = Array.isArray(raw.modelTombstones)
    ? raw.modelTombstones.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())
    : [];
  const identityPreset = options.migrateLegacyModels === true
    ? AI_PROVIDER_PRESETS.find((preset) => preset.name === raw.name)
    : null;
  const canonicalProvider = identityPreset?.provider ?? raw.provider as AiProviderId;
  const canonicalProtocol = identityPreset?.protocol ?? raw.protocol as AiProtocol;
  const canonicalAuthMode = identityPreset?.authMode ?? raw.authMode as AiProviderProfile["authMode"];
  // Never synthesize a model catalog from provider presets. Legacy migration
  // may preserve the user's explicitly configured model, but remote catalogs
  // must be fetched or entered manually.
  const legacyCatalogIds = LEGACY_GENERATED_CATALOGS[`${canonicalProvider}:${canonicalProtocol}`];
  const legacyCatalogUntouched = Boolean(
    options.clearGeneratedCatalog &&
    legacyCatalogIds &&
    hasPersistedModels &&
    raw.models!.length === legacyCatalogIds.length &&
    raw.models!.every((value, index) => {
      if (!value || typeof value !== "object") return false;
      const model = value as Partial<AiModelConfig>;
      return model.id === legacyCatalogIds[index] &&
        model.name === model.id &&
        model.contextWindow === 128000 &&
        model.maxOutputTokens === 8192 &&
        model.enabled !== false &&
        model.supportsStreaming !== false;
    })
  );
  const rawModels = legacyCatalogUntouched ? [] : hasPersistedModels ? raw.models! : [];
  const generatedPlaceholderPattern = /^new-model-\d+$/u;
  const generatedPlaceholderIds = [
    ...rawModels
      .filter((value): value is AiModelConfig => Boolean(value && typeof value === "object"))
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string" && generatedPlaceholderPattern.test(id.trim())),
    ...(typeof raw.model === "string" && generatedPlaceholderPattern.test(raw.model.trim()) ? [raw.model.trim()] : []),
  ];
  const modelTombstones = Array.from(new Set([...persistedModelTombstones, ...generatedPlaceholderIds]));
  const userModels = rawModels.filter((value) => {
    if (!value || typeof value !== "object") return false;
    const model = value as Partial<AiModelConfig>;
    return typeof model.id !== "string" || !generatedPlaceholderPattern.test(model.id.trim());
  });
  const seenModelIds = new Set<string>();
  const parseModel = (value: unknown): AiModelConfig | null => {
    if (!value || typeof value !== "object") return null;
    const model = value as Partial<AiModelConfig>;
    if (typeof model.id !== "string" || !model.id.trim() || seenModelIds.has(model.id.trim())) return null;
    seenModelIds.add(model.id.trim());
    return {
      id: model.id.trim(),
      name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : model.id.trim(),
      contextWindow: typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow) ? Math.max(1, Math.round(model.contextWindow)) : 128000,
      maxOutputTokens: typeof model.maxOutputTokens === "number" && Number.isFinite(model.maxOutputTokens) ? Math.max(1, Math.round(model.maxOutputTokens)) : 8192,
      enabled: model.enabled !== false,
      supportsStreaming: model.supportsStreaming !== false,
    };
  };
  const models = userModels.map(parseModel).filter((model): model is AiModelConfig => model !== null);
  if (!legacyCatalogUntouched && options.migrateLegacyModels === true && typeof raw.model === "string" && raw.model.trim() && !generatedPlaceholderPattern.test(raw.model.trim()) && !models.some((model) => model.id === raw.model!.trim())) {
    models.unshift({ id: raw.model.trim(), name: raw.model.trim(), contextWindow: 128000, maxOutputTokens: 8192, enabled: true, supportsStreaming: true });
  }
  const requestedDefault = typeof raw.defaultModelId === "string" ? raw.defaultModelId.trim() : "";
  const defaultModelId = models.some((model) => model.id === requestedDefault)
    ? requestedDefault
    : typeof raw.model === "string" && models.some((model) => model.id === raw.model!.trim())
      ? raw.model!.trim()
      : models[0]?.id ?? null;
  return {
    id: raw.id.trim(),
    name: raw.name.trim(),
    provider: canonicalProvider,
    protocol: canonicalProtocol,
    channel: channels.has(raw.channel as AiConnectionChannel)
      ? raw.channel as AiConnectionChannel
      : canonicalProvider === "custom" ? "custom" : "official",
    baseUrl: raw.baseUrl.trim(),
    model: defaultModelId,
    defaultModelId,
    models,
    ...(modelTombstones.length > 0 ? { modelTombstones: Array.from(new Set(modelTombstones)) } : {}),
    enabled: raw.enabled,
    isDefault: raw.isDefault,
    authMode: canonicalAuthMode,
    organization: typeof raw.organization === "string" ? raw.organization : undefined,
    project: typeof raw.project === "string" ? raw.project : undefined,
    timeoutMs: Math.max(1000, Math.min(300000, Math.round(raw.timeoutMs))),
    firstResponseTimeoutMs: typeof raw.firstResponseTimeoutMs === 'number' && Number.isFinite(raw.firstResponseTimeoutMs) ? Math.max(1000, Math.min(300000, Math.round(raw.firstResponseTimeoutMs))) : 120000,
    maxRequestDurationMs: typeof raw.maxRequestDurationMs === 'number' && Number.isFinite(raw.maxRequestDurationMs) ? Math.max(1000, Math.min(1800000, Math.round(raw.maxRequestDurationMs))) : 600000,
    maxRetries: Math.max(0, Math.min(5, Math.round(raw.maxRetries))),
    customHeaders: Object.fromEntries(Object.entries(raw.customHeaders as Record<string, unknown>).filter(([, value]) => typeof value === "string")) as Record<string, string>,
    privacy: { ...privacy },
  };
}

function normalizeProfiles(value: unknown, options: { migrateLegacyModels?: boolean; clearGeneratedCatalog?: boolean } = {}): AiProviderProfile[] {
  const raw = value && typeof value === "object" && Array.isArray((value as PersistedProfiles).profiles)
    ? (value as PersistedProfiles).profiles
    : Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return raw.map((profile) => normalizeProfile(profile, options)).filter((profile): profile is AiProviderProfile => {
    if (!profile || seen.has(profile.id)) return false;
    seen.add(profile.id);
    return true;
  });
}

function withoutSecret(profile: AiProviderProfile): AiProviderProfile {
  return { ...profile, customHeaders: { ...profile.customHeaders } };
}

export function createAiProviderProfileStore() {
  let idCounter = 0;
  let hydration: Promise<void> | null = null;
  let loaded = false;
  let mutationRevision = 0;
  let dirty = false;
  let retainedInvalidProfiles: unknown[] = [];
  let loadWarning: string | null = null;
  const removedDuringLoad = new Set<string>();
  let persistTail: Promise<void> = Promise.resolve();
  const persist = async (_state: Pick<AiProviderProfileState, "profiles" | "activeProfileId">) => {
    mutationRevision += 1;
    dirty = true;
    if (!loaded && !hydration) void store.getState().loadProfiles();
    const pendingLoad = hydration;
    persistTail = persistTail
      .catch(() => undefined)
      .then(async () => {
        if (pendingLoad) await pendingLoad;
        if (!loaded) return;
        const state = store.getState();
        const revision = mutationRevision;
        const payload: PersistedProfiles = { version: SCHEMA_VERSION, profiles: [...state.profiles.map(withoutSecret), ...retainedInvalidProfiles], activeProfileId: state.activeProfileId };
        const storage = getStorageAdapter();
        await (storage.setStrict ?? storage.set).call(storage, STORAGE_KEY, payload);
        if (mutationRevision === revision) dirty = false;
        store.setState({ error: loadWarning });
      })
      .catch(() => {
        store.setState({ error: 'API 配置尚未保存，原配置仍保留；请重试。' });
      });
    await persistTail;
  };

  const store = create<AiProviderProfileStore>((set, get) => ({
    profiles: [],
    activeProfileId: null,
    isLoading: false,
    isInitialized: false,
    error: null,

    async hydrate() {
      if (!loaded) await get().loadProfiles();
    },
    async retryPersistence() {
      await persist({ profiles: get().profiles, activeProfileId: get().activeProfileId });
    },

    loadProfiles(seed) {
      if (hydration) return hydration;
      const startingRevision = mutationRevision;
      const hadLocalEdits = dirty;
      set({ isLoading: true, error: null });
      const loading = (async () => { try {
        const storage = getStorageAdapter();
        const saved = seed ? { profiles: seed, activeProfileId: seed.find((profile) => profile.isDefault)?.id ?? seed[0]?.id ?? null } : await (storage.getStrict ? storage.getStrict<PersistedProfiles>(STORAGE_KEY) : storage.get<PersistedProfiles>(STORAGE_KEY));
        const savedVersion = saved && typeof saved === "object" && typeof (saved as PersistedProfiles).version === "number"
          ? (saved as PersistedProfiles).version
          : 0;
        const normalization = { migrateLegacyModels: savedVersion < SCHEMA_VERSION, clearGeneratedCatalog: !seed && savedVersion < SCHEMA_VERSION };
        let profiles = normalizeProfiles(saved, normalization);
        const rawProfiles = saved && typeof saved === 'object' && Array.isArray((saved as PersistedProfiles).profiles) ? (saved as PersistedProfiles).profiles : Array.isArray(saved) ? saved : [];
        retainedInvalidProfiles = rawProfiles.filter(profile => !normalizeProfile(profile, normalization));
        loadWarning = retainedInvalidProfiles.length ? String(retainedInvalidProfiles.length) + ' 个连接配置暂时无法解析，原数据已保留。' : null;
        const requestedActive = saved && typeof saved === "object" && typeof (saved as PersistedProfiles).activeProfileId === "string"
          ? (saved as PersistedProfiles).activeProfileId
          : null;
        const editedDuringLoad = mutationRevision !== startingRevision || hadLocalEdits;
        if (editedDuringLoad) {
          const current = get().profiles;
          const currentIds = new Set(current.map(profile => profile.id));
          profiles = [...profiles.filter(profile => !currentIds.has(profile.id) && !removedDuringLoad.has(profile.id)), ...current];
        }
        const preferredActive = editedDuringLoad ? get().activeProfileId ?? requestedActive : requestedActive;
        const activeProfileId = profiles.some((profile) => profile.id === preferredActive)
          ? preferredActive
          : profiles.find((profile) => profile.isDefault)?.id ?? profiles[0]?.id ?? null;
        loaded = true;
        removedDuringLoad.clear();
        set({ profiles, activeProfileId, isInitialized: true, error: loadWarning });
      } catch {
        set({ error: 'API 配置读取失败，原数据未修改，请重试。', isInitialized: true });
      } finally {
        set({ isLoading: false });
      } })();
      hydration = loading;
      return loading.finally(() => { if (hydration === loading) hydration = null; });
    },

    addProfile(profile) {
      const normalized = normalizeProfile(profile);
      if (!normalized || get().profiles.some((candidate) => candidate.id === normalized.id)) return;
      removedDuringLoad.delete(normalized.id);
      const profiles = normalized.isDefault
        ? [...get().profiles.map((candidate) => ({ ...candidate, isDefault: false })), normalized]
        : [...get().profiles, normalized];
      const activeProfileId = get().activeProfileId ?? normalized.id;
      set({ profiles, activeProfileId });
      void persist({ profiles, activeProfileId });
    },

    createProfile(presetId, overrides) {
      idCounter += 1;
      const profile = createDefaultAiProviderProfile(presetId, {
        ...overrides,
        id: overrides?.id ?? `${presetId}-${Date.now()}-${idCounter}`,
      });
      get().addProfile(profile);
      return profile;
    },

    updateProfile(id, updates) {
      const profiles = get().profiles.map((profile) => {
        if (profile.id !== id) return profile;
        const protocolChanged = updates.protocol !== undefined && updates.protocol !== profile.protocol;
        const providerChanged = updates.provider !== undefined && updates.provider !== profile.provider;
        const configurationBoundaryChanged = protocolChanged || providerChanged;
        const effectiveUpdates = configurationBoundaryChanged
          ? { ...updates, models: [], model: null, defaultModelId: null, modelTombstones: [] }
          : updates;
        const nextTombstones = new Set(profile.modelTombstones ?? []);
        if (!protocolChanged && Array.isArray(effectiveUpdates.models)) {
          const nextIds = new Set(effectiveUpdates.models.filter(Boolean).map((model) => model.id));
          profile.models.forEach((model) => {
            if (!nextIds.has(model.id)) nextTombstones.add(model.id);
          });
        }
        return normalizeProfile({
          ...profile,
          ...effectiveUpdates,
          id: profile.id,
          provider: effectiveUpdates.provider ?? profile.provider,
          modelTombstones: configurationBoundaryChanged ? [] : Array.from(nextTombstones),
        }) ?? profile;
      });
      set({ profiles });
      void persist({ profiles, activeProfileId: get().activeProfileId });
    },

    setModels(id, models) {
      const normalized = normalizeProfile({ ...get().profiles.find((profile) => profile.id === id), models });
      if (!normalized) return;
      const profiles = get().profiles.map((profile) => profile.id === id ? normalized : profile);
      set({ profiles });
      void persist({ profiles, activeProfileId: get().activeProfileId });
    },

    addModel(id, model) {
      const profile = get().profiles.find((candidate) => candidate.id === id);
      if (!profile || profile.models.some((candidate) => candidate.id === model.id)) return;
      get().updateProfile(id, {
        models: [...profile.models, model],
        modelTombstones: (profile.modelTombstones ?? []).filter((tombstone) => tombstone !== model.id),
      });
    },

    updateModel(profileId, modelId, updates) {
      const profile = get().profiles.find((candidate) => candidate.id === profileId);
      if (!profile) return;
      get().setModels(profileId, profile.models.map((model) => model.id === modelId ? { ...model, ...updates } : model));
    },

    removeModel(profileId, modelId) {
      const profile = get().profiles.find((candidate) => candidate.id === profileId);
      if (!profile) return;
      const models = profile.models.filter((model) => model.id !== modelId);
      const defaultModelId = models.some((model) => model.id === profile.defaultModelId)
        ? profile.defaultModelId
        : models[0]?.id ?? null;
      get().updateProfile(profileId, {
        models,
        modelTombstones: Array.from(new Set([...(profile.modelTombstones ?? []), modelId])),
        defaultModelId,
        model: defaultModelId,
      });
    },

    reconcileRemoteModels(profileId, remoteModels) {
      const profile = get().profiles.find((candidate) => candidate.id === profileId);
      if (!profile) return;
      const tombstones = new Set(profile.modelTombstones ?? []);
      const byId = new Map(profile.models.map((model) => [model.id, model]));
      remoteModels.forEach((model) => {
        if (!tombstones.has(model.id) && !byId.has(model.id)) byId.set(model.id, model);
      });
      get().updateProfile(profileId, { models: Array.from(byId.values()) });
    },

    setModelProvider(profileId, provider) {
      const profile = get().profiles.find((candidate) => candidate.id === profileId);
      if (!profile || !providers.has(provider)) return;
      if (profile.provider === provider) return;
      get().updateProfile(profileId, { provider });
    },

    setDefaultModel(profileId, modelId) {
      const profile = get().profiles.find((candidate) => candidate.id === profileId);
      if (!profile || !profile.models.some((model) => model.id === modelId)) return;
      get().updateProfile(profileId, { defaultModelId: modelId, model: modelId });
    },

    removeProfile(id) {
      if (hydration) removedDuringLoad.add(id);
      const profiles = get().profiles.filter((profile) => profile.id !== id);
      const activeProfileId = get().activeProfileId === id ? (profiles[0]?.id ?? null) : get().activeProfileId;
      set({ profiles, activeProfileId });
      void persist({ profiles, activeProfileId });
    },

    setActiveProfile(id) {
      const activeProfileId = id && get().profiles.some((profile) => profile.id === id) ? id : null;
      set({ activeProfileId });
      void persist({ profiles: get().profiles, activeProfileId });
    },

    setDefaultProfile(id) {
      if (!get().profiles.some((profile) => profile.id === id)) return;
      const profiles = get().profiles.map((profile) => ({ ...profile, isDefault: profile.id === id }));
      set({ profiles, activeProfileId: id });
      void persist({ profiles, activeProfileId: id });
    },

    getActiveProfile() {
      return get().profiles.find((profile) => profile.id === get().activeProfileId) ?? null;
    },
  }));
  return store;
}

export const useAiProviderProfileStore = createAiProviderProfileStore();
