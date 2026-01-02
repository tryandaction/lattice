/**
 * Layout Tree Types for Advanced Workbench Layout
 * 
 * This module defines the recursive data structures for representing
 * arbitrarily complex pane layouts with tabbed file management.
 */

/**
 * Unique identifier for panes
 * Format: "pane-{timestamp}-{random}"
 */
export type PaneId = string;

/**
 * Split direction for layout containers
 * - 'horizontal': children arranged left-to-right
 * - 'vertical': children arranged top-to-bottom
 */
export type SplitDirection = 'horizontal' | 'vertical';

/**
 * State for an individual tab within a pane
 * Represents an open file with its associated state
 */
export interface TabState {
  /** Unique identifier for the tab */
  id: string;
  /** File System Access API handle for the file */
  fileHandle: FileSystemFileHandle;
  /** Display name of the file */
  fileName: string;
  /** Full path relative to workspace root */
  filePath: string;
  /** Whether the file has unsaved changes */
  isDirty: boolean;
  /** Scroll position to restore when switching tabs */
  scrollPosition: number;
}

/**
 * Pane node (leaf node in the layout tree)
 * Contains tabs and displays one active file
 */
export interface PaneNode {
  /** Discriminator for type narrowing */
  type: 'pane';
  /** Unique identifier for this pane */
  id: PaneId;
  /** Array of open tabs in this pane */
  tabs: TabState[];
  /** Index of the currently active tab (-1 if no tabs) */
  activeTabIndex: number;
}

/**
 * Split node (branch node in the layout tree)
 * Contains child nodes arranged in a direction
 */
export interface SplitNode {
  /** Discriminator for type narrowing */
  type: 'split';
  /** Unique identifier for this split container */
  id: string;
  /** Direction of the split */
  direction: SplitDirection;
  /** Child nodes (must have at least 2) */
  children: LayoutNode[];
  /** Size percentages for each child (must sum to 100) */
  sizes: number[];
}

/**
 * Union type for layout tree nodes
 * Either a pane (leaf) or a split container (branch)
 */
export type LayoutNode = PaneNode | SplitNode;

/**
 * Root layout state
 * Contains the layout tree and active pane tracking
 */
export interface LayoutState {
  /** Root node of the layout tree */
  root: LayoutNode;
  /** ID of the currently active pane */
  activePaneId: PaneId;
}

/**
 * Type guard to check if a node is a PaneNode
 */
export function isPaneNode(node: LayoutNode): node is PaneNode {
  return node.type === 'pane';
}

/**
 * Type guard to check if a node is a SplitNode
 */
export function isSplitNode(node: LayoutNode): node is SplitNode {
  return node.type === 'split';
}

/**
 * Serialized tab format for localStorage persistence
 * Excludes fileHandle which cannot be serialized
 */
export interface SerializedTab {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  scrollPosition: number;
}

/**
 * Serialized pane node for persistence
 */
export interface SerializedPaneNode {
  type: 'pane';
  id: string;
  tabs: SerializedTab[];
  activeTabIndex: number;
}

/**
 * Serialized split node for persistence
 */
export interface SerializedSplitNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  children: SerializedLayoutNode[];
  sizes: number[];
}

/**
 * Union type for serialized layout nodes
 */
export type SerializedLayoutNode = SerializedPaneNode | SerializedSplitNode;

/**
 * Complete serialized layout for localStorage
 */
export interface SerializedLayout {
  /** Schema version for future migrations */
  version: 1;
  /** Serialized layout tree */
  root: SerializedLayoutNode;
  /** Active pane ID */
  activePaneId: string;
  /** Sidebar collapsed state */
  sidebarCollapsed: boolean;
}

/**
 * Data transferred during tab drag operations
 */
export interface TabDragData {
  type: 'tab';
  paneId: PaneId;
  tabIndex: number;
  tab: TabState;
}

/**
 * Drop target for tab bar (reorder or move between panes)
 */
export interface TabBarDropTarget {
  type: 'tab-bar';
  paneId: PaneId;
  index: number;
}

/**
 * Drop target for split zone (create new split)
 */
export interface SplitZoneDropTarget {
  type: 'split-zone';
  paneId: PaneId;
  direction: SplitDirection;
}

/**
 * Union type for all drop targets
 */
export type DropTarget = TabBarDropTarget | SplitZoneDropTarget;
