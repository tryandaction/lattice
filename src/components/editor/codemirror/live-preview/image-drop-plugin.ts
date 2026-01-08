/**
 * Image Drop and Paste Plugin
 * Handles drag-and-drop and clipboard paste for images
 * 
 * Requirements: 9.4, 9.5, 9.6
 */

import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

/**
 * Image upload handler type
 */
export type ImageUploadHandler = (file: File) => Promise<string>;

/**
 * Default handler that creates a data URL
 */
async function defaultImageHandler(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Insert image markdown at cursor position
 */
function insertImageMarkdown(
  view: EditorView,
  url: string,
  alt: string = 'image',
  useWikiStyle: boolean = false
): void {
  const { state } = view;
  const cursor = state.selection.main.head;
  
  let insert: string;
  if (useWikiStyle) {
    // Wiki-style: ![[image.png]]
    insert = `![[${alt}]]`;
  } else {
    // Standard markdown: ![alt](url)
    insert = `![${alt}](${url})`;
  }
  
  view.dispatch({
    changes: { from: cursor, insert },
    selection: EditorSelection.cursor(cursor + insert.length),
  });
}

/**
 * Check if file is an image
 */
function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * Get filename without extension for alt text
 */
function getAltFromFile(file: File): string {
  const name = file.name;
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(0, lastDot) : name;
}

/**
 * Create image drop/paste extension
 */
export function createImageDropExtension(
  uploadHandler: ImageUploadHandler = defaultImageHandler,
  useWikiStyle: boolean = false
) {
  return EditorView.domEventHandlers({
    // Handle drag and drop
    drop: (event, view) => {
      const dt = event.dataTransfer;
      if (!dt) return false;
      
      const files = Array.from(dt.files).filter(isImageFile);
      if (files.length === 0) return false;
      
      event.preventDefault();
      event.stopPropagation();
      
      // Get drop position
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos !== null) {
        view.dispatch({
          selection: EditorSelection.cursor(pos),
        });
      }
      
      // Process each image
      Promise.all(
        files.map(async (file) => {
          try {
            const url = await uploadHandler(file);
            const alt = getAltFromFile(file);
            insertImageMarkdown(view, url, alt, useWikiStyle);
          } catch (error) {
            console.error('Failed to upload image:', error);
          }
        })
      );
      
      return true;
    },
    
    // Handle drag over (required for drop to work)
    dragover: (event) => {
      const dt = event.dataTransfer;
      if (!dt) return false;
      
      // Check if dragging files
      if (dt.types.includes('Files')) {
        event.preventDefault();
        dt.dropEffect = 'copy';
        return true;
      }
      
      return false;
    },
    
    // Handle paste
    paste: (event, view) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return false;
      
      // Check for image files
      const files = Array.from(clipboardData.files).filter(isImageFile);
      
      // Also check for image items (for screenshots)
      const items = Array.from(clipboardData.items);
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file && !files.some(f => f.name === file.name)) {
            files.push(file);
          }
        }
      }
      
      if (files.length === 0) return false;
      
      event.preventDefault();
      
      // Process each image
      Promise.all(
        files.map(async (file) => {
          try {
            const url = await uploadHandler(file);
            const alt = file.name ? getAltFromFile(file) : 'pasted-image';
            insertImageMarkdown(view, url, alt, useWikiStyle);
          } catch (error) {
            console.error('Failed to upload image:', error);
          }
        })
      );
      
      return true;
    },
  });
}

/**
 * Default image drop extension (uses data URLs)
 */
export const imageDropExtension = createImageDropExtension();

/**
 * Wiki-style image drop extension
 */
export const wikiImageDropExtension = createImageDropExtension(defaultImageHandler, true);
