import { beforeEach, describe, expect, it } from "vitest";
import { useVSCodeWorkbenchStore } from "@/stores/vscode-workbench-store";

describe("VS Code Workbench request store", () => {
  beforeEach(() => {
    useVSCodeWorkbenchStore.getState().reset();
  });

  it("coalesces rapid file opens so the latest request wins", () => {
    const first = useVSCodeWorkbenchStore.getState().queueResource({
      path: "C:/workspace/a.ts",
      kind: "text",
    });
    const second = useVSCodeWorkbenchStore.getState().queueResource({
      path: "C:/workspace/b.ts",
      kind: "text",
    });

    expect(second.requestId).toBeGreaterThan(first.requestId);
    expect(useVSCodeWorkbenchStore.getState().pendingResource).toEqual(second);
  });

  it("does not let a stale acknowledgement clear a newer request", () => {
    const first = useVSCodeWorkbenchStore.getState().queueResource({
      path: "C:/workspace/a.ts",
      kind: "text",
    });
    const second = useVSCodeWorkbenchStore.getState().queueResource({
      path: "C:/workspace/b.ts",
      kind: "text",
    });

    useVSCodeWorkbenchStore.getState().markDispatching(first.requestId);
    useVSCodeWorkbenchStore.getState().acknowledge(first.requestId);
    expect(useVSCodeWorkbenchStore.getState().pendingResource).toEqual(second);

    useVSCodeWorkbenchStore.getState().markDispatching(second.requestId);
    useVSCodeWorkbenchStore.getState().acknowledge(second.requestId);
    expect(useVSCodeWorkbenchStore.getState().pendingResource).toBeNull();
    expect(useVSCodeWorkbenchStore.getState().lastAcknowledgedRequestId).toBe(second.requestId);
  });

  it("resets pending transport state when the workspace changes", () => {
    const request = useVSCodeWorkbenchStore.getState().queueResource({
      path: "C:/workspace/analysis.ipynb",
      kind: "notebook",
    });
    useVSCodeWorkbenchStore.getState().markDispatching(request.requestId);
    useVSCodeWorkbenchStore.getState().fail(request.requestId, "bridge unavailable");
    useVSCodeWorkbenchStore.getState().reset();

    expect(useVSCodeWorkbenchStore.getState()).toMatchObject({
      pendingResource: null,
      dispatchingRequestId: null,
      lastAcknowledgedRequestId: 0,
      lastError: null,
    });
  });
});
