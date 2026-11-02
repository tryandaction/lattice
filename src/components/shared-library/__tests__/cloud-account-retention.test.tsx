import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudConnectionPanel } from "../cloud-connection-panel";
import { readCloudAccountProgress, saveCloudAccountProgress } from "@/lib/shared-library/account-progress";

const connection = { id: "lattice-managed", name: "Lattice 云库", apiUrl: "https://api.example.com", supabaseUrl: "https://project.supabase.co", publicKey: "sb_publishable_fixture", maxFileBytes: 5242880 };
const props = () => ({ connections: [connection], activeId: connection.id, managedConnectionId: connection.id, onSelect: vi.fn(), onSave: vi.fn(async () => undefined), onLogin: vi.fn(async () => undefined), onLogout: vi.fn(async () => undefined), onRegister: vi.fn(async () => ({ confirmationRequired: true, confirmationSent: true })), onVerifyEmailCode: vi.fn(async () => undefined), onResendConfirmation: vi.fn(async () => undefined) });

afterEach(() => { cleanup(); sessionStorage.clear(); vi.useRealTimers(); });

async function signup(values = props()) {
  const view = render(<CloudConnectionPanel {...values} />);
  fireEvent.click(screen.getByRole("button", { name: "创建账号" }));
  fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "fixture@example.com" } });
  fireEvent.change(screen.getByLabelText("云库密码"), { target: { value: "fixture-password" } });
  const confirmation = screen.queryByLabelText("确认密码");
  if (confirmation) fireEvent.change(confirmation, { target: { value: "fixture-password" } });
  await act(async () => fireEvent.submit(screen.getByRole("button", { name: "注册云库" }).closest("form")!));
  return { values, view };
}

describe("cloud signup lifecycle", () => {
  it("requires a matching confirmation password before any signup request", async () => {
    const values = props();
    render(<CloudConnectionPanel {...values} />);
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "fixture@example.com" } });
    fireEvent.change(screen.getByLabelText("云库密码"), { target: { value: "fixture-password" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "different-password" } });
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "注册云库" }).closest("form")!));
    expect(values.onRegister).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("不一致");
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "fixture-password" } });
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "注册云库" }).closest("form")!));
    expect(values.onRegister).toHaveBeenCalledExactlyOnceWith("fixture@example.com", "fixture-password");
    expect(screen.getByLabelText("验证码")).toBeTruthy();
  });

  it("restores only email, OTP step and cooldown after a real remount without resending", async () => {
    const { values, view } = await signup();
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "12345678" } });
    view.unmount();
    render(<CloudConnectionPanel {...values} />);
    expect(screen.getByTestId("cloud-confirmation-email").textContent).toBe("fixture@example.com");
    expect(screen.getByLabelText("验证码")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: /秒后可重发/ })).toHaveProperty("disabled", true);
    expect(values.onRegister).toHaveBeenCalledTimes(1);
    expect(values.onResendConfirmation).not.toHaveBeenCalled();
    const storage = JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } });
    expect(storage).not.toContain("fixture-password");
    expect(storage).not.toContain("12345678");
  });

  it("uses elapsed wall time when returning from an inactive window", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const { values } = await signup();
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "12345678" } });
    act(() => { vi.setSystemTime(now + 61000); window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByLabelText("验证码")).toHaveProperty("value", "12345678");
    expect(screen.getByRole("button", { name: "重新发送确认邮件" })).toHaveProperty("disabled", false);
    expect(values.onRegister).toHaveBeenCalledTimes(1);
    expect(values.onResendConfirmation).not.toHaveBeenCalled();
  });

  it("clears a completed OTP draft so a remount never requests a consumed code", async () => {
    const { values, view } = await signup();
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "12345678" } });
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "验证并登录" }).closest("form")!));
    view.unmount();
    render(<CloudConnectionPanel {...values} />);
    expect(screen.queryByLabelText("验证码")).toBeNull();
    expect(screen.getByRole("button", { name: "登录云库" })).toBeTruthy();
  });

  it("restores a registration email after refresh without storing either password", () => {
    const values = props();
    const view = render(<CloudConnectionPanel {...values} />);
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "fixture@example.com" } });
    fireEvent.change(screen.getByLabelText("云库密码"), { target: { value: "fixture-password" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "fixture-password" } });
    view.unmount();
    render(<CloudConnectionPanel {...values} />);
    expect(screen.getByLabelText("云库邮箱")).toHaveProperty("value", "fixture@example.com");
    expect(screen.getByLabelText("云库密码")).toHaveProperty("value", "");
    expect(screen.getByLabelText("确认密码")).toHaveProperty("value", "");
    expect(values.onRegister).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("fixture-password");
  });

  it("keeps progress scoped to a connection and ignores expired or malformed drafts", () => {
    const progress = { email: "fixture@example.com", stage: "otp" as const, confirmation: "sent" as const, resendAt: Date.now() + 60000, expiresAt: Date.now() + 3600000 };
    saveCloudAccountProgress(connection, progress);
    expect(readCloudAccountProgress({ ...connection, apiUrl: "https://other.example.com" })).toBeNull();
    expect(readCloudAccountProgress(connection)?.email).toBe(progress.email);
    saveCloudAccountProgress(connection, { ...progress, expiresAt: Date.now() - 1 });
    expect(readCloudAccountProgress(connection)).toBeNull();
    const key = sessionStorage.key(0)!;
    sessionStorage.setItem(key, "not-json");
    expect(readCloudAccountProgress(connection)).toBeNull();
  });

  it("writes an explicit progress whitelist even when the caller passes extra fields", () => {
    const progress = { email: "fixture@example.com", stage: "otp" as const, confirmation: "sent" as const, resendAt: 0, expiresAt: Date.now() + 3600000, password: "never-persist", token: "87654321" };
    saveCloudAccountProgress(connection, progress);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("never-persist");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("87654321");
  });
});
