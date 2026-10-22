/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { MemberManagement } from "@/components/shared-library/member-management";
import type { LibraryMember, LibraryRole } from "@/lib/shared-library/domain";

function member(overrides: Partial<LibraryMember> = {}): LibraryMember {
  return {
    libraryId: "lib-1",
    userId: "user-2",
    role: "viewer",
    status: "active",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("MemberManagement", () => {
  beforeEach(() => setLocale("en-US"));
  afterEach(() => act(() => setLocale("zh-CN")));
  it("lets an owner invite, change roles, suspend and revoke with impact scope shown", () => {
    const onInvite = vi.fn();
    const onChangeRole = vi.fn();
    const onSuspend = vi.fn();
    const onRevoke = vi.fn();

    render(
      <MemberManagement
        members={[member({ role: "viewer" }), member({ userId: "user-1", role: "owner" })]}
        currentUserId="user-1"
        viewerRole="owner"
        onInvite={onInvite}
        onChangeRole={onChangeRole}
        onSuspend={onSuspend}
        onRevoke={onRevoke}
      />,
    );

    expect(screen.getByTestId("member-management")).toBeTruthy();
    expect(screen.getByTestId("member-invite-form")).toBeTruthy();
    expect(screen.getAllByTestId("member-row").length).toBe(2);

    fireEvent.change(screen.getByTestId("member-invite-email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByTestId("member-invite-role"), {
      target: { value: "editor" },
    });
    fireEvent.click(screen.getByTestId("member-invite-submit"));
    expect(onInvite).toHaveBeenCalledWith("new@example.com", "editor");

    fireEvent.change(screen.getByLabelText("Role for user-2"), { target: { value: "commenter" } });
    expect(onChangeRole).toHaveBeenCalledWith("user-2", "commenter");

    fireEvent.click(screen.getByTestId("member-suspend-user-2"));
    expect(onSuspend).toHaveBeenCalledWith("user-2");

    fireEvent.click(screen.getByTestId("member-revoke-user-2"));
    expect(onRevoke).toHaveBeenCalledWith("user-2");
  });

  it("hides management controls from the member being managed and from self", () => {
    render(
      <MemberManagement
        members={[member({ userId: "user-1", role: "owner" })]}
        currentUserId="user-1"
        viewerRole="owner"
      />,
    );

    expect(screen.queryByTestId("member-change-role-user-1")).toBeNull();
    expect(screen.queryByTestId("member-suspend-user-1")).toBeNull();
    expect(screen.queryByTestId("member-revoke-user-1")).toBeNull();
  });

  it("viewers see the member list but no management entry points", () => {
    render(
      <MemberManagement
        members={[member(), member({ userId: "user-3", role: "editor" })]}
        currentUserId="user-2"
        viewerRole="viewer"
      />,
    );

    expect(screen.getAllByTestId("member-row").length).toBe(2);
    expect(screen.queryByTestId("member-invite-form")).toBeNull();
    expect(screen.queryByTestId("member-change-role-user-3")).toBeNull();
    expect(screen.queryByTestId("member-suspend-user-3")).toBeNull();
    expect(screen.queryByTestId("member-revoke-user-3")).toBeNull();
  });

  it("shows role labels and impact scope text", () => {
    render(
      <MemberManagement
        members={[member({ role: "viewer" })]}
        currentUserId="user-1"
        viewerRole="owner"
      />,
    );

    expect(screen.getByTestId("member-role").textContent).toContain("Viewer");
    expect(screen.getByText(/Removes access to all shared content/i)).toBeTruthy();
  });
});

describe("member role ladder", () => {
  it("exposes the next role in the promotion ladder", () => {
    const { nextMemberRole } = MemberManagement as unknown as {
      nextMemberRole?: (role: LibraryRole) => LibraryRole;
    };
    expect(nextMemberRole?.("viewer")).toBe("commenter");
    expect(nextMemberRole?.("editor")).toBe("admin");
    expect(nextMemberRole?.("admin")).toBe("admin");
  });
});
