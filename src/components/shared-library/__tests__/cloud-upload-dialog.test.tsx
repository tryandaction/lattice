import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudUploadDialog } from "../cloud-upload-dialog";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import type { CloudImportEntry } from "@/lib/shared-library/cloud-import-batch";

const entry = (state: CloudImportEntry["state"], patch: Partial<CloudImportEntry> = {}): CloudImportEntry => ({ id: state, file: new File(["a"], `${state}.md`), path: `folder/${state}.md`, state, ...patch });
describe("CloudUploadDialog", () => {
  beforeEach(() => { useCloudWorkbenchStore.getState().bindController(null); useCloudWorkbenchStore.setState({ error: null }); });
  it("shows pending file capabilities as awaiting login rather than uploaded", () => {
    render(<CloudUploadDialog open onClose={vi.fn()} onFiles={vi.fn()} pendingFiles={[new File(["a"], "draft.md")]} preparationLabel="登录后自动上传到我的云端库" />);
    expect(screen.getByText("draft.md")).toBeTruthy(); expect(screen.getByText("登录后自动上传到我的云端库")).toBeTruthy();
    expect(screen.getByText("尚未上传")).toBeTruthy(); expect(screen.queryByText("云端已保存")).toBeNull();
  });
  it("distinguishes durable queue from cloud success and exposes individual errors and retry", () => {
    const retryUpload = vi.fn(async () => {});
    useCloudWorkbenchStore.setState({ uploadEntries: [entry("queued"), entry("synced"), entry("failed", { error: "存储空间不足" })], retryUpload });
    render(<CloudUploadDialog open onClose={vi.fn()} onFiles={vi.fn()} />);
    expect(screen.getByText("本机已保存 · 等待同步")).toBeTruthy(); expect(screen.getByText("云端已保存")).toBeTruthy();
    expect(screen.getByText("存储空间不足")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试 folder/failed.md" })); expect(retryUpload).toHaveBeenCalledWith("failed");
  });
  it("keeps upload work alive when closed and provides a separate cancel operation", () => {
    const onClose = vi.fn(); const cancelUpload = vi.fn();
    useCloudWorkbenchStore.setState({ uploading: true, uploadEntries: [entry("reading")], cancelUpload });
    render(<CloudUploadDialog open onClose={onClose} onFiles={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "取消剩余上传" })); expect(cancelUpload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "关闭上传" })); expect(onClose).toHaveBeenCalledTimes(1);
  });
});
