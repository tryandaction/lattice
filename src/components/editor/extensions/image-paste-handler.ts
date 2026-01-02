/**
 * Image Paste Handler Extension for Tiptap
 * 
 * Handles pasting images from clipboard:
 * - Detects image files in clipboard data
 * - Generates unique filenames with timestamps
 * - Writes images to assets directory
 * - Inserts Markdown image nodes
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export interface ImagePasteOptions {
  /** Callback to get the workspace directory handle */
  getWorkspaceHandle: () => Promise<FileSystemDirectoryHandle | null>;
  /** Callback when paste starts (for UI feedback) */
  onPasteStart?: () => void;
  /** Callback when paste completes */
  onPasteComplete?: (success: boolean, path?: string, error?: string) => void;
}

/**
 * Generate a unique filename for pasted images
 * Uses millisecond-precision timestamp for uniqueness
 */
export function generateImageFilename(): string {
  const timestamp = Date.now();
  return `paste_${timestamp}.png`;
}

/**
 * Check if clipboard event contains image files
 */
export function hasImageFiles(clipboardData: DataTransfer | null): boolean {
  if (!clipboardData?.files) return false;
  return Array.from(clipboardData.files).some(file => 
    file.type.startsWith("image/")
  );
}

/**
 * Extract image files from clipboard data
 */
export function extractImageFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData?.files) return [];
  return Array.from(clipboardData.files).filter(file => 
    file.type.startsWith("image/")
  );
}

/**
 * Ensure the assets directory exists, creating it if necessary
 */
export async function ensureAssetsDirectory(
  workspaceHandle: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle> {
  return await workspaceHandle.getDirectoryHandle("assets", { create: true });
}

/**
 * Write an image blob to the assets directory
 */
export async function writeImageToAssets(
  blob: Blob,
  filename: string,
  assetsHandle: FileSystemDirectoryHandle
): Promise<void> {
  const fileHandle = await assetsHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/**
 * Image Paste Handler Extension
 */
export const ImagePasteHandler = Extension.create<ImagePasteOptions>({
  name: "imagePasteHandler",

  addOptions() {
    return {
      getWorkspaceHandle: async () => null,
      onPasteStart: undefined,
      onPasteComplete: undefined,
    };
  },

  addProseMirrorPlugins() {
    const { getWorkspaceHandle, onPasteStart, onPasteComplete } = this.options;

    return [
      new Plugin({
        key: new PluginKey("imagePasteHandler"),
        props: {
          handlePaste: (view, event) => {
            const clipboardData = event.clipboardData;
            
            // Check if clipboard contains images
            if (!hasImageFiles(clipboardData)) {
              // No images - allow default paste behavior
              return false;
            }

            // Extract image files (prioritize images over text)
            const imageFiles = extractImageFiles(clipboardData);
            if (imageFiles.length === 0) {
              return false;
            }

            // Handle the first image
            const imageFile = imageFiles[0];
            
            // Prevent default paste
            event.preventDefault();

            // Insert placeholder immediately
            const placeholderText = "⏳ Saving image...";
            const { state: initialState, dispatch: initialDispatch } = view;
            const initialTr = initialState.tr;
            const placeholderFrom = initialState.selection.from;
            initialDispatch(initialTr.insertText(placeholderText));
            const placeholderTo = placeholderFrom + placeholderText.length;

            // Async handling
            (async () => {
              try {
                onPasteStart?.();

                const workspaceHandle = await getWorkspaceHandle();
                if (!workspaceHandle) {
                  // Remove placeholder on error
                  const { state, dispatch } = view;
                  const tr = state.tr;
                  tr.delete(placeholderFrom, Math.min(placeholderTo, state.doc.content.size));
                  dispatch(tr);
                  onPasteComplete?.(false, undefined, "No workspace folder open");
                  return;
                }

                // Generate filename and ensure assets directory
                const filename = generateImageFilename();
                const assetsHandle = await ensureAssetsDirectory(workspaceHandle);

                // Write image to disk
                await writeImageToAssets(imageFile, filename, assetsHandle);

                // Replace placeholder with image node
                const imagePath = `/assets/${filename}`;
                const { state, dispatch } = view;
                const { tr, schema } = state;

                // Delete placeholder
                tr.delete(placeholderFrom, Math.min(placeholderTo, state.doc.content.size));

                // Try to use image node if available, otherwise insert as text
                const imageNode = schema.nodes.image;
                if (imageNode) {
                  const node = imageNode.create({ src: imagePath, alt: filename });
                  tr.insert(placeholderFrom, node);
                } else {
                  // Fallback: insert as markdown text
                  const text = `![${filename}](${imagePath})`;
                  tr.insertText(text, placeholderFrom);
                }
                
                dispatch(tr);
                onPasteComplete?.(true, imagePath);
              } catch (error) {
                // Remove placeholder on error
                try {
                  const { state, dispatch } = view;
                  const tr = state.tr;
                  tr.delete(placeholderFrom, Math.min(placeholderTo, state.doc.content.size));
                  dispatch(tr);
                } catch {
                  // Ignore cleanup errors
                }
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                onPasteComplete?.(false, undefined, errorMessage);
              }
            })();

            return true;
          },
        },
      }),
    ];
  },
});
