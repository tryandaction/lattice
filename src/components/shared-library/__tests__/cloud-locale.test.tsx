import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { CloudConnectionPanel } from "../cloud-connection-panel";
import { CloudExplorerControls } from "../cloud-explorer-controls";
import { MemberManagement } from "../member-management";
import { LocalUploadTargetDialog } from "../local-upload-target-dialog";
import { CloudFileTree } from "../cloud-file-tree";
import { CloudUploadToolbar } from "../cloud-upload-toolbar";
import { SharedAnnotationPanel } from "../shared-annotation-panel";
import { NewFileButtons } from "@/components/explorer/new-file-buttons";
import type { CloudLibraryWorkspaceController } from "@/lib/shared-library/cloud-workspace";

const connection = { id: "fixture", name: "Research team", apiUrl: "https://api.example.com", supabaseUrl: "https://project.supabase.co", publicKey: "sb_publishable_fixture", maxFileBytes: 1048576 };

beforeEach(() => {
  setLocale("zh-CN");
  useCloudWorkbenchStore.setState({ active: true, controller: null, managementOpen: false, pendingLocalUpload: null, localUploadWarnings: [], error: null, libraries: [], libraryId: "", role: null, status: null, uploading: false, uploadProgress: "" });
});
afterEach(() => act(() => setLocale("zh-CN")));

