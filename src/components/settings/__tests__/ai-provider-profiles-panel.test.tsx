/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderProfilesPanel } from "../ai-provider-profiles-panel";
import { createDefaultAiProviderProfile } from "@/lib/ai/provider-profiles";
import type { AiModel } from "@/lib/ai/types";
import { setLocale } from "@/lib/i18n";

vi.mock("@/lib/ai/key-storage", () => ({
  loadProfileApiKey: vi.fn(async () => ""),
  setProfileApiKey: vi.fn(async () => undefined),
  clearProfileApiKey: vi.fn(async () => undefined),
}));

const actions = {
  createProfile: vi.fn(() => createDefaultAiProviderProfile("openrouter", { id: "new-profile" })),
  setActiveProfile: vi.fn(),
  setDefaultProfile: vi.fn(),
  updateProfile: vi.fn(),
  reconcileRemoteModels: vi.fn(),
  removeProfile: vi.fn(),
  testProfile: vi.fn(async () => ({ ok: true, message: "Connection successful.", latencyMs: 42 })),
  refreshModels: vi.fn<() => Promise<AiModel[]>>(async () => [{ id: "openai/gpt-4.1-mini", name: "openai/gpt-4.1-mini", provider: "openrouter", contextWindow: 128000, supportsStreaming: true }]),
};

