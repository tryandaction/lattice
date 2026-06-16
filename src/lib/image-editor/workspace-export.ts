import {
  findParentDirectory,
  generateUniqueName,
  getParentPath,
  joinPath,
  sanitizeFileName,
} from "@/lib/file-operations";
import { emitVaultChange } from "@/lib/plugins/runtime";

export interface SaveImageCopyToWorkspaceOptions {
  rootHandle: FileSystemDirectoryHandle;
  sourceFilePath?: string;
  defaultFileName: string;
  blob: Blob;
}

export interface SaveImageCopyToWorkspaceResult {
  fileName: string;
  filePath: string;
}

function splitFileName(name: string): { baseName: string; extension: string } {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) {
    return { baseName: name, extension: "" };
  }

  return {
    baseName: name.slice(0, dotIndex),
    extension: name.slice(dotIndex),
  };
}

async function resolveTargetDirectory(
  rootHandle: FileSystemDirectoryHandle,
  sourceFilePath?: string,
): Promise<{ handle: FileSystemDirectoryHandle; path: string }> {
  const resolvedSourceFilePath = typeof sourceFilePath === "string" ? sourceFilePath.trim() : "";
  const parentPath = resolvedSourceFilePath ? getParentPath(resolvedSourceFilePath) : "";
  if (!parentPath) {
    return { handle: rootHandle, path: "" };
  }

  const parentDirectory = await findParentDirectory(rootHandle, resolvedSourceFilePath);
  if (parentDirectory) {
    return { handle: parentDirectory, path: parentPath };
  }

  return { handle: rootHandle, path: "" };
}

export async function saveImageCopyToWorkspace({
  rootHandle,
  sourceFilePath,
  defaultFileName,
  blob,
}: SaveImageCopyToWorkspaceOptions): Promise<SaveImageCopyToWorkspaceResult> {
  const targetDirectory = await resolveTargetDirectory(rootHandle, sourceFilePath);
  const sanitizedFileName = sanitizeFileName(defaultFileName) || "edited-image.png";
  const { baseName, extension } = splitFileName(sanitizedFileName);
  const resolvedExtension = extension || ".png";
  const uniqueName = await generateUniqueName(
    targetDirectory.handle,
    baseName || "edited-image",
    resolvedExtension,
  );

  const fileHandle = await targetDirectory.handle.getFileHandle(uniqueName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();

  const filePath = joinPath(targetDirectory.path, uniqueName);
  emitVaultChange(filePath);

  return {
    fileName: uniqueName,
    filePath,
  };
}
