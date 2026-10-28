import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CloudConnectionPanel } from "../cloud-connection-panel";

const connection = { id: "lattice-managed", name: "Lattice 云库", apiUrl: "https://api.example.com", supabaseUrl: "https://project.supabase.co", publicKey: "sb_publishable_fixture", maxFileBytes: 5242880 };
const props = { connections: [connection], activeId: connection.id, managedConnectionId: connection.id, onSelect: vi.fn(), onSave: vi.fn(), onLogin: vi.fn(), onLogout: vi.fn(), onRegister: vi.fn() };

describe("ordinary cloud account experience", () => {
  it("shows an unavailable service with retry and local actions instead of infrastructure onboarding", async () => {
    const onRetry = vi.fn(), onContinueLocal = vi.fn();
    render(<CloudConnectionPanel {...props} connections={[]} activeId="" onRetry={onRetry} onContinueLocal={onContinueLocal} />);
    expect(screen.getByText("云端服务暂不可用")).toBeTruthy();
    expect(screen.queryByLabelText("云库连接")).toBeNull();
    expect(screen.queryByLabelText("云库邀请链接或配置")).toBeNull();
    expect(screen.queryByLabelText("Supabase 项目 URL")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "继续使用本地库" }));
    expect(onContinueLocal).toHaveBeenCalledTimes(1);
  });

  it("requests a reset by email without submitting the login password", async () => {
    const onRequestPasswordReset = vi.fn(async () => undefined), onLogin = vi.fn();
    render(<CloudConnectionPanel {...props} onLogin={onLogin} onRequestPasswordReset={onRequestPasswordReset} />);
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "member@example.com" } });
    fireEvent.change(screen.getByLabelText("云库密码"), { target: { value: "private-old-password" } });
    fireEvent.click(screen.getByRole("button", { name: "忘记密码？" }));
    expect(screen.queryByLabelText("云库密码")).toBeNull();
    fireEvent.submit(screen.getByRole("button", { name: "发送重置邮件" }).closest("form")!);
    await waitFor(() => expect(onRequestPasswordReset).toHaveBeenCalledWith("member@example.com"));
    expect(screen.getByRole("status").textContent).toContain("重置邮件");
    expect(onLogin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回登录" }));
    expect((screen.getByLabelText("云库密码") as HTMLInputElement).value).toBe("");
  });

  it("requires matching new passwords and completes recovery while a different account remains signed in", async () => {
    const onResetPassword = vi.fn(async () => undefined), onLogin = vi.fn(), onLogout = vi.fn();
    render(<CloudConnectionPanel {...props} userId="existing-other-user" passwordRecovery onResetPassword={onResetPassword} onLogin={onLogin} onLogout={onLogout} />);
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "different-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "保存新密码" }).closest("form")!);
    expect(screen.getByRole("alert").textContent).toContain("不一致");
    expect(onResetPassword).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "保存新密码" }).closest("form")!);
    await waitFor(() => expect(onResetPassword).toHaveBeenCalledWith("new-password"));
    expect(screen.getByRole("status").textContent).toContain("密码已更新");
    expect(onLogin).not.toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("lets the user leave recovery mode and returns them to the existing login form", () => {
    const onCancelPasswordRecovery = vi.fn();
    render(<CloudConnectionPanel {...props} passwordRecovery onResetPassword={vi.fn()} onCancelPasswordRecovery={onCancelPasswordRecovery} />);
    fireEvent.click(screen.getByRole("button", { name: "返回登录" }));
    expect(onCancelPasswordRecovery).toHaveBeenCalledTimes(1);
  });

  it("does not carry account credentials or recovery notices across cloud services", async () => {
    const onRequestPasswordReset = vi.fn(async () => undefined);
    const { rerender } = render(<CloudConnectionPanel {...props} onRequestPasswordReset={onRequestPasswordReset} />);
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "member@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "忘记密码？" }));
    fireEvent.submit(screen.getByRole("button", { name: "发送重置邮件" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("重置邮件"));
    const other = { ...connection, id: "other", name: "Other", supabaseUrl: "https://other.supabase.co" };
    rerender(<CloudConnectionPanel {...props} connections={[connection, other]} activeId={other.id} onRequestPasswordReset={onRequestPasswordReset} />);
    expect((screen.getByLabelText("云库邮箱") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "登录云库" })).toBeTruthy();
  });
});
