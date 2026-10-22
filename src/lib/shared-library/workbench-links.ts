import type { CloudFileTabState, PaneId } from "@/types/layout";
import type { Item } from "./domain";
import { cloudProviderForTab } from "./workbench-source";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

/** Resolve document links inside the same library; never fall through to a local root. */
export async function openCloudRelativeLink(tab: CloudFileTabState, target: string, paneId: PaneId): Promise<void> {
  if (/^https?:\/\//i.test(target)) { useWorkspaceStore.getState().openWebUrlInPane(paneId, target); return; }
  if (/^(?:mailto|tel):/i.test(target)) { window.open(target, "_blank", "noopener,noreferrer"); return; }
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) throw new Error("无法在此云库解析该链接。");
  const provider = cloudProviderForTab(tab);
  const source = useCloudWorkbenchStore.getState();
  if (source.scope !== tab.cloud.scope) throw new Error("请先连接此文件所属云库。");
  const all = source.controller?.getSnapshot().items.filter(item => item.libraryId === tab.cloud.libraryId && item.status !== "trashed") ?? [];
  const current = all.find(item => item.id === tab.cloud.itemId);
  let parent = typeof current?.metadata.parentItemId === "string" ? current.metadata.parentItemId : undefined;
  const [path, hash] = target.split("#", 2);
  const segments = decodeURIComponent(path).replace(/\\/g, "/").split("/");
  if (path.startsWith("/")) parent = undefined;
  let match: Item | undefined = current;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      const folder = all.find(item => item.id === parent);
      parent = typeof folder?.metadata.parentItemId === "string" ? folder.metadata.parentItemId : undefined;
      continue;
    }
    const entries = await provider.list(tab.cloud.libraryId, parent);
    const matches = entries.filter(item => item.canonicalName === segment);
    if (matches.length !== 1) throw new Error(`云库中未找到唯一文件：${path}`);
    match = matches[0]; parent = match.id;
  }
  if (!match) throw new Error(`云库中未找到文件：${path}`);
  await source.openItem(match.id, { paneId, libraryId: tab.cloud.libraryId,
    anchor: hash && /^page=\d+$/.test(hash) ? { page: Number(hash.slice(5)) } : undefined });
}
