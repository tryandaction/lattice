import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAiProviderProfile } from "@/lib/ai/provider-profiles";
import type { AiProviderProfile } from "@/lib/ai/types";

const storage = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/storage-adapter", () => ({
  getStorageAdapter: () => storage,
}));

import { createAiProviderProfileStore } from "../ai-provider-profile-store";

describe("AI provider profile store", () => {
  it('preserves a current-version custom protocol instead of resetting it from the preset label', async () => {
    const profile = { ...createDefaultAiProviderProfile('custom-anthropic', { id: 'user-edited' }), name: 'Custom (Anthropic Messages)', protocol: 'openai-responses' as const, authMode: 'bearer' as const };
    storage.get.mockResolvedValue({ version: 3, profiles: [profile], activeProfileId: profile.id });
    const store = createAiProviderProfileStore();
    await store.getState().hydrate();
    expect(store.getState().profiles[0].protocol).toBe('openai-responses');
    expect(store.getState().profiles[0].authMode).toBe('bearer');
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('shares concurrent hydration and preserves edits made while a read is pending', async () => {
    const previous = createDefaultAiProviderProfile('openrouter', { id: 'stored' });
    let finish!: (value: unknown) => void;
    storage.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const store = createAiProviderProfileStore();
    const first = store.getState().hydrate(); const second = store.getState().hydrate();
    const added = createDefaultAiProviderProfile('ollama-native', { id: 'added-during-load' });
    store.getState().addProfile(added);
    await Promise.resolve();
    expect(storage.get).toHaveBeenCalledOnce();
    expect(storage.set).not.toHaveBeenCalled();
    finish({ version: 3, profiles: [previous], activeProfileId: previous.id });
    await Promise.all([first, second]);
    expect(store.getState().profiles.map(profile => profile.id)).toEqual(['stored', 'added-during-load']);
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledWith('lattice-ai-provider-profiles', expect.objectContaining({ profiles: expect.arrayContaining([expect.objectContaining({ id: 'stored' }), expect.objectContaining({ id: 'added-during-load' })]) })));
  });

  it('never saves an empty configuration when persistent reading fails', async () => {
    storage.get.mockRejectedValueOnce(new Error('synthetic read failure'));
    const store = createAiProviderProfileStore();
    await store.getState().hydrate();
    expect(store.getState().error).toBeTruthy();
    expect(storage.set).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    storage.get.mockResolvedValue(null);
    storage.set.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates, selects and persists independent profiles", async () => {
    const store = createAiProviderProfileStore();
    const first = createDefaultAiProviderProfile("openrouter", { id: "profile-a", isDefault: true });
    const second = createDefaultAiProviderProfile("ollama-native", { id: "profile-b" });

    await store.getState().loadProfiles([first]);
    store.getState().addProfile(second);
    store.getState().setActiveProfile("profile-b");
    store.getState().setDefaultProfile("profile-b");

    expect(store.getState().profiles).toHaveLength(2);
    expect(store.getState().activeProfileId).toBe("profile-b");
    expect(store.getState().profiles.find((profile) => profile.id === "profile-b")?.isDefault).toBe(true);
    expect(store.getState().profiles.find((profile) => profile.id === "profile-a")?.isDefault).toBe(false);
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledWith("lattice-ai-provider-profiles", expect.anything()));
  });

  it("normalizes persisted profiles and drops malformed entries", async () => {
    storage.get.mockResolvedValue({
      version: 1,
      profiles: [
        createDefaultAiProviderProfile("openai-responses", { id: "valid" }),
        { id: "broken", protocol: "unknown" },
      ],
      activeProfileId: "valid",
    });
    const store = createAiProviderProfileStore();

    await store.getState().hydrate();

    expect(store.getState().profiles.map((profile) => profile.id)).toEqual(["valid"]);
    expect(store.getState().activeProfileId).toBe("valid");
  });

  it("migrates a legacy single model into a persistent catalog and supports default model changes", async () => {
    const legacy = createDefaultAiProviderProfile("anthropic", { id: "legacy", model: "claude-sonnet-4-5-20250929" });
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([legacy]);

    const profile = store.getState().profiles[0]!;
    expect(profile.models.length).toBe(1);
    expect(profile.defaultModelId).toBe("claude-sonnet-4-5-20250929");

    store.getState().addModel("legacy", { id: "claude-haiku", name: "Claude Haiku", contextWindow: 200000, maxOutputTokens: 8192, enabled: true });
    store.getState().setDefaultModel("legacy", "claude-haiku");

    expect(store.getState().getActiveProfile()?.defaultModelId).toBe("claude-haiku");
    expect(store.getState().getActiveProfile()?.model).toBe("claude-haiku");
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledWith("lattice-ai-provider-profiles", expect.objectContaining({ profiles: expect.any(Array) })));
  });

  it("does not invent a model catalog when loading an older profile without a models field", async () => {
    const legacy = { ...createDefaultAiProviderProfile("anthropic", { id: "old-anthropic" }) } as Record<string, unknown>;
    delete legacy.models;
    delete legacy.defaultModelId;
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([legacy as never]);

    expect(store.getState().profiles[0]?.models).toEqual([]);
  });

  it("removes old generated placeholder models during hydration and does not resurrect them", async () => {
    const legacy = createDefaultAiProviderProfile("custom-openai-compatible", { id: "placeholder-cleanup" });
    legacy.models = [
      { id: "new-model-1788416151307", name: "new-model-1788416151307", contextWindow: 128000, maxOutputTokens: 8192, enabled: true, supportsStreaming: true },
      { id: "real-provider-model", name: "Real provider model", contextWindow: 128000, maxOutputTokens: 8192, enabled: true, supportsStreaming: true },
    ];
    legacy.model = "new-model-1788416151307";
    legacy.defaultModelId = "new-model-1788416151307";
    storage.get.mockResolvedValue({ version: 3, profiles: [legacy], activeProfileId: legacy.id });
    const store = createAiProviderProfileStore();

    await store.getState().hydrate();

    const hydrated = store.getState().profiles[0]!;
    expect(hydrated.models.map((model) => model.id)).toEqual(["real-provider-model"]);
    expect(hydrated.defaultModelId).toBe("real-provider-model");
    expect(hydrated.model).toBe("real-provider-model");
    expect(hydrated.modelTombstones).toContain("new-model-1788416151307");

    store.getState().reconcileRemoteModels("placeholder-cleanup", [
      { id: "new-model-1788416151307", name: "new-model-1788416151307", contextWindow: 128000, maxOutputTokens: 8192, enabled: true, supportsStreaming: true },
    ]);
    expect(store.getState().profiles[0]?.models.map((model) => model.id)).toEqual(["real-provider-model"]);
  });

  it("preserves an intermediate user-owned single-model array without adding preset models", async () => {
    const legacy = { ...createDefaultAiProviderProfile("anthropic", { id: "intermediate-anthropic" }) } as Record<string, unknown>;
    legacy.models = [{ id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet", contextWindow: 128000, maxOutputTokens: 4096, enabled: true }];
    delete legacy.defaultModelId;
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([legacy as never]);

    expect(store.getState().profiles[0]?.models.map((model) => model.id)).toEqual(["claude-sonnet-4-5-20250929"]);
  });

  it("preserves a known provider's legacy single-model catalog when the default marker exists", async () => {
    const legacy = { ...createDefaultAiProviderProfile("anthropic", { id: "marked-anthropic" }) } as Record<string, unknown>;
    legacy.models = [{ id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet", contextWindow: 128000, maxOutputTokens: 4096, enabled: true }];
    legacy.defaultModelId = "claude-sonnet-4-5-20250929";
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([legacy as never]);

    expect(store.getState().profiles[0]?.models.length).toBe(1);
  });

  it("does not resurrect deleted models during ordinary profile edits", async () => {
    const profile = createDefaultAiProviderProfile("anthropic", { id: "delete-anthropic", model: "claude-sonnet-4-5-20250929" });
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([profile]);

    store.getState().updateProfile("delete-anthropic", { models: [profile.models[0]!] });
    expect(store.getState().profiles[0]?.models).toHaveLength(1);
    store.getState().updateProfile("delete-anthropic", { models: [] });
    expect(store.getState().profiles[0]?.models).toHaveLength(0);
  });

  it("repairs a known custom Anthropic connection whose protocol was persisted incorrectly", async () => {
    const profile = createDefaultAiProviderProfile("custom-anthropic-messages", { id: "custom-anthropic" });
    const corrupted: AiProviderProfile = { ...profile, protocol: "gemini-generate-content", name: "Custom (Anthropic Messages)" };
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([corrupted]);

    expect(store.getState().profiles[0]).toMatchObject({
      name: "Custom (Anthropic Messages)",
      protocol: "anthropic-messages",
      authMode: "x-api-key",
    });
  });

  it("keeps an intentional protocol switch during ordinary profile edits", async () => {
    const profile = createDefaultAiProviderProfile("custom-openai-compatible", { id: "switchable" });
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([profile]);
    store.getState().updateProfile("switchable", { protocol: "anthropic-messages", authMode: "x-api-key" });

    expect(store.getState().profiles[0]?.protocol).toBe("anthropic-messages");
    expect(store.getState().profiles[0]?.authMode).toBe("x-api-key");
  });

  it("persists model deletions and does not resurrect them during hydration or remote refresh", async () => {
    const profile = createDefaultAiProviderProfile("anthropic", { id: "tombstone-profile", model: "claude-sonnet-4-5-20250929" });
    const deletedId = profile.models[0]!.id;
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([profile]);
    store.getState().addModel("tombstone-profile", { id: "new-model", name: "New model", contextWindow: 64000, maxOutputTokens: 4096, enabled: true, supportsStreaming: true });

    vi.useFakeTimers();
    store.getState().removeModel("tombstone-profile", deletedId);
    await vi.advanceTimersByTimeAsync(1000);
    const persisted = (storage.set.mock.calls.at(-1)?.[1] as { profiles: AiProviderProfile[] });
    expect(persisted.profiles[0]?.models.some((model) => model.id === deletedId)).toBe(false);
    expect(persisted.profiles[0]?.modelTombstones).toContain(deletedId);

    storage.get.mockResolvedValue(persisted);
    const hydrated = createAiProviderProfileStore();
    await hydrated.getState().hydrate();
    expect(hydrated.getState().profiles[0]?.models.some((model) => model.id === deletedId)).toBe(false);

    hydrated.getState().reconcileRemoteModels("tombstone-profile", [
      { id: deletedId, name: deletedId, contextWindow: 128000, maxOutputTokens: 8192, enabled: true, supportsStreaming: true },
      { id: "new-model", name: "New model", contextWindow: 64000, maxOutputTokens: 4096, enabled: true, supportsStreaming: true },
    ]);
    expect(hydrated.getState().profiles[0]?.models.map((model) => model.id)).not.toContain(deletedId);
    expect(hydrated.getState().profiles[0]?.models.map((model) => model.id)).toContain("new-model");
  });

  it("serializes profile persistence so an older write cannot overwrite a newer state", async () => {
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "ordered-persistence" });
    const writes: Array<{ payload: unknown; resolve: () => void }> = [];
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([profile]);
    storage.set.mockImplementation((key: string, payload: unknown) => new Promise<void>((resolve) => {
      expect(key).toBe("lattice-ai-provider-profiles");
      writes.push({ payload, resolve });
    }));

    vi.useFakeTimers();
    store.getState().addModel("ordered-persistence", {
      id: "model-b",
      name: "Model B",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      enabled: true,
      supportsStreaming: true,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toHaveLength(1);
    store.getState().setDefaultModel("ordered-persistence", "model-b");
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toHaveLength(1);
    writes[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(2);
    writes[1]!.resolve();
    await vi.advanceTimersByTimeAsync(0);

    const latestPayload = writes.at(-1)?.payload as { profiles: AiProviderProfile[] };
    expect(latestPayload.profiles[0]?.models.map((model) => model.id)).toContain("model-b");
  });

  it("continues persisting after a storage write fails", async () => {
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "recovering-persistence" });
    const writes: Array<{ payload: unknown; resolve: () => void; reject: () => void }> = [];
    storage.set.mockResolvedValue(undefined);
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([profile]);
    storage.set.mockImplementation((key: string, payload: unknown) => new Promise<void>((resolve, reject) => {
      expect(key).toBe("lattice-ai-provider-profiles");
      writes.push({ payload, resolve, reject });
    }));

    vi.useFakeTimers();
    store.getState().addModel("recovering-persistence", {
      id: "model-a",
      name: "Model A",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      enabled: true,
      supportsStreaming: true,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toHaveLength(1);
    writes[0]!.reject();
    await vi.advanceTimersByTimeAsync(0);

    store.getState().setDefaultModel("recovering-persistence", "model-a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toHaveLength(2);
    expect((writes[1]!.payload as { profiles: AiProviderProfile[] }).profiles[0]?.defaultModelId).toBe("model-a");
    writes[1]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("keeps protocol and provider identity independent when a custom connection changes protocol", async () => {
    const profile = createDefaultAiProviderProfile("custom-openai-compatible", { id: "independent-profile", model: "vendor-model" });
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([profile]);

    store.getState().updateProfile("independent-profile", { protocol: "anthropic-messages", authMode: "x-api-key" });

    expect(store.getState().profiles[0]).toMatchObject({ provider: "custom", protocol: "anthropic-messages", model: null, models: [] });
  });

  it("clears the model catalog when the connection vendor changes", async () => {
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "vendor-switch", model: "vendor-model" });
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([profile]);

    store.getState().setModelProvider("vendor-switch", "google");

    expect(store.getState().profiles[0]).toMatchObject({
      provider: "google",
      models: [],
      model: null,
      defaultModelId: null,
    });
    expect(store.getState().profiles[0]?.modelTombstones ?? []).toEqual([]);
  });

  it("clears a connection catalog when its protocol changes instead of carrying stale models across protocols", async () => {
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "protocol-switch", model: "gpt-5.6" });
    const store = createAiProviderProfileStore();
    await store.getState().loadProfiles([profile]);

    store.getState().updateProfile("protocol-switch", { protocol: "gemini-generate-content", authMode: "api-key" });

    expect(store.getState().profiles[0]).toMatchObject({
      protocol: "gemini-generate-content",
      provider: "openai",
      models: [],
      model: null,
      defaultModelId: null,
    });
  });

  it("clears only an untouched legacy preset catalog during schema migration", async () => {
    const legacy = {
      ...createDefaultAiProviderProfile("openai-chat", { id: "legacy-generated" }),
      model: "gpt-4.1",
      defaultModelId: "gpt-4.1",
      models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini"].map((id) => ({
        id,
        name: id,
        contextWindow: 128000,
        maxOutputTokens: 8192,
        enabled: true,
        supportsStreaming: true,
      })),
    };
    storage.get.mockResolvedValue({ version: 2, profiles: [legacy], activeProfileId: legacy.id });
    const store = createAiProviderProfileStore();

    await store.getState().hydrate();

    expect(store.getState().profiles[0]?.models).toEqual([]);
    expect(store.getState().profiles[0]?.defaultModelId).toBeNull();

    const customized = { ...legacy, id: "legacy-customized", models: legacy.models.map((model) => model.id === "gpt-4.1" ? { ...model, name: "Team GPT", maxOutputTokens: 4096 } : model) };
    storage.get.mockResolvedValue({ version: 2, profiles: [customized], activeProfileId: customized.id });
    const preservedStore = createAiProviderProfileStore();
    await preservedStore.getState().hydrate();
    expect(preservedStore.getState().profiles[0]?.models).toHaveLength(3);
    expect(preservedStore.getState().profiles[0]?.models[0]?.name).toBe("Team GPT");
  });
});
