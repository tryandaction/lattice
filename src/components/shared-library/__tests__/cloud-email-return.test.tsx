import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudLibraryControllerHost } from "../cloud-library-workspace";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { setLocale } from "@/lib/i18n";

const connection = { id: "lattice-managed", name: "Lattice 云库", apiUrl: "https://api.example.com", supabaseUrl: "https://project.supabase.co", publicKey: "sb_publishable_fixture", maxFileBytes: 5242880 };
const accessToken = `header.${btoa(JSON.stringify({ iss: `${connection.supabaseUrl}/auth/v1` }))}.signature`;
function seedSignedInSession() {
  const deviceId = "existing-device";
  const key = `cloud-session:${JSON.stringify([connection.id, connection.apiUrl, connection.supabaseUrl])}`;
  localStorage.setItem("lattice-cloud-device-v1", deviceId);
  localStorage.setItem(key, JSON.stringify({ accessToken: "existing-access", refreshToken: "existing-refresh", userId: "existing-user", deviceId, issuedAt: "2026-10-15", expiresAt: "2099-01-01" }));
}

vi.mock("@/lib/shared-library/cloud-persistence", () => ({ createCloudPersistence: () => ({}) }));
vi.mock("../local-upload-target-dialog", () => ({ LocalUploadTargetDialog: () => null }));
vi.mock("../cloud-production-tools", () => ({ CloudProductionTools: ({ onOpenUpload, onRequestCreateLibrary, onCreateLibrary, onLibraryConnected }: { onOpenUpload?: () => void; onRequestCreateLibrary?: () => void; onCreateLibrary?: (repository: { fullName: string }) => Promise<string>; onLibraryConnected?: (libraryId: string) => void | Promise<void> }) => <div>
  <button type="button" onClick={onOpenUpload}>测试：打开云端上传</button>
  <button type="button" onClick={onRequestCreateLibrary}>测试：新建空库</button>
  <button type="button" onClick={async () => { const id = await onCreateLibrary?.({ fullName: "lab/papers" }); if (id) await onLibraryConnected?.(id); }}>测试：从 GitHub 建库</button>
</div> }));
vi.mock("../cloud-upload-dialog", () => ({ CloudUploadDialog: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="上传到云端测试">云端上传进度</div> : null }));
vi.mock("@/lib/shared-library/cloud-workspace", () => ({
  CloudLibraryWorkspaceController: class {
    constructor(public connection: unknown, public userId: string) {}
    initialize = async () => undefined;
    refreshLibraries = async () => undefined;
    start = () => undefined;
    dispose = () => undefined;
    subscribe = () => () => undefined;
    getSnapshot = () => ({ libraries: [], items: [], outbox: [], revoked: [], roles: {}, memberNames: {} });
    createLibrary = async (name: string) => ({ id: `library-${name}`, name });
    refreshLibrary = async () => undefined;
    setDisplayName = async () => undefined;
    getStatus = () => ({ error: null });
  },
}));

