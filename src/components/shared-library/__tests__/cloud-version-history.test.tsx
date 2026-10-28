import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudVersionHistory } from "../cloud-version-history";
import type { ItemVersion } from "@/lib/shared-library/domain";

afterEach(cleanup);
const versions: ItemVersion[] = [
  { id: "v2", itemId: "file", versionNumber: 2, contentHash: "hash-two", manifest: {}, createdBy: "bob", createdAt: "2026-10-27T08:00:00Z", baseVersionId: "v1" },
  { id: "v1", itemId: "file", versionNumber: 1, contentHash: "hash-one", manifest: {}, createdBy: "alice", createdAt: "2026-10-26T08:00:00Z" },
];
function setup(overrides: Partial<Parameters<typeof CloudVersionHistory>[0]> = {}) {
  const props = { fileName: "shared.md", currentVersionId: "v2", currentText: "common\nnew", authorNames: { alice: "小林", bob: "小周" },
    canRestore: true, loadVersions: vi.fn(async () => versions),
    readVersion: vi.fn(async () => ({ kind: "text" as const, text: "common\nold", mimeType: "text/markdown", updatedAt: "2026-10-26" })),
    onRestore: vi.fn(async () => {}), onClose: vi.fn(), ...overrides };
  render(<CloudVersionHistory {...props} />); return props;
}
describe("cloud file history", () => {
  it("previews the exact version referenced by an activity event on open", async () => {
    const props = setup({ initialVersionId: 'v1' });
    await screen.findByText(/old$/);
    expect(props.readVersion).toHaveBeenCalledWith('v1', expect.any(AbortSignal));
    expect(props.onRestore).not.toHaveBeenCalled();
  });
  it("shows attribution and compares historical content without applying it", async () => {
    const props = setup();
    fireEvent.click(await screen.findByRole("button", { name: /v1.*小林/ }));
    await screen.findByText(/old$/);
    expect(screen.getByText("小周")).toBeTruthy();
    expect(screen.getByText("当前版本")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "与当前版本比较" }));
    expect(screen.getByTestId("cloud-history-diff").textContent).toContain("old");
    expect(screen.getByTestId("cloud-history-diff").textContent).toContain("new");
    expect(props.onRestore).not.toHaveBeenCalled();
  });
  it("requires a concrete confirmation before creating a new restored version", async () => {
    const props = setup();
    fireEvent.click(await screen.findByRole("button", { name: /v1.*小林/ }));
    await screen.findByText(/old$/);
    fireEvent.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(props.onRestore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "恢复为新版本" }));
    await waitFor(() => expect(props.onRestore).toHaveBeenCalledWith("v1"));
  });
  it("keeps read-only history accessible while preventing restore over a draft", async () => {
    const props = setup({ restoreBlockedReason: "其他分栏有未保存修改，请先保存。" });
    fireEvent.click(await screen.findByRole("button", { name: /v1.*小林/ }));
    await screen.findByText(/old$/);
    expect((screen.getByRole("button", { name: "恢复此版本" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("其他分栏有未保存修改，请先保存。")).toBeTruthy();
    expect(props.onRestore).not.toHaveBeenCalled();
  });
  it("ignores a retired preview request after selecting another version", async () => {
    let resolveOld!: (content: { kind: "text"; text: string; mimeType: string; updatedAt: string }) => void;
    setup({ readVersion: vi.fn((id: string) => id === "v1" ? new Promise<{ kind: "text"; text: string; mimeType: string; updatedAt: string }>(resolve => { resolveOld = resolve; }) : Promise.resolve({ kind: "text" as const, text: "latest-preview", mimeType: "text/plain", updatedAt: "" })) });
    fireEvent.click(await screen.findByRole("button", { name: /v1.*小林/ }));
    fireEvent.click(screen.getByRole("button", { name: /v2.*小周/ }));
    await screen.findByText("latest-preview");
    resolveOld({ kind: "text", text: "retired-preview", mimeType: "text/plain", updatedAt: "" });
    await waitFor(() => expect(screen.queryByText("retired-preview")).toBeNull());
  });
});
