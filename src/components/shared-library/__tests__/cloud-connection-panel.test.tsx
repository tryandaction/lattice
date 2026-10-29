/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("CloudConnectionPanel", () => {
  it("offers email resend only after confirmation is needed and does not submit a password", async () => {
    const connection = { id: "lattice-managed", name: "Lattice 云库", apiUrl: "https://cloud.example.com", supabaseUrl: "https://db.supabase.co", publicKey: "sb_publishable_test", maxFileBytes: 1000 };
    const onResendConfirmation = vi.fn(async () => undefined);
    const values = props({ connections: [connection], activeId: connection.id, onResendConfirmation });
    render(<CloudConnectionPanel {...values} managedConnectionId={connection.id} confirmation={{ tone: "error", message: "确认链接已过期或已使用。" }} />);
    fireEvent.change(screen.getByLabelText("云库邮箱"), { target: { value: "member@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "重新发送确认邮件" }));
    await waitFor(() => expect(onResendConfirmation).toHaveBeenCalledWith("member@example.com"));
    expect(values.onLogin).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("最新邮件");
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
    await waitFor(() => expect(screen.getByText("这个账号还没有完成邮箱确认。点击重新发送确认邮件，然后打开最新邮件中的链接。")).toBeTruthy());
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
