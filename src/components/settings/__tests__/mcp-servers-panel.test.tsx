/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { McpServersPanel } from "../mcp-servers-panel";

beforeEach(() => setLocale("en-US"));
afterEach(() => { cleanup(); setLocale("zh-CN"); });

describe("McpServersPanel", () => {
  it("switches field and validation labels without losing an unfinished server", () => {
    const onChange = vi.fn();
    render(<McpServersPanel servers={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("MCP server name"), { target: { value: "我的研究服务" } });
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    expect(screen.getByRole("alert").textContent).toContain("HTTPS");
    act(() => setLocale("zh-CN"));
    expect((screen.getByLabelText("MCP 服务名称") as HTMLInputElement).value).toBe("我的研究服务");
    expect(screen.getByRole("alert").textContent).toBe("请输入名称和 HTTPS MCP 地址。");
    expect(screen.getByRole("button", { name: "添加 MCP 服务" })).toBeTruthy();
    expect(screen.queryByText("MCP Servers")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("adds and removes a validated streamable HTTP server", async () => {
    const onChange = vi.fn();
    function Harness() {
      const [servers, setServers] = useState<Parameters<typeof onChange>[0]>([]);
      return <McpServersPanel servers={servers} onChange={(next) => { onChange(next); setServers(next); }} />;
    }
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("MCP server name"), { target: { value: "Research tools" } });
    fireEvent.change(screen.getByLabelText("MCP server URL"), { target: { value: "https://example.com/mcp" } });
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: "Research tools", transport: "streamable-http" })]));
    expect(screen.getByText("Research tools")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete Research tools" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
