"use client";

import { useEffect, useReducer } from "react";
import type { CloudLibraryWorkspaceController } from "@/lib/shared-library/cloud-workspace";

/** Optional host diagnostics. Includes queue counters only, never session tokens or document contents. */
export function CloudLibraryDiagnostics({ controller }: { controller: CloudLibraryWorkspaceController | null }) {
  const [, update] = useReducer(value => value + 1, 0);
  useEffect(() => controller?.subscribe(update), [controller]);
  const snapshot = controller?.getSnapshot();
  const status = controller?.getStatus();
  return <section aria-label="Cloud library diagnostics" className="grid gap-2 rounded border border-border bg-background p-3 text-xs text-foreground">
    <p>连接：{controller?.connection.name ?? "未配置"} · {status?.status ?? "local_only"}</p>
    <p>缓存条目：{snapshot?.items.length ?? 0} · 待同步：{status?.pending ?? 0} · 冲突：{snapshot?.outbox.filter(operation => operation.state === "conflicted").length ?? 0}</p>
    <p>已隔离库：{snapshot?.revoked.length ?? 0} · 已上传分片：{snapshot?.outbox.reduce((sum, operation) => sum + (operation.parts?.length ?? 0), 0) ?? 0}</p>
    {status?.error ? <p role="status" className="text-destructive">{status.error}</p> : null}
  </section>;
}
