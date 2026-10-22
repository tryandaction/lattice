import { describe, expect, it } from "vitest";
import { normalizeMcpServerConfig, validateMcpServerConfig } from "../mcp-config";

describe("MCP server configuration", () => {
  it("accepts stdio and streamable HTTP configurations", () => {
    expect(validateMcpServerConfig({ id: "local", name: "Local tools", transport: "stdio", command: "npx", args: ["server"], enabled: true, approval: "ask" }).ok).toBe(true);
    expect(validateMcpServerConfig({ id: "remote", name: "Remote", transport: "streamable-http", url: "https://example.com/mcp", enabled: false, approval: "always" }).ok).toBe(true);
  });

  it("rejects incomplete or unsafe server configuration", () => {
    expect(validateMcpServerConfig({ id: "", name: "", transport: "stdio", enabled: true, approval: "ask" }).ok).toBe(false);
    expect(validateMcpServerConfig({ id: "remote", name: "Remote", transport: "streamable-http", url: "file:///secret", enabled: true, approval: "ask" }).ok).toBe(false);
  });

  it("normalizes permissions and removes unknown fields", () => {
    expect(normalizeMcpServerConfig({ id: "remote", name: " Remote ", transport: "streamable-http", url: "https://example.com/mcp", enabled: true, approval: "ask", tools: ["read", "read", ""], resources: ["notes"], prompts: ["summarize"], extra: "ignored" } as never)).toEqual(expect.objectContaining({ id: "remote", name: "Remote", tools: ["read"], resources: ["notes"], prompts: ["summarize"] }));
  });
});
