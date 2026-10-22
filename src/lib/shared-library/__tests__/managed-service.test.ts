import { describe, expect, it } from "vitest";
import { managedCloudConnection, cloudStartupConnections } from "../managed-service";

const publicConfig = { name: "Lattice 云库", apiUrl: "https://cloud.example.com", supabaseUrl: "https://db.supabase.co", publicKey: "sb_publishable_test", maxFileBytes: 20 * 1024 * 1024 };
describe("developer-configured managed cloud service", () => {
  it("starts on the managed service without asking a user for infrastructure settings", () => {
    const managed = managedCloudConnection(JSON.stringify(publicConfig));
    const startup = cloudStartupConnections([], managed, null);
    expect(startup.activeId).toBe("lattice-managed");
    expect(startup.connections).toHaveLength(1);
    expect(managed?.apiUrl).toBe(publicConfig.apiUrl);
  });
  it("does not invent a cloud endpoint when no service has been deployed", () => {
    expect(managedCloudConnection("")).toBeNull();
    expect(cloudStartupConnections([], null, null)).toEqual({ connections: [], activeId: "" });
  });
  it("rejects private credentials and insecure deployed URLs", () => {
    expect(() => managedCloudConnection(JSON.stringify({ ...publicConfig, publicKey: "sb_secret_private" }))).toThrow();
    expect(() => managedCloudConnection(JSON.stringify({ ...publicConfig, databasePassword: "must-never-bundle" }))).toThrow();
    expect(() => managedCloudConnection(JSON.stringify({ ...publicConfig, apiUrl: "http://localhost:3000" }))).toThrow();
    expect(() => managedCloudConnection(JSON.stringify({ ...publicConfig, publicKey: "sbp_operator_access_token" }))).toThrow(/管理令牌/u);
    expect(() => managedCloudConnection(JSON.stringify({ ...publicConfig, publicKey: "arbitrary-operator-token" }))).toThrow(/管理令牌/u);
    const jwt = (role: string) => `e30.${btoa(JSON.stringify({ role }))}.c2ln`;
    expect(managedCloudConnection(JSON.stringify({ ...publicConfig, publicKey: jwt("anon") }))?.publicKey).toBe(jwt("anon"));
    expect(() => managedCloudConnection(JSON.stringify({ ...publicConfig, publicKey: jwt("service_role") }))).toThrow();
  });
  it("preserves a user's selected self-hosted service and never overwrites its identity", () => {
    const managed = managedCloudConnection(JSON.stringify(publicConfig));
    const custom = { ...managed!, id: "custom", name: "小组自托管", apiUrl: "https://team.example.com" };
    expect(cloudStartupConnections([custom], managed, custom.id)).toMatchObject({ activeId: "custom", connections: [custom, managed] });
  });
  it("updates only the managed public settings on a later app release", () => {
    const managed = managedCloudConnection(JSON.stringify(publicConfig));
    const old = { ...managed!, apiUrl: "https://old.example.com" };
    const startup = cloudStartupConnections([old], managed, old.id);
    expect(startup.connections).toEqual([managed]);
    expect(startup.activeId).toBe(old.id);
  });
});
