/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudConnectionPanel } from "../cloud-connection-panel";
import type { CloudLibraryConnection } from "@/lib/shared-library/connection";

const invite = "https://lattice.example/invite?name=量子小组&api=https%3A%2F%2Fapi.example.com&supabase=https%3A%2F%2Fproject.supabase.co&key=sb_publishable_test";

const props = (overrides: Partial<React.ComponentProps<typeof CloudConnectionPanel>> = {}) => ({
  connections: [] as CloudLibraryConnection[],
  activeId: "",
  onSelect: vi.fn(),
  onSave: vi.fn(async () => undefined),
  onLogin: vi.fn(async () => undefined),
  onLogout: vi.fn(async () => undefined),
  ...overrides,
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

const managedConnection = { id: "lattice-managed", name: "Lattice 云库", apiUrl: "https://cloud.example.com", supabaseUrl: "https://db.supabase.co", publicKey: "sb_publishable_test", maxFileBytes: 1000 };

async function registerWithCode(overrides: Partial<React.ComponentProps<typeof CloudConnectionPanel>> = {}) {
  const values = props({ connections: [managedConnection], activeId: managedConnection.id, onRegister: vi.fn(async () => ({ confirmationRequired: true, confirmationSent: true })), onResendConfirmation: vi.fn(async () => undefined), onVerifyEmailCode: vi.fn(async () => undefined), ...overrides });
  render(<CloudConnectionPanel {...values} managedConnectionId={managedConnection.id} />);
  fireEvent.click(screen.getByRole("button", { name: "创建账号" }));
  fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "member@example.com" } });
  fireEvent.change(screen.getByLabelText("云库密码"), { target: { value: "new-password" } });
  await act(async () => fireEvent.submit(screen.getByRole("button", { name: "注册云库" }).closest("form")!));
  return values;
}