beforeEach(() => {
  setLocale("zh-CN");
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  useCloudWorkbenchStore.setState({ active: false, managementOpen: false, controller: null, provider: null, libraryId: "", error: null });
  vi.stubEnv("NEXT_PUBLIC_LATTICE_CLOUD_SERVICE", JSON.stringify({ name: connection.name, apiUrl: connection.apiUrl, supabaseUrl: connection.supabaseUrl, publicKey: connection.publicKey, maxFileBytes: connection.maxFileBytes }));
});
afterEach(() => { cleanup(); setLocale("zh-CN"); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("email return in the regular application shell", () => {
  it("opens the existing cloud dialog, scrubs the URL, and signs in after server validation", async () => {
    window.history.replaceState(null, "", `/#access_token=${accessToken}&refresh_token=synthetic-return&type=signup`);
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "confirmed-user", email_confirmed_at: "2026-10-15T00:00:00Z" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "validated-access", refresh_token: "validated-refresh", expires_in: 3600, user: { id: "confirmed-user" } })));
    vi.stubGlobal("fetch", request);
    render(<StrictMode><CloudLibraryControllerHost /></StrictMode>);
    expect(window.location.hash).toBe("");
    await waitFor(() => expect(useCloudWorkbenchStore.getState().controller?.userId).toBe("confirmed-user"));
    expect(screen.getByRole("dialog", { name: "共享库管理" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("邮箱已确认");
    expect(screen.queryByLabelText("云库密码")).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
    const authenticatedController = useCloudWorkbenchStore.getState().controller;
    act(() => setLocale("en-US"));
    expect(screen.getByRole("dialog", { name: "Manage shared library" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Email confirmed");
    expect(useCloudWorkbenchStore.getState().controller).toBe(authenticatedController);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("shows an expired return without signing out the existing account", async () => {
    localStorage.setItem("lattice-cloud-device-v1", "existing-device");
    const key = `cloud-session:${JSON.stringify([connection.id, connection.apiUrl, connection.supabaseUrl])}`;
    localStorage.setItem(key, JSON.stringify({ accessToken: "existing-access", refreshToken: "existing-refresh", userId: "existing-user", deviceId: "existing-device", issuedAt: "2026-10-15", expiresAt: "2099-01-01" }));
    window.history.replaceState(null, "", "/?library=retained#error=access_denied&error_code=otp_expired&error_description=secret-upstream-text");
    const request = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", request);
    render(<CloudLibraryControllerHost />);
    await waitFor(() => expect(useCloudWorkbenchStore.getState().controller?.userId).toBe("existing-user"));
    expect(screen.getByRole("alert").textContent).toContain("已过期或已使用");
    expect(window.location.search).toBe("?library=retained");
    expect(window.location.hash).toBe("");
    expect(localStorage.getItem(key)).toContain("existing-refresh");
    expect(document.body.textContent).not.toContain("secret-upstream-text");
    act(() => setLocale("en-US"));
    expect(screen.getByRole("alert").textContent).toContain("expired or was already used");
    expect(useCloudWorkbenchStore.getState().controller?.userId).toBe("existing-user");
    expect(request).not.toHaveBeenCalled();
  });
  it("shows login for an invalid return and sends no token to unknown services", async () => {
    window.history.replaceState(null, "", "/#access_token=invalid&refresh_token=synthetic&type=signup");
    const request = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", request);
    render(<CloudLibraryControllerHost />);
    await waitFor(() => expect(screen.getByLabelText("云库邮箱")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("尚未连接的云服务");
    expect(screen.getByRole("button", { name: "重新发送确认邮件" })).toBeTruthy();
    expect(window.location.hash).toBe("");
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps the previous usable account when confirmation validation fails", async () => {
    localStorage.setItem("lattice-cloud-device-v1", "existing-device");
    const key = `cloud-session:${JSON.stringify([connection.id, connection.apiUrl, connection.supabaseUrl])}`;
    const previous = { accessToken: "existing-access", refreshToken: "existing-refresh", userId: "existing-user", deviceId: "existing-device", issuedAt: "2026-10-15", expiresAt: "2099-01-01" };
    localStorage.setItem(key, JSON.stringify(previous));
    window.history.replaceState(null, "", `/#access_token=${accessToken}&refresh_token=failed-return&type=signup`);
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 401 })); vi.stubGlobal("fetch", request);
    render(<CloudLibraryControllerHost />);
    await waitFor(() => expect(useCloudWorkbenchStore.getState().controller?.userId).toBe("existing-user"));
    expect(screen.getByRole("alert").textContent).toContain("未能恢复");
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(previous);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("ends the pending state if saved cloud configuration cannot be loaded", async () => {
    localStorage.setItem("lattice-cloud-connections-v1", "invalid-json");
    window.history.replaceState(null, "", `/#access_token=${accessToken}&refresh_token=synthetic-return&type=signup`);
    const request = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", request);
    render(<CloudLibraryControllerHost />);
    await waitFor(() => expect(screen.getByText("确认链接已接收，但云库连接未能载入。请重新打开共享库后登录。")).toBeTruthy());
    expect(screen.queryByText("正在确认邮箱并连接云库…")).toBeNull();
    expect(window.location.hash).toBe("");
    expect(request).not.toHaveBeenCalled();
  });

  it("opens a separate upload dialog from the selected cloud library", async () => {
    seedSignedInSession();
    useCloudWorkbenchStore.setState({ active: true, managementOpen: true });
    render(<CloudLibraryControllerHost />);
    await waitFor(() => expect(useCloudWorkbenchStore.getState().controller?.userId).toBeTruthy());
    act(() => useCloudWorkbenchStore.setState({ libraryId: "library", libraries: [{ id: "library", name: "Papers" } as never], role: "owner" }));
    fireEvent.click(screen.getByRole("button", { name: "测试：打开云端上传" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "共享库管理" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "上传到云端测试" })).toBeTruthy();
  });

  it("creates an empty cloud library from the first-use action and selects it", async () => {
    seedSignedInSession();
    useCloudWorkbenchStore.setState({ active: true, managementOpen: true });
    render(<CloudLibraryControllerHost />);
    await waitFor(() => expect(useCloudWorkbenchStore.getState().controller?.userId).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "测试：新建空库" }));
    fireEvent.change(screen.getByLabelText("新建名称"), { target: { value: "论文协作" } });
    fireEvent.submit(screen.getByRole("button", { name: "创建" }).closest("form")!);
    await waitFor(() => expect(useCloudWorkbenchStore.getState().libraryId).toBe("library-论文协作"));
  });

  it("creates a cloud library from GitHub and selects it after the repository is linked", async () => {
    seedSignedInSession();
    useCloudWorkbenchStore.setState({ active: true, managementOpen: true });
    render(<CloudLibraryControllerHost />);
    await waitFor(() => expect(useCloudWorkbenchStore.getState().controller?.userId).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "测试：从 GitHub 建库" }));
    await waitFor(() => expect(useCloudWorkbenchStore.getState().libraryId).toBe("library-lab/papers"));
  });

  it("handles password-recovery returns in the cloud dialog and updates the linked account", async () => {
    window.history.replaceState(null, "", `/#access_token=${accessToken}&refresh_token=recovery-return&type=recovery`);
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "recovery-user" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "recovery-user" })));
    vi.stubGlobal("fetch", request);
    render(<CloudLibraryControllerHost />);
    expect(window.location.hash).toBe("");
    expect(await screen.findByLabelText("新密码")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "updated-password" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "updated-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "保存新密码" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("密码已更新"));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe(`${connection.supabaseUrl}/auth/v1/user`);
    expect(request.mock.calls[1][0]).toBe(`${connection.supabaseUrl}/auth/v1/user`);
  });
});
