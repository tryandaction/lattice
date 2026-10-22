import { getCloudWorkspaceSnapshot } from "@/lib/cloud-workspace-host";
import { generateTabId } from "@/lib/layout-utils";
import type { CloudFileTabState } from "@/types/layout";
import type { CloudLibraryResource, CloudLibrarySourceProvider } from "./source-provider";

export function createCloudFileTab(resource: CloudLibraryResource, scope: string): CloudFileTabState {
  return {
    id: generateTabId(), kind: "cloud-file", fileName: resource.name, filePath: resource.path,
    isDirty: false, scrollPosition: 0,
    cloud: { scope, resourceId: resource.id, libraryId: resource.libraryId, itemId: resource.itemId,
      versionId: resource.versionId, mimeType: resource.content?.mimeType, role: resource.role },
  };
}

export function cloudProviderForTab(tab: CloudFileTabState): CloudLibrarySourceProvider {
  const provider = getCloudWorkspaceSnapshot().provider;
  if (!provider || !provider.scope || provider.scope !== tab.cloud.scope) {
    throw new Error("此文件的云库尚未连接，或账号已切换。请连接原云库后重新打开。");
  }
  return provider;
}

export async function readCloudFileTab(tab: CloudFileTabState, signal?: AbortSignal): Promise<CloudLibraryResource> {
  const provider = cloudProviderForTab(tab);
  const resource = await provider.read(tab.cloud.libraryId, tab.cloud.itemId, signal);
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  if (cloudProviderForTab(tab) !== provider || resource.id !== tab.cloud.resourceId) {
    throw new Error("云库身份已变化，请重新打开文件。");
  }
  if (!resource.content) throw new Error("此文件内容尚未同步，请刷新云库后重试。");
  return resource;
}

export async function saveCloudFileTab(tab: CloudFileTabState, content: string): Promise<CloudFileTabState> {
  const provider = cloudProviderForTab(tab);
  if (!tab.cloud.versionId) throw new Error("尚未取得文件版本，请重新打开后保存。");
  const savedVersion = await provider.save(tab.cloud.libraryId, tab.cloud.itemId, {
    kind: "text", text: content, mimeType: tab.cloud.mimeType ?? "text/plain", updatedAt: new Date().toISOString(),
  }, undefined, tab.cloud.versionId);
  // Refresh the version after queuing a write; the next edit must compare against
  // this version, not overwrite an intervening collaborator's revision.
  if (cloudProviderForTab(tab) !== provider) throw new Error("云库身份已变化，请重新打开文件。");
  // Keep the revision we actually wrote, even if a collaborator commits a later
  // revision while the save acknowledgment is in flight.
  if (savedVersion) return { ...tab, cloud: { ...tab.cloud, versionId: savedVersion } };
  const resource = await readCloudFileTab(tab);
  return { ...tab, fileName: resource.name, cloud: { ...tab.cloud, versionId: resource.versionId, role: resource.role } };
}
