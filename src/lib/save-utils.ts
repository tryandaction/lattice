/**
 * File save utilities for the Flexible Grid Workbench
 * Handles saving file content via the File System Access API
 */

/**
 * Result of a save operation
 */
export interface SaveResult {
  success: boolean;
  error?: string;
}

/**
 * Save content to a file using the File System Access API
 * 
 * @param handle - The FileSystemFileHandle to write to
 * @param content - The content to write (string or ArrayBuffer)
 * @returns A SaveResult indicating success or failure
 */
export async function saveFileContent(
  handle: FileSystemFileHandle,
  content: string | ArrayBuffer
): Promise<SaveResult> {
  try {
    // Request write permission if needed
    const writable = await handle.createWritable();
    
    // Write the content
    await writable.write(content);
    
    // Close the file (commits the write)
    await writable.close();
    
    return { success: true };
  } catch (error) {
    // Handle specific error types
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') {
        return {
          success: false,
          error: 'Permission denied. Please grant write access to save the file.',
        };
      }
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Save operation was cancelled.',
        };
      }
      if (error.name === 'QuotaExceededError') {
        return {
          success: false,
          error: 'Not enough disk space to save the file.',
        };
      }
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save file',
    };
  }
}