describe("cloud email code verification", () => {
  it("accepts an eight-digit email code and verifies without another password login", async () => {
    const values = await registerWithCode();
    const input = screen.getByLabelText("验证码");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    fireEvent.change(input, { target: { value: "12345678" } });
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "验证并登录" }).closest("form")!));
    expect(values.onVerifyEmailCode).toHaveBeenCalledWith("member@example.com", "12345678");
    expect(values.onLogin).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("status").textContent).toContain("验证成功");
  });

  it.each(["1234567", "123456789", "1234abcd"])("rejects invalid code %s without sending it", async code => {
    const values = await registerWithCode();
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: code } });
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "验证并登录" }).closest("form")!));
    expect(values.onVerifyEmailCode).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("8 位数字");
  });

  it("keeps an expired code and email available for correction", async () => {
    const values = await registerWithCode({ onVerifyEmailCode: vi.fn(async () => { throw new Error("验证码已过期，请重新发送。"); }) });
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "12345678" } });
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "验证并登录" }).closest("form")!));
    expect(values.onVerifyEmailCode).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("验证码") as HTMLInputElement).value).toBe("12345678");
    expect(screen.getByTestId("cloud-confirmation-email").textContent).toBe("member@example.com");
    expect(screen.getByRole("alert").textContent).toContain("已过期");
  });

  it("returns to password login when email is verified but connecting the library fails", async () => {
    const verify = vi.fn(async () => { throw Object.assign(new Error("upstream unavailable"), { code: "email_verified_connection_failed" }); });
    await registerWithCode({ onVerifyEmailCode: verify });
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "12345678" } });
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "验证并登录" }).closest("form")!));
    expect(screen.queryByLabelText("验证码")).toBeNull();
    expect(screen.getByLabelText("云库邮箱")).toHaveProperty("value", "member@example.com");
    expect(screen.getByLabelText("云库密码")).toHaveProperty("value", "");
    expect(screen.getByRole("alert").textContent).toContain("邮箱已验证");
    expect(screen.getByRole("alert").textContent).toContain("密码");
    expect(screen.getByRole("button", { name: "登录云库" })).toBeTruthy();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate verification and disables controls while the request is pending", async () => {
    let finish!: () => void;
    const verify = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await registerWithCode({ onVerifyEmailCode: verify });
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "12345678" } });
    const form = screen.getByRole("button", { name: "验证并登录" }).closest("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(verify).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("验证码") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "更换邮箱" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish());
  });

  it("enforces a sixty-second resend cooldown and retains the code after resend failure", async () => {
    vi.useFakeTimers();
    const resend = vi.fn(async () => { throw new Error("发送较频繁，请稍后再试。"); });
    await registerWithCode({ onResendConfirmation: resend });
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "12345678" } });
    expect((screen.getByRole("button", { name: /\d+ 秒后可重发/ }) as HTMLButtonElement).disabled).toBe(true);
    for (let second = 0; second < 61; second += 1) await act(async () => vi.advanceTimersByTimeAsync(1000));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "重新发送确认邮件" })));
    expect(resend).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("验证码") as HTMLInputElement).value).toBe("12345678");
    expect(screen.getByRole("alert").textContent).toContain("发送较频繁");
    expect((screen.getByRole("button", { name: "重新发送确认邮件" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("starts another sixty-second cooldown only after resend succeeds", async () => {
    vi.useFakeTimers();
    const values = await registerWithCode();
    for (let second = 0; second < 61; second += 1) await act(async () => vi.advanceTimersByTimeAsync(1000));
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "12345678" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "重新发送确认邮件" })));
    expect(values.onResendConfirmation).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: /\d+ 秒后可重发/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("验证码") as HTMLInputElement).value).toBe("");
  });

  it("lets the user change email and clears the old code and password", async () => {
    await registerWithCode();
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "更换邮箱" }));
    expect((screen.getByLabelText("云库邮箱") as HTMLInputElement).value).toBe("member@example.com");
    expect((screen.getByLabelText("云库密码") as HTMLInputElement).value).toBe("");
    expect(screen.queryByLabelText("验证码")).toBeNull();
    expect(screen.getByRole("button", { name: "注册云库" })).toBeTruthy();
  });

  it("offers code verification when login returns email_not_confirmed", async () => {
    render(<CloudConnectionPanel {...props({ connections: [managedConnection], activeId: managedConnection.id, onLogin: vi.fn(async () => { throw Object.assign(new Error("邮箱尚未确认，请打开注册邮件中的链接。"), { code: "email_not_confirmed" }); }), onVerifyEmailCode: vi.fn(async () => undefined) })} managedConnectionId={managedConnection.id} />);
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "member@example.com" } });
    fireEvent.change(screen.getByLabelText("云库密码"), { target: { value: "password" } });
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "登录云库" }).closest("form")!));
    expect(screen.getByLabelText("验证码")).toBeTruthy();
    expect(screen.queryByLabelText("云库密码")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("验证码邮件并输入验证码");
    expect(screen.getByRole("alert").textContent).not.toContain("链接");
  });

  it("keeps legacy confirmation flow without an OTP callback", async () => {
    await registerWithCode({ onVerifyEmailCode: undefined });
    expect(screen.queryByLabelText("验证码")).toBeNull();
    expect(screen.getByRole("button", { name: "返回登录" })).toBeTruthy();
  });
});

