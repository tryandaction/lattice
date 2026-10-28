import { validateCloudPath } from "./connection";

export interface CloudImportFailure { file: File; path: string; error: string }
export type CloudImportState = "pending" | "reading" | "queued" | "synced" | "failed" | "cancelled" | "paused" | "conflicted";
export interface CloudImportEntry {
  id: string;
  file: File;
  path: string;
  state: CloudImportState;
  error?: string;
  libraryId?: string;
  parentItemId?: string;
  itemId?: string;
  relatedItemIds?: string[];
}

/** File capabilities stay in memory until their bytes have entered the durable outbox. */
export function createCloudImportBatch(files: File[], maxFileBytes: number, remainingBytes?: number): CloudImportEntry[] {
  const seen = new Set<string>();
  const entries = files.map((file): CloudImportEntry => {
    const entry: CloudImportEntry = { id: crypto.randomUUID(), file, path: file.webkitRelativePath || file.name, state: "pending" };
    try {
      entry.path = validateCloudPath(entry.path);
      if (seen.has(entry.path)) throw new Error("上传列表存在重复路径；未覆盖同名文件。");
      seen.add(entry.path);
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxFileBytes) throw new Error("文件超出单文件限额，未读取或上传。");
    } catch (error) { entry.state = "failed"; entry.error = error instanceof Error ? error.message : String(error); }
    return entry;
  });
  const total = entries.filter(entry => entry.state === "pending").reduce((sum, entry) => sum + entry.file.size, 0);
  if (!Number.isSafeInteger(total) || (remainingBytes !== undefined && total > remainingBytes)) {
    for (const entry of entries) if (entry.state === "pending") { entry.state = "failed"; entry.error = "文件超过库剩余额度；原文件未上传。"; }
  }
  return entries;
}
export function validateCloudImportBatch(files: File[], maxFileBytes: number, remainingBytes?: number): string[] {
  const paths = files.map(file => validateCloudPath(file.webkitRelativePath || file.name));
  if (new Set(paths).size !== paths.length) throw new Error("上传列表存在重复路径。");
  if (files.some(file => !Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxFileBytes)) throw new Error("上传含超出单文件限额的文件。");
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (!Number.isSafeInteger(total) || (remainingBytes !== undefined && total > remainingBytes)) throw new Error("文件超过库剩余额度；原文件未上传。");
  return paths;
}

/** Successfully persisted files are never retried when one local read fails. */
export async function persistCloudImportBatch(files: File[], paths: string[], persist: (file: File, path: string) => Promise<void>, cancelled: () => boolean): Promise<{ completed: number; failures: CloudImportFailure[] }> {
  let completed = 0;
  const failures: CloudImportFailure[] = [];
  for (let index = 0; index < files.length; index++) {
    if (cancelled()) {
      failures.push(...files.slice(index).map((file, offset) => ({ file, path: paths[index + offset], error: "已暂停" })));
      break;
    }
    try { await persist(files[index], paths[index]); completed++; }
    catch (error) { failures.push({ file: files[index], path: paths[index], error: error instanceof Error ? error.message : String(error) }); }
  }
  return { completed, failures };
}
