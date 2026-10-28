import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudWorkspaceSnapshot, resetCloudWorkspaceHost, setCloudWorkspaceProvider } from "@/lib/cloud-workspace-host";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { act, renderHook } from "@testing-library/react";
import { useAiComposerInput } from "@/hooks/use-ai-composer-input";
import type { CloudLibrarySourceProvider } from "../source-provider";
import { openCloudAiEntry } from "../cloud-ai-entry";

const storage = vi.hoisted(() => ({ get: vi.fn(async () => undefined), set: vi.fn(async (_key: string, _value: unknown) => undefined) }));
vi.mock("@/lib/storage-adapter", () => ({ getStorageAdapter: () => storage }));

function provider(scope = "account-a"): CloudLibrarySourceProvider {
  const unexpected = async (): Promise<never> => { throw new Error("An AI entry must not access cloud content."); };
  return { scope, list: unexpected, read: unexpected, search: unexpected, save: unexpected };
}

let source: CloudLibrarySourceProvider;
beforeEach(() => {
  resetCloudWorkspaceHost();
  source = provider();
  setCloudWorkspaceProvider(source);
  useAiChatStore.setState({ conversations: [], activeConversationId: null, composerDraft: null, composerMode: "chat", isOpen: false, isGenerating: false, hasHydratedConversations: true });
});
afterEach(async () => { await useAiChatStore.getState().flushConversations(); resetCloudWorkspaceHost(); });

describe("cloud AI entry", () => {
  it.each([[
    "file", "@cloud:library%3Aone:paper%2Ftwo",
  ], [
    "folder", "@cloud-folder:library%3Aone:paper%2Ftwo",
  ]] as const)("opens the existing AI panel with an explicit %s source without sending or reading", (kind, mention) => {
    const result = openCloudAiEntry({ provider: source, expectedScope: "account-a", selection: { kind, libraryId: "library:one", itemId: "paper/two" }, sourceName: "Research source" });
    const state = useAiChatStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.isGenerating).toBe(false);
    expect(state.getActiveConversation()).toMatchObject({ id: result.conversationId, title: "Research source", messages: [], workspace: { workspaceKey: "cloud:library:one", libraryId: "library:one", permissionScope: "account-a" } });
    expect(state.getConversationDraft()).toEqual({ text: `${mention} `, mode: "agent" });
    expect(state.composerDraft?.submit).not.toBe(true);
    expect(getCloudWorkspaceSnapshot().active).toBe(false);
  });

  it("preserves an unsent draft, attachments and continuation in its original conversation", () => {
    const chat = useAiChatStore.getState();
    const original = chat.newConversation();
    const draft = { text: "My unsent question", mode: "chat" as const, attachmentIds: ["attachment"], continuation: { sourceSessionId: "research" } };
    chat.setComposerDraft(draft);
    chat.setConversationWorkspace({ workspaceKey: "local:original" });
    const result = openCloudAiEntry({ provider: source, expectedScope: "account-a", selection: { kind: "file", libraryId: "lib", itemId: "paper" } });
    expect(result.conversationId).not.toBe(original);
    expect(useAiChatStore.getState().getConversationDraft(original)).toEqual(draft);
    expect(useAiChatStore.getState().conversations.find(item => item.id === original)?.workspace).toEqual({ workspaceKey: "local:original" });
    expect(useAiChatStore.getState().getConversationDraft()).toEqual({ text: "@cloud:lib:paper ", mode: "agent" });
  });

  it("does not retarget a conversation that already contains messages", () => {
    const chat = useAiChatStore.getState();
    chat.addUserMessage("Original research question");
    const original = useAiChatStore.getState().activeConversationId;
    const result = openCloudAiEntry({ provider: source, expectedScope: "account-a", selection: { kind: "folder", libraryId: "lib", itemId: "folder" } });
    expect(result.conversationId).not.toBe(original);
    expect(useAiChatStore.getState().conversations.find(item => item.id === original)?.messages[0].content).toBe("Original research question");
  });

  it("persists the immediately typed composer input in the original conversation when opening a cloud source", async () => {
    const { result } = renderHook(useAiComposerInput);
    act(() => result.current[1]("Question typed immediately before clicking Cloud AI"));
    const original = useAiChatStore.getState().activeConversationId;
    act(() => { openCloudAiEntry({ provider: source, expectedScope: "account-a", selection: { kind: "file", libraryId: "lib", itemId: "paper" } }); });
    await useAiChatStore.getState().flushConversations();
    const snapshot = storage.set.mock.calls.at(-1)?.[1] as { conversations: Array<{ id: string; draft?: { text: string } }> };
    expect(snapshot.conversations.find(item => item.id === original)?.draft?.text).toBe("Question typed immediately before clicking Cloud AI");
    expect(result.current[0]).toBe("@cloud:lib:paper ");
  });

  it("reuses the same untouched cloud source draft on repeated clicks", () => {
    const input = { provider: source, expectedScope: "account-a", selection: { kind: "file" as const, libraryId: "lib", itemId: "paper" } };
    const first = openCloudAiEntry(input);
    useAiChatStore.getState().consumeComposerDraft();
    const second = openCloudAiEntry(input);
    expect(second.conversationId).toBe(first.conversationId);
    expect(useAiChatStore.getState().conversations).toHaveLength(1);
    expect(useAiChatStore.getState().getConversationDraft()?.text).toBe("@cloud:lib:paper ");
  });

  it("does not reuse another account's otherwise identical source draft", () => {
    const first = openCloudAiEntry({ provider: source, expectedScope: "account-a", selection: { kind: "file", libraryId: "lib", itemId: "paper" } });
    source = provider("account-b"); setCloudWorkspaceProvider(source);
    const second = openCloudAiEntry({ provider: source, expectedScope: "account-b", selection: { kind: "file", libraryId: "lib", itemId: "paper" } });
    expect(second.conversationId).not.toBe(first.conversationId);
    expect(useAiChatStore.getState().conversations.find(item => item.id === first.conversationId)?.workspace?.permissionScope).toBe("account-a");
  });

  it.each(["replaced", "mutated", "unscoped"])("rejects a %s provider before changing drafts or opening AI", (change) => {
    if (change === "replaced") setCloudWorkspaceProvider(provider("account-b"));
    if (change === "mutated") Object.assign(source, { scope: "account-b" });
    if (change === "unscoped") Object.assign(source, { scope: undefined });
    expect(() => openCloudAiEntry({ provider: source, expectedScope: "account-a", selection: { kind: "file", libraryId: "lib", itemId: "paper" } })).toThrow();
    expect(useAiChatStore.getState().conversations).toHaveLength(0);
    expect(useAiChatStore.getState().isOpen).toBe(false);
  });

  it("rejects malformed selection IDs before saving a draft", () => {
    expect(() => openCloudAiEntry({ provider: source, expectedScope: "account-a", selection: { kind: "file", libraryId: "lib", itemId: "\n" } })).toThrow();
    expect(useAiChatStore.getState().conversations).toHaveLength(0);
  });

  it("keeps the running conversation active until its request finishes", () => {
    const original = useAiChatStore.getState().newConversation();
    useAiChatStore.setState({ isGenerating: true });
    expect(() => openCloudAiEntry({ provider: source, expectedScope: "account-a", selection: { kind: "file", libraryId: "lib", itemId: "paper" } })).toThrow();
    expect(useAiChatStore.getState().activeConversationId).toBe(original);
    expect(useAiChatStore.getState().conversations).toHaveLength(1);
  });
});
