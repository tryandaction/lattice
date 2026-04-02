/**
 * File Operations Utilities for Lattice
 * 
 * Provides functions for creating, deleting, and managing files
 * using the File System Access API.
 */

/**
 * File type for creation
 */
export type FileType = 'note' | 'notebook';

/**
 * Result of a file operation
 */
export interface FileOperationResult {
  success: boolean;
  handle?: FileSystemFileHandle;
  path?: string;
  error?: string;
}

export type EntryKind = "file" | "directory";

export interface EntryOperationResult {
  success: boolean;
  handle?: FileSystemHandle;
  path?: string;
  error?: string;
  kind?: EntryKind;
}

/**
 * Empty Jupyter Notebook structure (nbformat v4)
 */
export function createEmptyNotebook(): object {
  return {
    cells: [
      {
        cell_type: 'code',
        source: [],
        metadata: {},
        outputs: [],
        execution_count: null,
      },
    ],
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: '3.9.0',
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/**
 * Get initial content for a new file based on type
 */
export function getInitialContent(type: FileType): string {
  if (type === 'note') {
    return '# New Note\n\nStart writing here...\n';
  }
  return JSON.stringify(createEmptyNotebook(), null, 2);
}

/**
 * Get file extension for a file type
 */
export function getFileExtension(type: FileType): string {
  return type === 'note' ? '.md' : '.ipynb';
}

/**
 * Sanitize filename by removing invalid characters
 */
export function sanitizeFileName(name: string): string {
  // Remove characters that are invalid in most file systems
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getParentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function joinPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
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

/**
 * Check if a file exists in a directory
 */
async function fileExists(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string
): Promise<boolean> {
  try {
    await dirHandle.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a unique filename that doesn't collide with existing files
 * 
 * @param dirHandle - Directory handle to check for existing files
 * @param baseName - Base name for the file (without extension)
 * @param extension - File extension (with dot, e.g., '.md')
 * @returns Unique filename
 */
export async function generateUniqueName(
  dirHandle: FileSystemDirectoryHandle,
  baseName: string,
  extension: string
): Promise<string> {
  const sanitized = sanitizeFileName(baseName) || 'Untitled';
  let candidate = `${sanitized}${extension}`;
  let counter = 1;

  while (await fileExists(dirHandle, candidate)) {
    candidate = `${sanitized}-${counter}${extension}`;
    counter++;
  }

  return candidate;
}

async function generateUniqueCopyName(
  parentHandle: FileSystemDirectoryHandle,
  originalName: string,
  kind: EntryKind
): Promise<string> {
  if (kind === "file") {
    const { baseName, extension } = splitFileName(originalName);
    const copyBaseName = `${baseName || "Untitled"} copy`;
    return generateUniqueName(parentHandle, copyBaseName, extension);
  }

  return generateUniqueDirectoryName(parentHandle, `${originalName || "New Folder"} copy`);
}

async function writeBlobToFile(fileHandle: FileSystemFileHandle, blob: Blob): Promise<void> {
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function copyFileHandle(
  sourceHandle: FileSystemFileHandle,
  targetDirectoryHandle: FileSystemDirectoryHandle,
  desiredName?: string
): Promise<{ handle: FileSystemFileHandle; name: string }> {
  const sourceFile = await sourceHandle.getFile();
  const targetName = desiredName
    ? sanitizeFileName(desiredName)
    : await generateUniqueCopyName(targetDirectoryHandle, sourceHandle.name, "file");

  const targetHandle = await targetDirectoryHandle.getFileHandle(targetName, { create: true });
  await writeBlobToFile(targetHandle, sourceFile);

  return { handle: targetHandle, name: targetName };
}

async function copyDirectoryHandle(
  sourceHandle: FileSystemDirectoryHandle,
  targetDirectoryHandle: FileSystemDirectoryHandle,
  desiredName?: string
): Promise<{ handle: FileSystemDirectoryHandle; name: string }> {
  const targetName = desiredName
    ? sanitizeFileName(desiredName)
    : await generateUniqueCopyName(targetDirectoryHandle, sourceHandle.name, "directory");

  const newDirectoryHandle = await targetDirectoryHandle.getDirectoryHandle(targetName, { create: true });

  for await (const entry of sourceHandle.values()) {
    if (entry.kind === "file") {
      await copyFileHandle(entry as FileSystemFileHandle, newDirectoryHandle, entry.name);
      continue;
    }

    await copyDirectoryHandle(entry as FileSystemDirectoryHandle, newDirectoryHandle, entry.name);
  }

  return { handle: newDirectoryHandle, name: targetName };
}

export async function resolveDirectoryHandle(
  rootHandle: FileSystemDirectoryHandle,
  directoryPath: string
): Promise<FileSystemDirectoryHandle | null> {
  const parts = directoryPath.split("/").filter(Boolean);
  if (parts.length === 0) {
    return rootHandle;
  }

  let currentHandle = rootHandle;
  const startIndex = parts[0] === rootHandle.name ? 1 : 0;

  for (let index = startIndex; index < parts.length; index += 1) {
    const part = parts[index];
    try {
      currentHandle = await currentHandle.getDirectoryHandle(part);
    } catch {
      return null;
    }
  }

  return currentHandle;
}

export interface ResolvedEntry {
  kind: EntryKind;
  name: string;
  parentHandle: FileSystemDirectoryHandle;
  handle: FileSystemHandle;
}

export async function resolveEntry(
  rootHandle: FileSystemDirectoryHandle,
  path: string
): Promise<ResolvedEntry | null> {
  const parentDirectory = await findParentDirectory(rootHandle, path);
  if (!parentDirectory) {
    return null;
  }

  const entryName = getFileName(path);
  if (!entryName) {
    return null;
  }

  try {
    const fileHandle = await parentDirectory.getFileHandle(entryName);
    return {
      kind: "file",
      name: entryName,
      parentHandle: parentDirectory,
      handle: fileHandle,
    };
  } catch {
    // Try as directory below.
  }

  try {
    const directoryHandle = await parentDirectory.getDirectoryHandle(entryName);
    return {
      kind: "directory",
      name: entryName,
      parentHandle: parentDirectory,
      handle: directoryHandle,
    };
  } catch {
    return null;
  }
}

/**
 * Create a new file in the specified directory
 * 
 * @param dirHandle - Directory handle where the file will be created
 * @param name - Desired filename (without extension)
 * @param type - Type of file to create ('note' or 'notebook')
 * @returns FileOperationResult with the created file handle
 */
export async function createFile(
  dirHandle: FileSystemDirectoryHandle,
  name: string,
  type: FileType
): Promise<FileOperationResult> {
  try {
    const extension = getFileExtension(type);
    const uniqueName = await generateUniqueName(dirHandle, name, extension);
    
    // Create the file
    const fileHandle = await dirHandle.getFileHandle(uniqueName, { create: true });
    
    // Write initial content
    const writable = await fileHandle.createWritable();
    const content = getInitialContent(type);
    await writable.write(content);
    await writable.close();

    // Build the path
    const path = `${dirHandle.name}/${uniqueName}`;

    return {
      success: true,
      handle: fileHandle,
      path,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create file',
    };
  }
}

/**
 * Delete a file from the directory
 * 
 * @param dirHandle - Directory handle containing the file
 * @param fileName - Name of the file to delete
 * @returns FileOperationResult indicating success or failure
 */
export async function deleteFile(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string
): Promise<FileOperationResult> {
  try {
    await dirHandle.removeEntry(fileName);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete file',
    };
  }
}

export async function deleteEntry(
  dirHandle: FileSystemDirectoryHandle,
  entryName: string,
  kind: EntryKind
): Promise<EntryOperationResult> {
  try {
    await dirHandle.removeEntry(entryName, kind === "directory" ? { recursive: true } : undefined);
    return { success: true, kind };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete entry",
      kind,
    };
  }
}

/**
 * Find the parent directory handle for a given file path
 * 
 * @param rootHandle - Root directory handle
 * @param filePath - Full path to the file
 * @returns Directory handle of the parent, or null if not found
 */
export async function findParentDirectory(
  rootHandle: FileSystemDirectoryHandle,
  filePath: string
): Promise<FileSystemDirectoryHandle | null> {
  const parts = filePath.split('/');
  
  // Remove the filename to get directory path
  parts.pop();
  
  // If only root remains, return root
  if (parts.length <= 1) {
    return rootHandle;
  }

  // Navigate to the parent directory
  let currentHandle = rootHandle;
  
  // Skip the root name (first part)
  for (let i = 1; i < parts.length; i++) {
    try {
      currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
    } catch {
      return null;
    }
  }

  return currentHandle;
}

/**
 * Extract filename from a path
 */
export function getFileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * Rename a file in the directory
 * Note: File System Access API doesn't have a native rename method,
 * so we copy the content to a new file and delete the old one.
 * 
 * @param dirHandle - Directory handle containing the file
 * @param oldName - Current name of the file
 * @param newName - New name for the file (with extension)
 * @returns FileOperationResult with the new file handle
 */
export async function renameFile(
  dirHandle: FileSystemDirectoryHandle,
  oldName: string,
  newName: string
): Promise<FileOperationResult> {
  try {
    // Sanitize the new name
    const sanitized = sanitizeFileName(newName);
    if (!sanitized) {
      return {
        success: false,
        error: 'Invalid file name',
      };
    }

    if (sanitized === oldName) {
      const handle = await dirHandle.getFileHandle(oldName);
      return {
        success: true,
        handle,
        path: `${dirHandle.name}/${sanitized}`,
      };
    }

    // Check if new name already exists
    if (await fileExists(dirHandle, sanitized)) {
      return {
        success: false,
        error: 'A file with this name already exists',
      };
    }

    // Get the old file handle and read its content
    const oldFileHandle = await dirHandle.getFileHandle(oldName);
    const oldFile = await oldFileHandle.getFile();

    // Create the new file
    const newFileHandle = await dirHandle.getFileHandle(sanitized, { create: true });
    
    // Write content to new file
    await writeBlobToFile(newFileHandle, oldFile);

    // Delete the old file
    await dirHandle.removeEntry(oldName);

    // Build the path
    const path = `${dirHandle.name}/${sanitized}`;

    return {
      success: true,
      handle: newFileHandle,
      path,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to rename file',
    };
  }
}

export async function renameEntry(
  dirHandle: FileSystemDirectoryHandle,
  oldName: string,
  newName: string,
  kind: EntryKind
): Promise<EntryOperationResult> {
  const sanitized = sanitizeFileName(newName);
  if (!sanitized) {
    return {
      success: false,
      error: "Invalid file name",
      kind,
    };
  }

  if (sanitized === oldName) {
    try {
      const handle =
        kind === "file"
          ? await dirHandle.getFileHandle(oldName)
          : await dirHandle.getDirectoryHandle(oldName);

      return {
        success: true,
        handle,
        path: `${dirHandle.name}/${sanitized}`,
        kind,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to resolve entry",
        kind,
      };
    }
  }

  try {
    if (kind === "file") {
      if (await fileExists(dirHandle, sanitized)) {
        return {
          success: false,
          error: "A file with this name already exists",
          kind,
        };
      }

      const sourceHandle = await dirHandle.getFileHandle(oldName);
      const { handle, name } = await copyFileHandle(sourceHandle, dirHandle, sanitized);
      await dirHandle.removeEntry(oldName);

      return {
        success: true,
        handle,
        path: `${dirHandle.name}/${name}`,
        kind,
      };
    }

    if (await directoryExists(dirHandle, sanitized)) {
      return {
        success: false,
        error: "A folder with this name already exists",
        kind,
      };
    }

    const sourceHandle = await dirHandle.getDirectoryHandle(oldName);
    const { handle, name } = await copyDirectoryHandle(sourceHandle, dirHandle, sanitized);
    await dirHandle.removeEntry(oldName, { recursive: true });

    return {
      success: true,
      handle,
      path: `${dirHandle.name}/${name}`,
      kind,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to rename entry",
      kind,
    };
  }
}

/**
 * Result of a directory operation
 */
export interface DirectoryOperationResult {
  success: boolean;
  handle?: FileSystemDirectoryHandle;
  path?: string;
  error?: string;
}

/**
 * Check if a directory exists
 */
async function directoryExists(
  parentHandle: FileSystemDirectoryHandle,
  dirName: string
): Promise<boolean> {
  try {
    await parentHandle.getDirectoryHandle(dirName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a unique directory name that doesn't collide with existing directories
 * 
 * @param parentHandle - Parent directory handle to check for existing directories
 * @param baseName - Base name for the directory
 * @returns Unique directory name
 */
export async function generateUniqueDirectoryName(
  parentHandle: FileSystemDirectoryHandle,
  baseName: string
): Promise<string> {
  const sanitized = sanitizeFileName(baseName) || 'New Folder';
  let candidate = sanitized;
  let counter = 1;

  while (await directoryExists(parentHandle, candidate)) {
    candidate = `${sanitized} ${counter}`;
    counter++;
  }

  return candidate;
}

/**
 * Create a new directory in the specified parent directory
 * 
 * @param parentHandle - Parent directory handle where the new directory will be created
 * @param name - Desired directory name
 * @returns DirectoryOperationResult with the created directory handle
 */
export async function createDirectory(
  parentHandle: FileSystemDirectoryHandle,
  name: string
): Promise<DirectoryOperationResult> {
  try {
    const uniqueName = await generateUniqueDirectoryName(parentHandle, name);
    
    // Create the directory
    const dirHandle = await parentHandle.getDirectoryHandle(uniqueName, { create: true });

    // Build the path
    const path = `${parentHandle.name}/${uniqueName}`;

    return {
      success: true,
      handle: dirHandle,
      path,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create directory',
    };
  }
}

export async function copyEntryToDirectory(
  entryHandle: FileSystemHandle,
  targetDirectoryHandle: FileSystemDirectoryHandle
): Promise<EntryOperationResult> {
  try {
    if (entryHandle.kind === "file") {
      const { handle, name } = await copyFileHandle(entryHandle as FileSystemFileHandle, targetDirectoryHandle);
      return {
        success: true,
        handle,
        path: `${targetDirectoryHandle.name}/${name}`,
        kind: "file",
      };
    }

    const { handle, name } = await copyDirectoryHandle(entryHandle as FileSystemDirectoryHandle, targetDirectoryHandle);
    return {
      success: true,
      handle,
      path: `${targetDirectoryHandle.name}/${name}`,
      kind: "directory",
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to copy entry",
    };
  }
}

export async function moveEntryToDirectory(
  sourceParentHandle: FileSystemDirectoryHandle,
  entryHandle: FileSystemHandle,
  targetDirectoryHandle: FileSystemDirectoryHandle
): Promise<EntryOperationResult> {
  try {
    const copied = await copyEntryToDirectory(entryHandle, targetDirectoryHandle);
    if (!copied.success) {
      return copied;
    }

    await sourceParentHandle.removeEntry(
      entryHandle.name,
      entryHandle.kind === "directory" ? { recursive: true } : undefined
    );

    return copied;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to move entry",
    };
  }
}
