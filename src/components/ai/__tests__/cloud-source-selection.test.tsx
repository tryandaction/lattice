import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudWorkspaceSnapshot, resetCloudWorkspaceHost, setCloudWorkspaceProvider, setCloudWorkspaceResource } from "@/lib/cloud-workspace-host";
import type { CloudLibraryResource, CloudLibrarySourceProvider } from "@/lib/shared-library/source-provider";
import { openCloudAiEntry } from "@/lib/shared-library/cloud-ai-entry";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { setLocale } from "@/lib/i18n";
import { CloudSourceSelection } from "../cloud-source-selection";

vi.mock("@/lib/storage-adapter", () => ({ getStorageAdapter: () => ({ get: async () => undefined, set: async () => undefined }) }));

const selection = { kind: "file" as const, libraryId: "selected-library", itemId: "selected-paper" };
const noRead = async (): Promise<never> => { throw new Error("Showing a selected source must not read content."); };
const provider: CloudLibrarySourceProvider = { scope: "account-a", list: async () => [], read: noRead, search: noRead, save: noRead };
const opened: CloudLibraryResource = { id: "other-resource", libraryId: "other-library", itemId: "other-paper", kind: "pdf", name: "Other active.pdf", path: "cloud://other", role: "viewer", content: null };

beforeEach(() => {
  setLocale("zh-CN");
  resetCloudWorkspaceHost(); setCloudWorkspaceProvider(provider); setCloudWorkspaceResource(opened);
  useAiChatStore.setState({ conversations: [], activeConversationId: null, composerDraft: null, isGenerating: false, hasHydratedConversations: true });
});
afterEach(async () => { await useAiChatStore.getState().flushConversations(); resetCloudWorkspaceHost(); act(() => setLocale("zh-CN")); });

describe("cloud AI source display", () => {
  it("shows an explicit entry source instead of calling the active file the AI source", () => {
    openCloudAiEntry({ provider, expectedScope: "account-a", selection, sourceName: "Selected research.pdf" });
    render(<CloudSourceSelection host={getCloudWorkspaceSnapshot()} input="@cloud:selected-library:selected-paper Explain this" expectedScope="account-a" onInputChange={vi.fn()} disabled={false} />);
    expect(screen.getByText("已选 AI 云来源：")).toBeTruthy();
    expect(screen.getByText("Selected research.pdf")).toBeTruthy();
    expect(screen.queryByText("Other active.pdf", { exact: false })).toBeNull();
    act(() => setLocale("en-US"));
    expect(screen.getByText("Selected cloud sources for AI:")).toBeTruthy();
  });

  it("distinguishes the currently open file when no cloud source was explicitly selected", () => {
    render(<CloudSourceSelection host={getCloudWorkspaceSnapshot()} input="Explain the current file" expectedScope="account-a" onInputChange={vi.fn()} disabled={false} />);
    expect(screen.getByText("当前打开文件：Other active.pdf")).toBeTruthy();
    expect(screen.queryByText("云当前来源：", { exact: false })).toBeNull();
  });

  it("allows discovering an explicitly selected folder's library without an active cloud file", async () => {
    const listed: Array<[string, string | undefined]> = [];
    const folderProvider = { ...provider, list: async (libraryId: string, parentId?: string) => { listed.push([libraryId, parentId]); return []; } };
    setCloudWorkspaceProvider(folderProvider);
    render(<CloudSourceSelection host={getCloudWorkspaceSnapshot()} input="@cloud-folder:selected-library:folder " expectedScope="account-a" onInputChange={vi.fn()} disabled={false} />);
    const button = screen.getByTestId("ai-source-select-toggle") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(listed).toEqual([["selected-library", "folder"]]));
  });

  it("does not display a previous account's cached source name or list under the new account", () => {
    openCloudAiEntry({ provider, expectedScope: "account-a", selection, sourceName: "Account A private name.pdf" });
    setCloudWorkspaceProvider({ ...provider, scope: "account-b" });
    render(<CloudSourceSelection host={getCloudWorkspaceSnapshot()} input="@cloud:selected-library:selected-paper " expectedScope="account-a" onInputChange={vi.fn()} disabled={false} />);
    expect(screen.getByRole("status").textContent).toContain("重新选择云来源");
    expect(screen.queryByText("Account A private name.pdf")).toBeNull();
    expect((screen.getByTestId("ai-source-select-toggle") as HTMLButtonElement).disabled).toBe(true);
  });
});
