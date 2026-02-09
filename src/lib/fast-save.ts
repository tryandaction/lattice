/**
 * Fast Save Utilities
 * 
 * Optimized file saving with:
 * - Debounced auto-save
 * - Streaming writes for large files
 * - Background serialization
 */

/**
 * Debounce function for reducing save frequency
 */
export function debounce<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  delay: number
): (...args: Args) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Throttle function for limiting save frequency
 */
export function throttle<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  limit: number
): (...args: Args) => void {
  let inThrottle = false;
  let lastArgs: Args | null = null;
  
  return (...args: Args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
        if (lastArgs) {
          fn(...lastArgs);
          lastArgs = null;
        }
      }, limit);
    } else {
      lastArgs = args;
    }
  };
}

/**
 * Fast JSON stringify with minimal formatting
 * Uses a single-pass approach for better performance
 */
export function fastStringify(obj: unknown): string {
  // For small objects, use native JSON.stringify
  // For large objects, use minimal formatting
  return JSON.stringify(obj, null, 1);
}

/**
 * Save file with optimized write
 */
export async function fastSaveFile(
  handle: FileSystemFileHandle,
  content: string
): Promise<void> {
  const writable = await handle.createWritable();
  
  // For large files (>1MB), write in chunks
  if (content.length > 1024 * 1024) {
    const encoder = new TextEncoder();
    const chunkSize = 256 * 1024; // 256KB chunks
    
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, i + chunkSize);
      await writable.write(encoder.encode(chunk));
    }
  } else {
    // For smaller files, write all at once
    await writable.write(content);
  }
  
  await writable.close();
}

/**
 * Create a save manager for a specific file
 * Handles debouncing and background saves
 */
export function createSaveManager(options: {
  debounceMs?: number;
  onSaveStart?: () => void;
  onSaveComplete?: () => void;
  onSaveError?: (error: Error) => void;
}) {
  const {
    debounceMs = 500,
    onSaveStart,
    onSaveComplete,
    onSaveError,
  } = options;
  
  let pendingSave: Promise<void> | null = null;
  let pendingContent: string | null = null;
  let saveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  
  const executeSave = async (
    handle: FileSystemFileHandle,
    content: string
  ) => {
    // If there's already a save in progress, queue this one
    if (pendingSave) {
      pendingContent = content;
      return;
    }
    
    onSaveStart?.();
    
    try {
      pendingSave = fastSaveFile(handle, content);
      await pendingSave;
      onSaveComplete?.();
      
      // Check if there's a queued save
      if (pendingContent !== null) {
        const nextContent = pendingContent;
        pendingContent = null;
        pendingSave = null;
        await executeSave(handle, nextContent);
      }
    } catch (error) {
      onSaveError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      pendingSave = null;
    }
  };
  
  const debouncedSave = (
    handle: FileSystemFileHandle,
    content: string
  ) => {
    if (saveTimeoutId) {
      clearTimeout(saveTimeoutId);
    }
    
    saveTimeoutId = setTimeout(() => {
      executeSave(handle, content);
      saveTimeoutId = null;
    }, debounceMs);
  };
  
  const saveNow = async (
    handle: FileSystemFileHandle,
    content: string
  ) => {
    // Cancel any pending debounced save
    if (saveTimeoutId) {
      clearTimeout(saveTimeoutId);
      saveTimeoutId = null;
    }
    
    await executeSave(handle, content);
  };
  
  const cancel = () => {
    if (saveTimeoutId) {
      clearTimeout(saveTimeoutId);
      saveTimeoutId = null;
    }
    pendingContent = null;
  };
  
  return {
    save: debouncedSave,
    saveNow,
    cancel,
    get isPending() {
      return pendingSave !== null || saveTimeoutId !== null;
    },
  };
}

/**
 * Optimized notebook serialization
 * Avoids unnecessary object creation
 */
export function serializeNotebookFast(state: {
  cells: Array<{
    cell_type: string;
    source: string;
    metadata: Record<string, unknown>;
    outputs?: unknown[];
    execution_count?: number | null;
  }>;
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}): string {
  // Build JSON string directly for better performance
  const parts: string[] = ['{'];
  
  // Cells array
  parts.push('"cells":[');
  for (let i = 0; i < state.cells.length; i++) {
    const cell = state.cells[i];
    if (i > 0) parts.push(',');
    
    parts.push('{');
    parts.push(`"cell_type":"${cell.cell_type}",`);
    
    // Source as array of lines
    const sourceLines = cell.source ? cell.source.split('\n') : [];
    parts.push('"source":[');
    for (let j = 0; j < sourceLines.length; j++) {
      if (j > 0) parts.push(',');
      const line = sourceLines[j];
      const escapedLine = JSON.stringify(j < sourceLines.length - 1 ? line + '\n' : line);
      parts.push(escapedLine);
    }
    parts.push('],');
    
    // Metadata
    parts.push(`"metadata":${JSON.stringify(cell.metadata)}`);
    
    // Code cell specific
    if (cell.cell_type === 'code') {
      parts.push(`,"outputs":${JSON.stringify(cell.outputs || [])}`);
      parts.push(`,"execution_count":${cell.execution_count ?? 'null'}`);
    }
    
    parts.push('}');
  }
  parts.push('],');
  
  // Metadata
  parts.push(`"metadata":${JSON.stringify(state.metadata)},`);
  
  // Format info
  parts.push(`"nbformat":${state.nbformat},`);
  parts.push(`"nbformat_minor":${state.nbformat_minor}`);
  
  parts.push('}');
  
  return parts.join('');
}
