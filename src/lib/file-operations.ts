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
    const content = await oldFile.text();

    // Create the new file
    const newFileHandle = await dirHandle.getFileHandle(sanitized, { create: true });
    
    // Write content to new file
    const writable = await newFileHandle.createWritable();
    await writable.write(content);
    await writable.close();

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
