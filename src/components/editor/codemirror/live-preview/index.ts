/**
 * Live Preview Editor - Obsidian-style markdown editing
 * 
 * Main exports for the Live Preview editor system
 */

// Main editor component
export { LivePreviewEditor, type LivePreviewEditorProps } from './live-preview-editor';

// Panels
export { OutlinePanel } from './outline-panel';
export { BacklinkPanel } from './backlink-panel';
export { SearchPanel } from './search-panel';

// Services
export { BacklinkIndex, createBacklinkIndex, extractWikiLinks } from './backlink-service';
export { getSavedMode, saveMode, clearSavedMode, useModePreference } from './mode-persistence';

// Plugins (for advanced usage)
export { cursorContextExtension, shouldRevealAt } from './cursor-context-plugin';
export { decorationCoordinatorPlugin, parsedElementsField } from './decoration-coordinator';
export { foldingExtension } from './folding-plugin';
export { markdownKeymap } from './keyboard-shortcuts';
export { autoFormattingExtension } from './auto-formatting';
export { wikiLinkAutocomplete, updateAvailableFiles } from './wiki-link-autocomplete';
export { createImageDropExtension, imageDropExtension, type ImageUploadHandler } from './image-drop-plugin';

// Accessibility
export { 
  createAccessibilityExtension, 
  announceChange, 
  focusEditor, 
  focusSearchPanel 
} from './accessibility';

// Performance utilities
export {
  DecorationCache,
  debounce,
  throttle,
  processVisibleRanges,
  isInViewport,
  perfMonitor,
  createDebouncedUpdateExtension,
} from './performance-utils';

// Theme
export { livePreviewThemeExtension } from './live-preview-theme';

// Types
export type {
  ViewMode,
  OutlineItem,
  Backlink,
  WikiLink,
  LivePreviewConfig,
  FoldState,
  MarkdownElement,
  HeadingInfo,
  CodeBlockInfo,
  ListItemInfo,
  BlockquoteInfo,
  TableInfo,
  TableRow,
  TableCell,
} from './types';

// Parser utilities
export { parseHeadings, buildOutlineTree, parseInlineElements } from './markdown-parser';
