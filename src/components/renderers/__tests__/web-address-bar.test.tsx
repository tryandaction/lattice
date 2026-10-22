import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WebAddressBar } from "../web-address-bar";

describe("web address draft synchronization", () => {
  it("displays the committed final URL when navigation resolves to the previous address", () => {
    const onNavigate = vi.fn();
    const props = {
      onNavigate,
      onBack: vi.fn(),
      onForward: vi.fn(),
      onReload: vi.fn(),
      onExternal: vi.fn(),
    };
    const view = render(<WebAddressBar {...props} url="http://localhost/b" />);
    const input = screen.getByRole("textbox", { name: "网页地址" });

    fireEvent.change(input, { target: { value: "http://localhost/redirect" } });
    fireEvent.submit(input.closest("form")!);
    expect(onNavigate).toHaveBeenCalledWith("http://localhost/redirect");

    view.rerender(<WebAddressBar {...props} url="http://localhost/b" />);
    expect(input).toHaveProperty("value", "http://localhost/b");
  });

  it("keeps invalid input visible and marks it invalid without navigating", () => {
    const onNavigate = vi.fn();
    render(<WebAddressBar
      url="https://example.com/start"
      onNavigate={onNavigate}
      onBack={vi.fn()}
      onForward={vi.fn()}
      onReload={vi.fn()}
      onExternal={vi.fn()}
    />);
    const input = screen.getByRole("textbox", { name: "网页地址" });

    fireEvent.change(input, { target: { value: "file:///private/document.html" } });
    fireEvent.submit(input.closest("form")!);

    expect(input).toHaveProperty("value", "file:///private/document.html");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
