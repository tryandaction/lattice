import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudLibraryWorkspace } from "../cloud-library-workspace";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function visitEntry(href: string, props: React.ComponentProps<typeof CloudLibraryWorkspace> = {}) {
  const replace = vi.fn();
  const browser = Object.create(window) as Window;
  Object.defineProperty(browser, "location", { value: { href, replace } });
  vi.stubGlobal("window", browser);
  render(<CloudLibraryWorkspace {...props} />);
  expect(replace).toHaveBeenCalledTimes(1);
  return new URL(String(replace.mock.calls[0][0]));
}

describe("static-host historical library entries", () => {
  it("retains the real library and item path when the static host serves the unparameterized library shell", () => {
    const hash = "#access_token=synthetic-access&refresh_token=synthetic-refresh&type=signup";
    const result = visitEntry(`https://app.example/library/6df89dcb-0d64-4637-b066-b8aa1e882d3f/item/83d5912e-5f7a-4190-9632-1bcb877709b7?view=annotations${hash}`);
    expect(result.pathname).toBe("/");
    expect(result.searchParams.get("library")).toBe("6df89dcb-0d64-4637-b066-b8aa1e882d3f");
    expect(result.searchParams.get("item")).toBe("83d5912e-5f7a-4190-9632-1bcb877709b7");
    expect(result.searchParams.get("source")).toBe("cloud");
    expect(result.searchParams.get("view")).toBe("annotations");
    expect(result.hash).toBe(hash);
  });
  it("decodes path ids once and preserves an invitation fragment", () => {
    const result = visitEntry("https://app.example/library/lib%2Fone/item/item%20two/#invite=synthetic-invite&library=lib%2Fone");
    expect(result.searchParams.get("library")).toBe("lib/one");
    expect(result.searchParams.get("item")).toBe("item two");
    expect(result.hash).toBe("#invite=synthetic-invite&library=lib%2Fone");
  });
  it("keeps root-query entries and placeholder exports from inventing target ids", () => {
    const result = visitEntry("https://app.example/library/__index__?library=existing&item=existing-item#methods");
    expect(result.searchParams.get("library")).toBe("existing");
    expect(result.searchParams.get("item")).toBe("existing-item");
    expect(result.hash).toBe("#methods");
  });
});
