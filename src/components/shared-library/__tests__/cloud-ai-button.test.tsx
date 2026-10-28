import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCloudWorkspaceHost, setCloudWorkspaceProvider } from "@/lib/cloud-workspace-host";
import { setLocale } from "@/lib/i18n";
import type { CloudLibrarySourceProvider } from "@/lib/shared-library/source-provider";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { CloudAiButton } from "../cloud-ai-button";
import { CloudExplorerControls } from "../cloud-explorer-controls";

vi.mock("@/lib/storage-adapter", () => ({
  getStorageAdapter: () => ({ get: async () => undefined, set: async () => undefined }),
}));

const noRead = async (): Promise<never> => { throw new Error("Opening AI must not read a source."); };
const provider: CloudLibrarySourceProvider = { scope: "account", list: noRead, read: noRead, save: noRead, search: noRead };
beforeEach(() => {
  setLocale("zh-CN");
  setCloudWorkspaceProvider(provider);
  useAiChatStore.setState({ conversations: [], activeConversationId: null, composerDraft: null, isOpen: false, isGenerating: false, hasHydratedConversations: true });
});
afterEach(async () => { await useAiChatStore.getState().flushConversations(); resetCloudWorkspaceHost(); act(() => setLocale("zh-CN")); });

describe("cloud AI source button", () => {
  it("opens the existing AI chat with the supplied file rather than an Explorer selection", () => {
    render(<CloudAiButton provider={provider} expectedScope="account" sourceName="Selected paper.pdf" selection={{ libraryId: "paper-library", itemId: "paper-file", kind: "file" }} />);
    fireEvent.click(screen.getByRole("button", { name: "云端 AI" }));
    expect(useAiChatStore.getState().isOpen).toBe(true);
    expect(useAiChatStore.getState().getConversationDraft()?.text).toBe("@cloud:paper-library:paper-file ");
    expect(useAiChatStore.getState().getActiveConversation()?.title).toBe("Selected paper.pdf");
  });

  it("switches the button language while preserving an existing draft", () => {
    const original = useAiChatStore.getState().setConversationDraft("Do not replace this question");
    render(<CloudAiButton provider={provider} expectedScope="account" sourceName="Research folder" selection={{ libraryId: "lib", itemId: "research", kind: "folder" }} />);
    act(() => setLocale("en-US"));
    const button = screen.getByRole("button", { name: "Use with AI" });
    expect(button.getAttribute("title")).toContain("Research folder");
    fireEvent.click(button);
    expect(useAiChatStore.getState().getConversationDraft(original)?.text).toBe("Do not replace this question");
    expect(useAiChatStore.getState().getConversationDraft()?.text).toBe("@cloud-folder:lib:research ");
  });

  it("disables a stale account button and re-enables a current one only after generation stops", () => {
    render(<CloudAiButton provider={provider} expectedScope="account" selection={{ libraryId: "lib", itemId: "paper", kind: "file" }} />);
    const button = screen.getByRole("button", { name: "云端 AI" }) as HTMLButtonElement;
    act(() => useAiChatStore.setState({ isGenerating: true }));
    expect(button.disabled).toBe(true);
    act(() => useAiChatStore.setState({ isGenerating: false }));
    expect(button.disabled).toBe(false);
    act(() => setCloudWorkspaceProvider({ ...provider, scope: "other-account" }));
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(useAiChatStore.getState().isOpen).toBe(false);
  });

  it("makes the selected cloud folder available beside the Explorer controls", () => {
    useCloudWorkbenchStore.setState({ active: true, provider, scope: "account", libraryId: "lib", selectedFolderId: "folder", controller: null, role: "viewer", status: null, loading: false, uploading: false, uploadProgress: "", libraries: [], items: [{ id: "folder", libraryId: "lib", kind: "folder", canonicalName: "Research folder", title: "Research folder", status: "active", metadata: {}, createdBy: "user", createdAt: "today", updatedAt: "today" }] });
    render(<CloudExplorerControls />);
    expect(screen.getByText("Research folder")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "带入 AI" }));
    expect(useAiChatStore.getState().getConversationDraft()?.text).toBe("@cloud-folder:lib:folder ");
    expect(useAiChatStore.getState().getActiveConversation()?.workspace?.permissionScope).toBe("account");
  });
});
