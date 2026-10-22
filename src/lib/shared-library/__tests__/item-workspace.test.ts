import { describe, expect, it } from "vitest";
import { ItemWorkspaceRegistry, type ItemWorkspaceAdapter } from "../item-workspace";

const pdfAdapter: ItemWorkspaceAdapter = {
  kind: "pdf",
  label: "PDF",
  renderViewer: () => "pdf-viewer",
};

const fallbackAdapter: ItemWorkspaceAdapter = {
  kind: "*",
  label: "Generic",
  renderViewer: () => "generic-viewer",
};

describe("item workspace registry", () => {
  it("resolves an adapter by item kind", () => {
    const registry = new ItemWorkspaceRegistry().register(pdfAdapter);
    expect(registry.get("pdf")).toBe(pdfAdapter);
  });

  it("returns the fallback adapter for unknown kinds", () => {
    const registry = new ItemWorkspaceRegistry()
      .register(pdfAdapter)
      .setFallback(fallbackAdapter);
    expect(registry.get("notebook")).toBe(fallbackAdapter);
  });

  it("reports whether a kind has a dedicated adapter", () => {
    const registry = new ItemWorkspaceRegistry().register(pdfAdapter);
    expect(registry.has("pdf")).toBe(true);
    expect(registry.has("code")).toBe(false);
  });

  it("lets a later registration override an earlier one", () => {
    const first: ItemWorkspaceAdapter = {
      kind: "pdf",
      label: "PDF v1",
      renderViewer: () => "v1",
    };
    const second: ItemWorkspaceAdapter = {
      kind: "pdf",
      label: "PDF v2",
      renderViewer: () => "v2",
    };
    const registry = new ItemWorkspaceRegistry().register(first).register(second);
    expect(registry.get("pdf")).toBe(second);
  });

  it("lists registered adapters in registration order", () => {
    const registry = new ItemWorkspaceRegistry().register(pdfAdapter);
    expect(registry.list().map((adapter) => adapter.kind)).toEqual(["pdf"]);
  });
});
