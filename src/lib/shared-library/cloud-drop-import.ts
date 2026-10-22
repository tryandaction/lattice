import { validateCloudPath } from "./connection";

/** Browsers expose only the explicitly dropped entry capability; native paths are never inferred. */
export async function collectCloudDropFiles(transfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  const entries = Array.from(transfer.items ?? []).filter(item => item.kind === "file").map(item => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!entries.length) return Array.from(transfer.files);
  async function visit(entry: FileSystemEntry, prefix: string) {
    const path = validateCloudPath(prefix ? `${prefix}/${entry.name}` : entry.name);
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      Object.defineProperty(file, "webkitRelativePath", { value: path, configurable: true });
      files.push(file);
      return;
    }
    if (!entry.isDirectory) throw new Error("拖入项不是普通文件或目录。");
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!children.length) break;
      for (const child of children) await visit(child, path);
    }
  }
  for (const entry of entries) await visit(entry, "");
  return files;
}
