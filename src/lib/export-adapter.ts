/**
 * Export Adapter
 * 
 * Provides a unified interface for file export across
 * Web (download) and Desktop (Tauri save dialog) environments.
 */

import { isTauri } from './storage-adapter';

export interface ExportOptions {
  defaultFileName: string;
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
  cancelled?: boolean;
}

export interface ExportAdapter {
  saveFile(
    content: Uint8Array | Blob,
    options: ExportOptions
  ): Promise<ExportResult>;
  
  showInFolder(filePath: string): Promise<void>;
}

// Track ongoing exports to prevent duplicates
const ongoingExports = new Set<string>();

/**
 * Check if an export is already in progress for a file
 */
export function isExportInProgress(fileName: string): boolean {
  return ongoingExports.has(fileName);
}

/**
 * Mark an export as started
 */
function markExportStarted(fileName: string): boolean {
  if (ongoingExports.has(fileName)) {
    return false; // Already in progress
  }
  ongoingExports.add(fileName);
  return true;
}

/**
 * Mark an export as completed
 */
function markExportCompleted(fileName: string): void {
  ongoingExports.delete(fileName);
}

/**
 * Web Export Adapter - uses browser download
 */
class WebExportAdapter implements ExportAdapter {
  async saveFile(content: Uint8Array | Blob, options: ExportOptions): Promise<ExportResult> {
    // Check for duplicate export
    if (!markExportStarted(options.defaultFileName)) {
      return {
        success: false,
        error: 'Export already in progress for this file',
      };
    }

    try {
      // Convert to Blob if needed
      const blob = content instanceof Blob ? content : new Blob([new Uint8Array(content)]);
      
      // Try to use File System Access API if available
      if ('showSaveFilePicker' in window) {
        try {
          const fileHandle = await (window as Window & { 
            showSaveFilePicker: (options: {
              suggestedName?: string;
              types?: Array<{
                description?: string;
                accept: Record<string, string[]>;
              }>;
            }) => Promise<FileSystemFileHandle> 
          }).showSaveFilePicker({
            suggestedName: options.defaultFileName,
            types: options.filters?.map(f => ({
              description: f.name,
              accept: {
                [`application/${f.extensions[0]}`]: f.extensions.map(e => `.${e}`),
              },
            })),
          });
          
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          
          return {
            success: true,
            filePath: fileHandle.name,
          };
        } catch (err) {
          // User cancelled or API not supported
          if ((err as Error).name === 'AbortError') {
            return { success: false, cancelled: true };
          }
          // Fall through to download method
        }
      }
      
      // Fallback: use download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = options.defaultFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      return {
        success: true,
        filePath: options.defaultFileName,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed',
      };
    } finally {
      markExportCompleted(options.defaultFileName);
    }
  }

  async showInFolder(_filePath: string): Promise<void> {
    // Not supported in web mode
    console.log('[Export] showInFolder not supported in web mode');
  }
}

/**
 * Tauri Export Adapter - uses native save dialog
 */
class TauriExportAdapter implements ExportAdapter {
  async saveFile(content: Uint8Array | Blob, options: ExportOptions): Promise<ExportResult> {
    // Check for duplicate export
    if (!markExportStarted(options.defaultFileName)) {
      return {
        success: false,
        error: 'Export already in progress for this file',
      };
    }

    try {
      // Convert Blob to Uint8Array if needed
      let data: Uint8Array;
      if (content instanceof Blob) {
        const buffer = await content.arrayBuffer();
        data = new Uint8Array(buffer);
      } else {
        data = content;
      }

      // Show native save dialog
      const filePath = await window.__TAURI__!.core.invoke<string | null>(
        'plugin:dialog|save',
        {
          defaultPath: options.defaultFileName,
          filters: options.filters?.map(f => ({
            name: f.name,
            extensions: f.extensions,
          })),
        }
      );

      if (!filePath) {
        return { success: false, cancelled: true };
      }

      // Write file using Tauri fs
      await window.__TAURI__!.core.invoke('plugin:fs|write_file', {
        path: filePath,
        contents: Array.from(data),
      });

      return {
        success: true,
        filePath,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed',
      };
    } finally {
      markExportCompleted(options.defaultFileName);
    }
  }

  async showInFolder(filePath: string): Promise<void> {
    try {
      await window.__TAURI__!.core.invoke('plugin:shell|open', {
        path: filePath,
        with: 'explorer', // Windows
      });
    } catch (error) {
      console.error('[Export] Failed to show in folder:', error);
    }
  }
}

// Singleton instance
let exportAdapter: ExportAdapter | null = null;

/**
 * Get the appropriate export adapter for the current environment
 */
export function getExportAdapter(): ExportAdapter {
  if (!exportAdapter) {
    exportAdapter = isTauri() ? new TauriExportAdapter() : new WebExportAdapter();
  }
  return exportAdapter;
}

/**
 * Export a file with the appropriate method for the current environment
 */
export async function exportFile(
  content: Uint8Array | Blob,
  options: ExportOptions
): Promise<ExportResult> {
  const adapter = getExportAdapter();
  return adapter.saveFile(content, options);
}

/**
 * Show a file in its containing folder (desktop only)
 */
export async function showInFolder(filePath: string): Promise<void> {
  const adapter = getExportAdapter();
  return adapter.showInFolder(filePath);
}
