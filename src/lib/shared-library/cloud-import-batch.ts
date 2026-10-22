import { validateCloudPath } from "./connection";

export interface CloudImportFailure { file: File; path: string; error: string }
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