describe("cloud interface locale", () => {
  it("switches cloud and local file upload controls and keeps progress feedback", () => {
    render(<><CloudFileTree items={[]} onOpenFile={vi.fn()} onSelectFolder={vi.fn()} /><CloudUploadToolbar disabled={false} onFiles={vi.fn()} progress={{ label: "NetworkError: fixture", failed: 1, onRetry: vi.fn() }} /><NewFileButtons onCreateNote={vi.fn()} onCreateNotebook={vi.fn()} onUpload={vi.fn()} /></>);
    expect(screen.getAllByRole("button", { name: "上传文件" })).toHaveLength(2);
    act(() => setLocale("en-US"));
    expect(screen.getByRole("tree", { name: "Cloud library files" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Upload files" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Upload folder" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("NetworkError: fixture");
    expect(screen.getByRole("button", { name: "Retry failed items" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("拖拽文件到这里即可上传");
  });

  it("keeps an annotation draft and the original save error across language changes", async () => {
    const onCreatePageNote = vi.fn(async () => { throw new Error("Upstream 原始错误 503"); });
    render(<SharedAnnotationPanel annotations={[]} onCreatePageNote={onCreatePageNote} />);
    fireEvent.change(screen.getByLabelText("批注内容"), { target: { value: "Keep my 原文 draft" } });
    act(() => setLocale("en-US"));
    expect((screen.getByLabelText("Annotation note") as HTMLTextAreaElement).value).toBe("Keep my 原文 draft");
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Upstream 原始错误 503"));
    act(() => setLocale("zh-CN"));
    expect(screen.getByRole("alert").textContent).toBe("Upstream 原始错误 503");
    expect((screen.getByLabelText("批注内容") as HTMLTextAreaElement).value).toBe("Keep my 原文 draft");
    expect(onCreatePageNote).toHaveBeenCalledTimes(1);
  });
  it("translates invalid invitation feedback and advanced fields without discarding the draft", async () => {
    const onSave = vi.fn();
    render(<CloudConnectionPanel connections={[]} onSelect={vi.fn()} onSave={onSave} onLogin={vi.fn()} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "加入其他云库" }));
    fireEvent.change(screen.getByLabelText("云库邀请链接或配置"), { target: { value: "invalid fixture" } });
    fireEvent.click(screen.getByRole("button", { name: "解析并连接" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("无法识别"));
    act(() => setLocale("en-US"));
    expect(screen.getByRole("alert").textContent).toContain("not recognized");
    expect((screen.getByLabelText("Cloud library invite link or configuration") as HTMLTextAreaElement).value).toBe("invalid fixture");
    fireEvent.click(screen.getByRole("button", { name: "Advanced connection settings" }));
    expect(screen.getByLabelText("Connection name")).toBeTruthy();
    expect(screen.getByLabelText("Supabase project URL")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save connection" })).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("switches a filled sign-up form and its confirmation notice without losing input", async () => {
    const onRegister = vi.fn(async () => ({ confirmationRequired: true }));
    const onLogin = vi.fn(async () => undefined);
    render(<CloudConnectionPanel connections={[connection]} activeId={connection.id} managedConnectionId={connection.id} onSelect={vi.fn()} onSave={vi.fn()} onLogin={onLogin} onLogout={vi.fn()} onRegister={onRegister} />);
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "researcher@example.com" } });
    fireEvent.change(screen.getByLabelText("云库密码"), { target: { value: "synthetic-password" } });

    act(() => setLocale("en-US"));
    expect((screen.getByLabelText("Cloud library email") as HTMLInputElement).value).toBe("researcher@example.com");
    expect((screen.getByLabelText("Cloud library password") as HTMLInputElement).value).toBe("synthetic-password");
    fireEvent.submit(screen.getByRole("button", { name: "Sign up for cloud library" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Confirm your account"));
    expect(onRegister).toHaveBeenCalledWith("researcher@example.com", "synthetic-password");
    expect(onLogin).not.toHaveBeenCalled();

    act(() => setLocale("zh-CN"));
    expect(screen.getByRole("status").textContent).toContain("请在邮箱中确认账号");
    expect(screen.getByRole("button", { name: "登录云库" })).toBeTruthy();
    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  it("switches source actions, permissions and a pending sync count in place", () => {
    useCloudWorkbenchStore.setState({ role: "editor", status: { status: "syncing", pending: 2, error: null } });
    render(<CloudExplorerControls />);
    expect(screen.getByTestId("cloud-sync-status").textContent).toContain("同步中 · 2 · 可编辑");
    act(() => setLocale("en-US"));
    expect(screen.getByRole("button", { name: "Local" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shared library" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage shared library" })).toBeTruthy();
    expect(screen.getByTestId("cloud-sync-status").textContent).toContain("Syncing · 2 · Editor");
    act(() => setLocale("zh-CN"));
    expect(screen.getByRole("button", { name: "共享库管理" })).toBeTruthy();
  });

  it("localizes member roles, status and impact text while preserving role values", () => {
    const onChangeRole = vi.fn();
    render(<MemberManagement members={[{ libraryId: "library", userId: "member", displayName: "Researcher", role: "viewer", status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01" }]} currentUserId="owner" viewerRole="owner" onChangeRole={onChangeRole} />);
    expect(screen.getByTestId("member-role").textContent).toBe("只读");
    expect(screen.getByTestId("member-status").textContent).toBe("正常");
    expect(screen.getByTestId("member-action-impact").textContent).toContain("所有共享内容");
    act(() => setLocale("en-US"));
    expect(screen.getByTestId("member-role").textContent).toBe("Viewer");
    expect(screen.getByTestId("member-status").textContent).toBe("Active");
    fireEvent.change(screen.getByLabelText("Role for member"), { target: { value: "commenter" } });
    expect(onChangeRole).toHaveBeenCalledWith("member", "commenter");
  });

  it("switches upload destinations and PDF companion guidance without reloading the library", async () => {
    const refreshLibrary = vi.fn(async () => undefined);
    const controller = { refreshLibrary, getSnapshot: () => ({ items: [], roles: { fixture: { role: "editor" } } }) } as unknown as CloudLibraryWorkspaceController;
    useCloudWorkbenchStore.setState({
      controller,
      libraryId: "fixture",
      pendingLocalUpload: { name: "paper.pdf", path: "papers/paper.pdf", kind: "file", handle: {} as FileSystemFileHandle, rootHandle: {} as FileSystemDirectoryHandle },
    });
    render(<LocalUploadTargetDialog />);
    await waitFor(() => expect((screen.getByRole("button", { name: "上传" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/已有批注和研究子文件/)).toBeTruthy();
    act(() => setLocale("en-US"));
    expect(screen.getByRole("dialog", { name: "Upload to cloud library" })).toBeTruthy();
    expect(screen.getByLabelText("Upload destination folder")).toBeTruthy();
    expect(screen.getByText(/existing annotations and research child files/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement).disabled).toBe(false);
    expect(refreshLibrary).toHaveBeenCalledTimes(1);
  });
});
