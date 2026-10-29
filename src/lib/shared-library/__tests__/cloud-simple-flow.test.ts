import { describe, expect, it } from "vitest";
import { cloudUploadLabel, createCloudInviteShare, retainCloudInvitation } from "../cloud-simple-flow";
import { parseCloudConnectionInput } from "../connection";

const connection = { id: "c", name: "Lab", apiUrl: "https://api.example", supabaseUrl: "https://project.supabase.co", publicKey: "sb_publishable_test", maxFileBytes: 1000 };
describe("cloud simple flow recovery", () => {
  const status = { adding: false, completed: true, failed: 0, localLabel: "正在添加", pending: 0, offline: false, paused: false, syncFailed: false };
  it("never reports cloud completion during local persistence or suspended sync", () => {
    expect(cloudUploadLabel({ ...status, adding: true })).toBe("正在添加文件…");
    expect(cloudUploadLabel({ ...status, completed: false })).not.toBe("文件已同步");
    expect(cloudUploadLabel({ ...status, offline: true })).not.toBe("文件已同步");
    expect(cloudUploadLabel({ ...status, paused: true })).not.toBe("文件已同步");
    expect(cloudUploadLabel({ ...status, syncFailed: true })).not.toBe("文件已同步");
    expect(cloudUploadLabel({ ...status, pending: 2 })).not.toBe("文件已同步");
    expect(cloudUploadLabel(status)).toBe("文件已同步");
  });
  it("does not keep the adding label after a rejected quota or path preflight", () => {
    expect(cloudUploadLabel({ ...status, adding: false, completed: false, localLabel: "正在添加文件…" })).toBe("文件尚未添加");
  });
  it("exports portable desktop invitation configuration without a shell origin", () => {
    const value = createCloudInviteShare("http://tauri.localhost/library", connection, "lib", "token");
    expect(value).not.toContain("tauri.localhost");
    expect(parseCloudConnectionInput(value)).toMatchObject({ libraryId: "lib", inviteToken: "token", apiUrl: connection.apiUrl });
    expect(value).not.toContain("maxFileBytes");
  });
  it("shares the current public entry when an invitation is created from the retired domain", () => {
    const value = createCloudInviteShare("https://lattice-apq.pages.dev/library", connection, "lib", "token");
    expect(new URL(value).origin).toBe("https://lattice-apq.pages.dev");
    expect(parseCloudConnectionInput(value)).toMatchObject({ libraryId: "lib", inviteToken: "token", apiUrl: connection.apiUrl });
  });
  it("retains consumed invitation identity after reload with the original URL", () => {
    const invitation = { token: "token", libraryId: "lib", connectionId: "c" };
    const accepted = { ...invitation, accepted: true, acceptedUserId: "user-A" };
    expect(retainCloudInvitation(invitation, accepted)).toEqual(accepted);
    expect(retainCloudInvitation({ ...invitation, connectionId: "other" }, accepted)).not.toHaveProperty("accepted");
  });
});