describe("CloudConnectionPanel", () => {
  it("offers email resend only after confirmation is needed and does not submit a password", async () => {
    const connection = { id: "lattice-managed", name: "Lattice 云库", apiUrl: "https://cloud.example.com", supabaseUrl: "https://db.supabase.co", publicKey: "sb_publishable_test", maxFileBytes: 1000 };
    const onResendConfirmation = vi.fn(async () => undefined);
    const values = props({ connections: [connection], activeId: connection.id, onResendConfirmation, onVerifyEmailCode: vi.fn(async () => undefined) });
    render(<CloudConnectionPanel {...values} managedConnectionId={connection.id} confirmation={{ tone: "error", message: "确认链接已过期或已使用。" }} />);
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "member@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "重新发送确认邮件" }));
    await waitFor(() => expect(onResendConfirmation).toHaveBeenCalledWith("member@example.com"));
    expect(values.onLogin).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("最新邮件"));
  });
  it("moves registration into an explicit email-confirmation step", async () => {
    const connection = { id: "lattice-managed", name: "Lattice 云库", apiUrl: "https://cloud.example.com", supabaseUrl: "https://db.supabase.co", publicKey: "sb_publishable_test", maxFileBytes: 1000 };
    const onRegister = vi.fn(async () => ({ confirmationRequired: true, confirmationSent: true }));
    const onResendConfirmation = vi.fn(async () => undefined);
    const values = props({ connections: [connection], activeId: connection.id, onRegister, onResendConfirmation });
    render(<CloudConnectionPanel {...values} managedConnectionId={connection.id} />);
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "member@example.com" } });
    fireEvent.change(screen.getByLabelText("云库密码"), { target: { value: "new-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "注册云库" }).closest("form")!);
    await waitFor(() => expect(onRegister).toHaveBeenCalledWith("member@example.com", "new-password"));
    expect(values.onLogin).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("确认邮件");
    expect(screen.getByText("第 2 步，共 3 步")).toBeTruthy();
    expect(screen.getByText("member@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新发送确认邮件" }));
    await waitFor(() => expect(onResendConfirmation).toHaveBeenCalledWith("member@example.com"));
    fireEvent.click(screen.getByRole("button", { name: "返回登录" }));
    expect(screen.getByLabelText("云库密码")).toBeTruthy();
  });

  it("does not claim a confirmation email was sent when the auth response has no send timestamp", async () => {
    const connection = { id: "lattice-managed", name: "Lattice 云库", apiUrl: "https://cloud.example.com", supabaseUrl: "https://db.supabase.co", publicKey: "sb_publishable_test", maxFileBytes: 1000 };
    const values = props({ connections: [connection], activeId: connection.id, onRegister: vi.fn(async () => ({ confirmationRequired: true, confirmationSent: false })), onResendConfirmation: vi.fn(async () => undefined) });
    render(<CloudConnectionPanel {...values} managedConnectionId={connection.id} />);
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "member@example.com" } });
    fireEvent.change(screen.getByLabelText("云库密码"), { target: { value: "new-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "注册云库" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("heading", { name: "检查邮箱或登录" })).toBeTruthy());
    expect(screen.queryByText("确认邮件已发送，请打开最新邮件中的链接。")).toBeNull();
  });

  it("treats an omitted send result as unknown without claiming a sent email", async () => {
    const connection = { id: "lattice-managed", name: "Lattice 云库", apiUrl: "https://cloud.example.com", supabaseUrl: "https://db.supabase.co", publicKey: "sb_publishable_test", maxFileBytes: 1000 };
    render(<CloudConnectionPanel {...props({ connections: [connection], activeId: connection.id, onRegister: vi.fn(async () => ({ confirmationRequired: true })) })} managedConnectionId={connection.id} />);
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "member@example.com" } });
    fireEvent.change(screen.getByLabelText("云库密码"), { target: { value: "new-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "注册云库" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("heading", { name: "检查邮箱或登录" })).toBeTruthy());
    expect(screen.queryByText("确认邮件已发送，请打开最新邮件中的链接。")).toBeNull();
  });

  it("distinguishes an unconfirmed existing account from a newly sent confirmation", async () => {
    const connection = { id: "lattice-managed", name: "Lattice 云库", apiUrl: "https://cloud.example.com", supabaseUrl: "https://db.supabase.co", publicKey: "sb_publishable_test", maxFileBytes: 1000 };
    const onResendConfirmation = vi.fn(async () => undefined);
    const values = props({ connections: [connection], activeId: connection.id, onLogin: vi.fn(async () => { throw Object.assign(new Error("邮箱尚未确认"), { code: "email_not_confirmed" }); }), onResendConfirmation });
    render(<CloudConnectionPanel {...values} managedConnectionId={connection.id} />);
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "existing@example.com" } });
    fireEvent.change(screen.getByLabelText("云库密码"), { target: { value: "password" } });
    fireEvent.submit(screen.getByRole("button", { name: "登录云库" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("这个账号还没有完成邮箱确认。重新发送确认邮件，打开最新邮件中的链接后返回登录。")).toBeTruthy());
    expect(screen.queryByText("确认邮件已发送，请打开最新邮件中的链接。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新发送确认邮件" }));
    await waitFor(() => expect(onResendConfirmation).toHaveBeenCalledWith("existing@example.com"));
  });
  it("shows only product sign-in for a managed service, with no vendor setup or required invite", () => {
    const connection = { id: "lattice-managed", name: "Lattice 云库", apiUrl: "https://cloud.example.com", supabaseUrl: "https://db.supabase.co", publicKey: "sb_publishable_test", maxFileBytes: 1000 };
    render(<CloudConnectionPanel {...props({ connections: [connection], activeId: connection.id })} managedConnectionId={connection.id} />);
    expect(screen.getByLabelText("云库邮箱")).toBeTruthy();
    expect(screen.getByRole("button", { name: "登录云库" })).toBeTruthy();
    expect(screen.queryByLabelText("云库连接")).toBeNull();
    expect(screen.queryByLabelText("云库邀请链接或配置")).toBeNull();
    expect(screen.queryByRole("button", { name: "连接设置" })).toBeNull();
    expect(screen.queryByLabelText("Worker API URL")).toBeNull();
  });
  it("opens invitation connection only when joining another library explicitly", () => {
    render(<CloudConnectionPanel {...props()} />);
    expect(screen.queryByLabelText("云库邀请链接或配置")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "加入其他云库" }));
    expect(screen.getByLabelText("云库邀请链接或配置")).toBeTruthy();
    expect(screen.getByRole("button", { name: "解析并连接" })).toBeTruthy();
    expect(screen.queryByLabelText("Worker API URL")).toBeNull();
  });

  it("saves a pasted invite as a validated connection", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<CloudConnectionPanel {...props({ onSave })} />);
    fireEvent.click(screen.getByRole("button", { name: "加入其他云库" }));
    fireEvent.change(screen.getByLabelText("云库邀请链接或配置"), { target: { value: invite } });
    fireEvent.click(screen.getByRole("button", { name: "解析并连接" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls as unknown as Array<[CloudLibraryConnection]>)[0][0]).toMatchObject({
      name: "量子小组",
      apiUrl: "https://api.example.com",
      supabaseUrl: "https://project.supabase.co",
      publicKey: "sb_publishable_test",
    });
  });

  it("keeps self-hosted fields behind the advanced disclosure", () => {
    render(<CloudConnectionPanel {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "高级连接设置" }));
    expect(screen.getByLabelText("Worker API URL")).toBeTruthy();
    expect(screen.getByLabelText("Supabase 项目 URL")).toBeTruthy();
  });

  it("pasting another service never replaces the selected connection", async () => {
    const saved = { id: "selected", name: "Old", apiUrl: "https://old.example", supabaseUrl: "https://old.supabase.co", publicKey: "sb_publishable_old", maxFileBytes: 1000 };
    const onSave = vi.fn(async () => undefined);
    render(<CloudConnectionPanel {...props({ connections: [saved], activeId: saved.id, onSave })} />);
    fireEvent.click(screen.getByRole("button", { name: "加入其他云库" }));
    fireEvent.change(screen.getByLabelText("云库邀请链接或配置"), { target: { value: invite } });
    fireEvent.click(screen.getByRole("button", { name: "解析并连接" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls as unknown as Array<[CloudLibraryConnection]>)[0][0].id).not.toBe(saved.id);
  });

  it("forwards the invitation and library after saving the scoped service", async () => {
    const onInvitation = vi.fn();
    const link = `${invite}&invite=token&library=lib-123`;
    render(<CloudConnectionPanel {...props({ onInvitation })} />);
    fireEvent.click(screen.getByRole("button", { name: "加入其他云库" }));
    fireEvent.change(screen.getByLabelText("云库邀请链接或配置"), { target: { value: link } });
    fireEvent.click(screen.getByRole("button", { name: "解析并连接" }));
    await waitFor(() => expect(onInvitation).toHaveBeenCalledWith("token", "lib-123", expect.any(String)));
  });

  it("lets a logged-in user paste another invitation explicitly", () => {
    render(<CloudConnectionPanel {...props({ userId: "member" })} />);
    expect(screen.queryByLabelText("云库邀请链接或配置")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "加入其他云库" }));
    expect(screen.getByLabelText("云库邀请链接或配置")).toBeTruthy();
    expect(screen.queryByLabelText("Worker API URL")).toBeNull();
  });

  it("shows a short error and keeps the input after malformed paste", async () => {
    render(<CloudConnectionPanel {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "加入其他云库" }));
    const input = screen.getByLabelText("云库邀请链接或配置");
    fireEvent.change(input, { target: { value: "not a cloud invite" } });
    fireEvent.click(screen.getByRole("button", { name: "解析并连接" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("无法识别"));
    expect((input as HTMLTextAreaElement).value).toBe("not a cloud invite");
  });
});