describe("AiProviderProfilesPanel", () => {
  beforeEach(() => { setLocale("en-US"); vi.clearAllMocks(); });
  afterEach(() => act(() => setLocale("zh-CN")));

  it("switches connection controls and model validation without changing settings or calling providers", async () => {
    setLocale("zh-CN");
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "locale-profile", name: "Fixture connection" });
    await act(async () => { render(<AiProviderProfilesPanel profiles={[profile]} activeProfileId={profile.id} {...actions} />); });
    expect(screen.getByText("AI 连接")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
    fireEvent.click(screen.getByRole("button", { name: "确认添加模型" }));
    expect(screen.getByRole("alert").textContent).toBe("请输入模型 ID。");
    fireEvent.change(screen.getByLabelText("新模型 ID"), { target: { value: "fixture-model" } });
    act(() => setLocale("en-US"));
    expect((screen.getByLabelText("New model ID") as HTMLInputElement).value).toBe("fixture-model");
    expect(screen.getByRole("alert").textContent).toBe("Model ID is required.");
    expect(screen.getByPlaceholderText("Saved on this device for this profile")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel add model" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("AI connections")).toBeTruthy());
    expect(actions.updateProfile).not.toHaveBeenCalled();
    expect(actions.testProfile).not.toHaveBeenCalled();
    expect(actions.refreshModels).not.toHaveBeenCalled();
  });

  it("creates a profile, selects a default and shows connection diagnostics", async () => {
    const profile = createDefaultAiProviderProfile("openrouter", { id: "router", isDefault: true });
    render(<AiProviderProfilesPanel profiles={[profile]} activeProfileId="router" {...actions} />);

    fireEvent.click(screen.getByRole("button", { name: /Add connection/i }));
    expect(actions.createProfile).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));
    await waitFor(() => expect(screen.getByText(/42 ms/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Fetch available models/i }));
    await waitFor(() => expect(screen.getByText(/openai\/gpt-4\.1-mini/)).toBeTruthy());
  });

  it("updates active profile transport limits from advanced settings", () => {
    const profile = createDefaultAiProviderProfile("openrouter", { id: "router" });
    render(<AiProviderProfilesPanel profiles={[profile]} activeProfileId="router" {...actions} />);

    fireEvent.click(screen.getByText("Advanced transport"));
    fireEvent.change(screen.getByLabelText("Stream idle timeout (ms)"), { target: { value: "45000" } });
    fireEvent.blur(screen.getByLabelText("Stream idle timeout (ms)"));
    fireEvent.change(screen.getByLabelText("First response wait (ms)"), { target: { value: "90000" } });
    fireEvent.blur(screen.getByLabelText("First response wait (ms)"));
    fireEvent.change(screen.getByLabelText("Total request budget (ms)"), { target: { value: "300000" } });
    fireEvent.blur(screen.getByLabelText("Total request budget (ms)"));
    fireEvent.change(screen.getByLabelText("Retries"), { target: { value: "3" } });

    expect(actions.updateProfile).toHaveBeenCalledWith("router", { timeoutMs: 45000 });
    expect(actions.updateProfile).toHaveBeenCalledWith("router", { firstResponseTimeoutMs: 90000 });
    expect(actions.updateProfile).toHaveBeenCalledWith("router", { maxRequestDurationMs: 300000 });
    expect(actions.updateProfile).toHaveBeenCalledWith("router", { maxRetries: 3 });
  });

  it("allows a custom connection to use the Anthropic Messages protocol", () => {
    const profile = createDefaultAiProviderProfile("custom-openai-compatible", { id: "custom-channel" });
    render(<AiProviderProfilesPanel profiles={[profile]} activeProfileId="custom-channel" {...actions} />);

    fireEvent.change(screen.getByLabelText("API protocol"), { target: { value: "anthropic-messages" } });

    expect(actions.updateProfile).toHaveBeenCalledWith("custom-channel", {
      protocol: "anthropic-messages",
      authMode: "x-api-key",
      models: [],
      model: null,
      defaultModelId: null,
      modelTombstones: [],
    });
  });

  it("resets the visible catalog when switching protocols", () => {
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "switch-catalog", model: "gpt-5.6" });
    render(<AiProviderProfilesPanel profiles={[profile]} activeProfileId="switch-catalog" {...actions} />);

    fireEvent.change(screen.getByLabelText("API protocol"), { target: { value: "gemini-generate-content" } });

    expect(actions.updateProfile).toHaveBeenCalledWith("switch-catalog", expect.objectContaining({
      protocol: "gemini-generate-content",
      models: [],
      model: null,
      defaultModelId: null,
    }));
  });

  it("changes the channel without changing protocol or model vendor", () => {
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "channel-switch" });
    render(<AiProviderProfilesPanel profiles={[profile]} activeProfileId="channel-switch" {...actions} />);

    fireEvent.change(screen.getByLabelText("Connection channel"), { target: { value: "custom" } });

    expect(actions.updateProfile).toHaveBeenCalledWith("channel-switch", { channel: "custom" });
  });

  it("opens a real model id form without writing a placeholder model", () => {
    const profile = createDefaultAiProviderProfile("anthropic", { id: "anthropic-channel" });
    render(<AiProviderProfilesPanel profiles={[profile]} activeProfileId="anthropic-channel" {...actions} />);

    expect(screen.getByText("Models")).toBeTruthy();
    expect(screen.getByText(/No models configured/)).toBeTruthy();
    actions.updateProfile.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));

    expect(screen.getByLabelText("New model ID")).toBeTruthy();
    expect(screen.queryByDisplayValue(/new-model-/i)).toBeNull();
    expect(actions.updateProfile).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("New model ID"), { target: { value: "claude-sonnet-4" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm add model" }));

    expect(actions.updateProfile).toHaveBeenCalledWith("anthropic-channel", expect.objectContaining({
      models: [expect.objectContaining({ id: "claude-sonnet-4", name: "claude-sonnet-4" })],
      defaultModelId: "claude-sonnet-4",
      model: "claude-sonnet-4",
    }));
  });

  it("uses a default model select instead of a star action", () => {
    const profile = createDefaultAiProviderProfile("openai-chat", { id: "default-model", model: "model-a" });
    profile.models.push({
      id: "model-b",
      name: "Model B",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      enabled: true,
      supportsStreaming: true,
    });
    render(<AiProviderProfilesPanel profiles={[profile]} activeProfileId="default-model" {...actions} />);

    const defaultModel = screen.getByLabelText("Default model") as HTMLSelectElement;
    expect(defaultModel.tagName).toBe("SELECT");
    expect(defaultModel.value).toBe("model-a");
    expect(screen.queryByRole("button", { name: "Default model model-a" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set default model model-a" })).toBeNull();

    fireEvent.change(defaultModel, { target: { value: "model-b" } });
    expect(actions.updateProfile).toHaveBeenCalledWith("default-model", {
      defaultModelId: "model-b",
      model: "model-b",
    });
  });

  it("submits a reduced model catalog when a model is deleted", () => {
    const profile = createDefaultAiProviderProfile("anthropic", { id: "anthropic-delete", model: "claude-opus-4-6" });
    render(<AiProviderProfilesPanel profiles={[profile]} activeProfileId="anthropic-delete" {...actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete model claude-opus-4-6" }));

    expect(actions.updateProfile).toHaveBeenCalledWith("anthropic-delete", expect.objectContaining({
      models: [],
    }));
    const calls = actions.updateProfile.mock.calls as Array<[string, { models?: Array<{ id: string }> }]>;
    expect(calls.at(-1)?.[1].models).toHaveLength(0);
  });

  it("shows a recoverable error when model discovery fails", async () => {
    actions.refreshModels.mockRejectedValueOnce(new Error("gateway offline"));
    const profile = createDefaultAiProviderProfile("openrouter", { id: "refresh-error" });
    render(<AiProviderProfilesPanel profiles={[profile]} activeProfileId="refresh-error" {...actions} />);

    fireEvent.click(screen.getByRole("button", { name: /Fetch available models/i }));

    await waitFor(() => {
      expect(screen.getByTestId("model-catalog-error-refresh-error").textContent).toContain("gateway offline");
    });
  });

  it("ignores a model refresh result when the connection changes before it resolves", async () => {
    let resolveRefresh: ((models: AiModel[]) => void) | undefined;
    actions.refreshModels.mockImplementationOnce(() => new Promise<AiModel[]>((resolve) => {
      resolveRefresh = resolve;
    }));
    actions.refreshModels.mockClear();
    actions.updateProfile.mockClear();
    actions.reconcileRemoteModels.mockClear();

    const openAiProfile = createDefaultAiProviderProfile("openai-chat", { id: "refresh-race", model: "old-model" });
    const { rerender } = render(<AiProviderProfilesPanel profiles={[openAiProfile]} activeProfileId="refresh-race" {...actions} />);

    fireEvent.click(screen.getByRole("button", { name: /Fetch available models/i }));
    const googleProfile = createDefaultAiProviderProfile("gemini", { id: "refresh-race" });
    rerender(<AiProviderProfilesPanel profiles={[googleProfile]} activeProfileId="refresh-race" {...actions} />);
    resolveRefresh?.([{ id: "old-model", name: "Old model", provider: "openai", contextWindow: 128000, supportsStreaming: true }]);

    await waitFor(() => expect(actions.refreshModels).toHaveBeenCalledTimes(1));
    expect(actions.updateProfile).not.toHaveBeenCalled();
    expect(actions.reconcileRemoteModels).not.toHaveBeenCalled();
  });

  it("does not keep showing a previous model summary after the connection changes", async () => {
    actions.refreshModels.mockClear();
    actions.updateProfile.mockClear();
    actions.reconcileRemoteModels.mockClear();
    const openAiProfile = createDefaultAiProviderProfile("openai-chat", { id: "summary-race" });
    const { rerender } = render(<AiProviderProfilesPanel profiles={[openAiProfile]} activeProfileId="summary-race" {...actions} />);

    fireEvent.click(screen.getByRole("button", { name: /Fetch available models/i }));
    await waitFor(() => expect(screen.getByText(/openai\/gpt-4\.1-mini/)).toBeTruthy());

    const googleProfile = createDefaultAiProviderProfile("gemini", { id: "summary-race" });
    rerender(<AiProviderProfilesPanel profiles={[googleProfile]} activeProfileId="summary-race" {...actions} />);

    expect(screen.queryByText(/openai\/gpt-4\.1-mini/)).toBeNull();
  });
});
