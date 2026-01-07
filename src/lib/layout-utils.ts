/**
 * Layout Utility Functions
 * 
 * Pure functions for immutable layout tree mutations.
 * All functions return new trees without modifying the original.
 */

import type {
  LayoutNode,
  PaneNode,
  SplitNode,
  PaneId,
  SplitDirection,
  TabState,
} from '@/types/layout';
import { isPaneNode, isSplitNode } from '@/types/layout';

// Counter for generating unique IDs
let paneIdCounter = 0;
let splitIdCounter = 0;
let tabIdCounter = 0;

/**
 * Generate a unique pane ID
 */
export function generatePaneId(): PaneId {
  paneIdCounter++;
  return `pane-${Date.now()}-${paneIdCounter}`;
}

/**
 * Generate a unique split ID
 */
export function generateSplitId(): string {
  splitIdCounter++;
  return `split-${Date.now()}-${splitIdCounter}`;
}

/**
 * Generate a unique tab ID
 */
export function generateTabId(): string {
  tabIdCounter++;
  return `tab-${Date.now()}-${tabIdCounter}`;
}

/**
 * Create an empty pane node
 */
export function createEmptyPane(id?: PaneId): PaneNode {
  return {
    type: 'pane',
    id: id ?? generatePaneId(),
    tabs: [],
    activeTabIndex: -1,
  };
}

/**
 * Create a new tab state
 */
export function createTab(
  fileHandle: FileSystemFileHandle,
  filePath: string
): TabState {
  return {
    id: generateTabId(),
    fileHandle,
    fileName: fileHandle.name,
    filePath,
    isDirty: false,
    scrollPosition: 0,
  };
}

/**
 * Find a node by ID in the layout tree
 * Returns null if not found
 */
export function findNode(root: LayoutNode, id: string): LayoutNode | null {
  if (root.id === id) {
    return root;
  }

  if (isSplitNode(root)) {
    for (const child of root.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Find the parent split node of a given node
 * Returns null if the node is the root or not found
 */
export function findParent(root: LayoutNode, id: string): SplitNode | null {
  if (isSplitNode(root)) {
    for (const child of root.children) {
      if (child.id === id) {
        return root;
      }
      const found = findParent(child, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Count total number of panes in the tree
 */
export function countPanes(root: LayoutNode): number {
  if (isPaneNode(root)) {
    return 1;
  }
  return root.children.reduce((sum, child) => sum + countPanes(child), 0);
}

/**
 * Get all pane IDs in the tree
 */
export function getAllPaneIds(root: LayoutNode): PaneId[] {
  if (isPaneNode(root)) {
    return [root.id];
  }
  return root.children.flatMap(child => getAllPaneIds(child));
}

/**
 * Validate that a layout tree is structurally correct
 */
export function validateTree(root: LayoutNode): boolean {
  if (isPaneNode(root)) {
    // Pane must have valid activeTabIndex
    if (root.tabs.length === 0) {
      return root.activeTabIndex === -1;
    }
    return root.activeTabIndex >= 0 && root.activeTabIndex < root.tabs.length;
  }

  // Split must have at least 2 children
  if (root.children.length < 2) {
    return false;
  }

  // Sizes must match children count and sum to 100
  if (root.sizes.length !== root.children.length) {
    return false;
  }

  const sizesSum = root.sizes.reduce((sum, size) => sum + size, 0);
  if (Math.abs(sizesSum - 100) > 0.01) {
    return false;
  }

  // Direction must be valid
  if (root.direction !== 'horizontal' && root.direction !== 'vertical') {
    return false;
  }

  // Recursively validate children
  return root.children.every(child => validateTree(child));
}

/**
 * Find a pane by ID and return it
 */
export function findPane(root: LayoutNode, paneId: PaneId): PaneNode | null {
  const node = findNode(root, paneId);
  return node && isPaneNode(node) ? node : null;
}


/**
 * Split a pane in a given direction
 * Creates a new split container with the original pane and a new empty pane
 * 
 * @param root - The layout tree root
 * @param paneId - ID of the pane to split
 * @param direction - Direction of the split
 * @param newPaneId - Optional ID for the new pane
 * @returns New layout tree with the split applied
 */
export function splitPane(
  root: LayoutNode,
  paneId: PaneId,
  direction: SplitDirection,
  newPaneId?: PaneId
): LayoutNode {
  const actualNewPaneId = newPaneId ?? generatePaneId();
  
  // Helper to recursively transform the tree
  function transform(node: LayoutNode): LayoutNode {
    // Found the target pane - replace with split
    if (isPaneNode(node) && node.id === paneId) {
      const newPane = createEmptyPane(actualNewPaneId);
      const newSplit: SplitNode = {
        type: 'split',
        id: generateSplitId(),
        direction,
        children: [node, newPane],
        sizes: [50, 50],
      };
      return newSplit;
    }

    // If this is a split, check if target pane is a direct child
    if (isSplitNode(node)) {
      const targetIndex = node.children.findIndex(
        child => isPaneNode(child) && child.id === paneId
      );

      if (targetIndex !== -1) {
        // Target is a direct child - replace it with a new split
        const targetPane = node.children[targetIndex] as PaneNode;
        const newPane = createEmptyPane(actualNewPaneId);
        const newSplit: SplitNode = {
          type: 'split',
          id: generateSplitId(),
          direction,
          children: [targetPane, newPane],
          sizes: [50, 50],
        };

        return {
          ...node,
          children: [
            ...node.children.slice(0, targetIndex),
            newSplit,
            ...node.children.slice(targetIndex + 1),
          ],
        };
      }

      // Recursively search in children
      return {
        ...node,
        children: node.children.map(child => transform(child)),
      };
    }

    return node;
  }

  return transform(root);
}


/**
 * Remove a pane from the layout tree
 * If the pane's sibling is the only remaining child, replaces parent with sibling
 * Returns null if trying to remove the last pane
 * 
 * @param root - The layout tree root
 * @param paneId - ID of the pane to remove
 * @returns New layout tree with the pane removed, or null if removal not allowed
 */
export function removePane(
  root: LayoutNode,
  paneId: PaneId
): LayoutNode | null {
  // Cannot remove if only one pane exists
  if (countPanes(root) <= 1) {
    return null;
  }

  // If root is the target pane, cannot remove (should be caught by count check)
  if (isPaneNode(root) && root.id === paneId) {
    return null;
  }

  // Helper to recursively transform the tree
  function transform(node: LayoutNode): LayoutNode | null {
    if (isPaneNode(node)) {
      // This pane is not the target, keep it
      return node;
    }

    // This is a split node
    const targetIndex = node.children.findIndex(
      child => isPaneNode(child) && child.id === paneId
    );

    if (targetIndex !== -1) {
      // Target is a direct child - remove it
      const remainingChildren = [
        ...node.children.slice(0, targetIndex),
        ...node.children.slice(targetIndex + 1),
      ];

      // Recalculate sizes proportionally
      const _removedSize = node.sizes[targetIndex];
      const remainingSizes = [
        ...node.sizes.slice(0, targetIndex),
        ...node.sizes.slice(targetIndex + 1),
      ];
      const totalRemaining = remainingSizes.reduce((sum, s) => sum + s, 0);
      const newSizes = remainingSizes.map(
        s => (s / totalRemaining) * 100
      );

      // If only one child remains, return that child (simplify tree)
      if (remainingChildren.length === 1) {
        return remainingChildren[0];
      }

      return {
        ...node,
        children: remainingChildren,
        sizes: newSizes,
      };
    }

    // Recursively search in children
    const newChildren: LayoutNode[] = [];
    const newSizes: number[] = [];

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const transformed = transform(child);

      if (transformed === null) {
        // Child was removed entirely (shouldn't happen in normal flow)
        continue;
      }

      newChildren.push(transformed);
      newSizes.push(node.sizes[i]);
    }

    // Normalize sizes if any children were removed
    if (newChildren.length !== node.children.length) {
      const total = newSizes.reduce((sum, s) => sum + s, 0);
      const normalizedSizes = newSizes.map(s => (s / total) * 100);
      
      if (newChildren.length === 1) {
        return newChildren[0];
      }

      return {
        ...node,
        children: newChildren,
        sizes: normalizedSizes,
      };
    }

    return {
      ...node,
      children: newChildren,
    };
  }

  return transform(root);
}


/** Minimum pane size percentage */
export const MIN_PANE_SIZE = 10;

/**
 * Update sizes in a split node
 * Enforces minimum size constraints and ensures sizes sum to 100
 * 
 * @param root - The layout tree root
 * @param splitId - ID of the split node to update
 * @param sizes - New sizes array
 * @returns New layout tree with updated sizes
 */
export function updateSizes(
  root: LayoutNode,
  splitId: string,
  sizes: number[]
): LayoutNode {
  // Enforce minimum sizes
  const enforcedSizes = sizes.map(size => Math.max(size, MIN_PANE_SIZE));
  
  // Normalize to sum to 100
  const total = enforcedSizes.reduce((sum, s) => sum + s, 0);
  const normalizedSizes = enforcedSizes.map(s => (s / total) * 100);

  function transform(node: LayoutNode): LayoutNode {
    if (isPaneNode(node)) {
      return node;
    }

    if (node.id === splitId) {
      // Ensure sizes array matches children count
      if (normalizedSizes.length !== node.children.length) {
        return node;
      }
      return {
        ...node,
        sizes: normalizedSizes,
      };
    }

    return {
      ...node,
      children: node.children.map(child => transform(child)),
    };
  }

  return transform(root);
}

/**
 * Update a pane's tabs
 * 
 * @param root - The layout tree root
 * @param paneId - ID of the pane to update
 * @param tabs - New tabs array
 * @param activeTabIndex - New active tab index
 * @returns New layout tree with updated pane
 */
export function updatePaneTabs(
  root: LayoutNode,
  paneId: PaneId,
  tabs: TabState[],
  activeTabIndex: number
): LayoutNode {
  function transform(node: LayoutNode): LayoutNode {
    if (isPaneNode(node)) {
      if (node.id === paneId) {
        return {
          ...node,
          tabs,
          activeTabIndex,
        };
      }
      return node;
    }

    return {
      ...node,
      children: node.children.map(child => transform(child)),
    };
  }

  return transform(root);
}

/**
 * Add a tab to a pane
 * If the file is already open, activates that tab instead
 * 
 * @param root - The layout tree root
 * @param paneId - ID of the pane
 * @param tab - Tab to add
 * @returns New layout tree with the tab added
 */
export function addTabToPane(
  root: LayoutNode,
  paneId: PaneId,
  tab: TabState
): LayoutNode {
  const pane = findPane(root, paneId);
  if (!pane) return root;

  // Check if file is already open
  const existingIndex = pane.tabs.findIndex(t => t.filePath === tab.filePath);
  if (existingIndex !== -1) {
    // Activate existing tab
    return updatePaneTabs(root, paneId, pane.tabs, existingIndex);
  }

  // Add new tab and activate it
  const newTabs = [...pane.tabs, tab];
  return updatePaneTabs(root, paneId, newTabs, newTabs.length - 1);
}

/**
 * Remove a tab from a pane
 * 
 * @param root - The layout tree root
 * @param paneId - ID of the pane
 * @param tabIndex - Index of the tab to remove
 * @returns New layout tree with the tab removed
 */
export function removeTabFromPane(
  root: LayoutNode,
  paneId: PaneId,
  tabIndex: number
): LayoutNode {
  const pane = findPane(root, paneId);
  if (!pane || tabIndex < 0 || tabIndex >= pane.tabs.length) return root;

  const newTabs = [
    ...pane.tabs.slice(0, tabIndex),
    ...pane.tabs.slice(tabIndex + 1),
  ];

  // Adjust active tab index
  let newActiveIndex = pane.activeTabIndex;
  if (newTabs.length === 0) {
    newActiveIndex = -1;
  } else if (tabIndex <= pane.activeTabIndex) {
    newActiveIndex = Math.max(0, pane.activeTabIndex - 1);
  }

  return updatePaneTabs(root, paneId, newTabs, newActiveIndex);
}

/**
 * Reorder tabs within a pane
 * 
 * @param root - The layout tree root
 * @param paneId - ID of the pane
 * @param fromIndex - Original index of the tab
 * @param toIndex - New index for the tab
 * @returns New layout tree with reordered tabs
 */
export function reorderTabsInPane(
  root: LayoutNode,
  paneId: PaneId,
  fromIndex: number,
  toIndex: number
): LayoutNode {
  const pane = findPane(root, paneId);
  if (!pane) return root;
  if (fromIndex < 0 || fromIndex >= pane.tabs.length) return root;
  if (toIndex < 0 || toIndex >= pane.tabs.length) return root;
  if (fromIndex === toIndex) return root;

  const newTabs = [...pane.tabs];
  const [movedTab] = newTabs.splice(fromIndex, 1);
  newTabs.splice(toIndex, 0, movedTab);

  // Adjust active tab index to follow the active tab
  let newActiveIndex = pane.activeTabIndex;
  if (pane.activeTabIndex === fromIndex) {
    newActiveIndex = toIndex;
  } else if (fromIndex < pane.activeTabIndex && toIndex >= pane.activeTabIndex) {
    newActiveIndex = pane.activeTabIndex - 1;
  } else if (fromIndex > pane.activeTabIndex && toIndex <= pane.activeTabIndex) {
    newActiveIndex = pane.activeTabIndex + 1;
  }

  return updatePaneTabs(root, paneId, newTabs, newActiveIndex);
}

/**
 * Move a tab from one pane to another
 * 
 * @param root - The layout tree root
 * @param sourcePaneId - ID of the source pane
 * @param tabIndex - Index of the tab to move
 * @param targetPaneId - ID of the target pane
 * @returns New layout tree with the tab moved
 */
export function moveTabBetweenPanes(
  root: LayoutNode,
  sourcePaneId: PaneId,
  tabIndex: number,
  targetPaneId: PaneId
): LayoutNode {
  const sourcePane = findPane(root, sourcePaneId);
  const targetPane = findPane(root, targetPaneId);
  if (!sourcePane || !targetPane) return root;
  if (tabIndex < 0 || tabIndex >= sourcePane.tabs.length) return root;
  if (sourcePaneId === targetPaneId) return root;

  const tab = sourcePane.tabs[tabIndex];

  // Remove from source
  let newRoot = removeTabFromPane(root, sourcePaneId, tabIndex);

  // Add to target
  newRoot = addTabToPane(newRoot, targetPaneId, tab);

  return newRoot;
}

/**
 * Set the active tab in a pane
 * 
 * @param root - The layout tree root
 * @param paneId - ID of the pane
 * @param tabIndex - Index of the tab to activate
 * @returns New layout tree with updated active tab
 */
export function setActiveTabInPane(
  root: LayoutNode,
  paneId: PaneId,
  tabIndex: number
): LayoutNode {
  const pane = findPane(root, paneId);
  if (!pane) return root;
  if (tabIndex < 0 || tabIndex >= pane.tabs.length) return root;

  return updatePaneTabs(root, paneId, pane.tabs, tabIndex);
}

/**
 * Update a tab's dirty state
 * 
 * @param root - The layout tree root
 * @param paneId - ID of the pane
 * @param tabIndex - Index of the tab
 * @param isDirty - New dirty state
 * @returns New layout tree with updated tab
 */
export function setTabDirty(
  root: LayoutNode,
  paneId: PaneId,
  tabIndex: number,
  isDirty: boolean
): LayoutNode {
  const pane = findPane(root, paneId);
  if (!pane) return root;
  if (tabIndex < 0 || tabIndex >= pane.tabs.length) return root;

  const newTabs = pane.tabs.map((tab, i) =>
    i === tabIndex ? { ...tab, isDirty } : tab
  );

  return updatePaneTabs(root, paneId, newTabs, pane.activeTabIndex);
}

/**
 * Get the first valid pane ID in the tree
 * Used for fallback when active pane is removed
 */
export function getFirstPaneId(root: LayoutNode): PaneId | null {
  const paneIds = getAllPaneIds(root);
  return paneIds.length > 0 ? paneIds[0] : null;
}


/**
 * Remove all tabs with a specific file path from all panes
 * Used when a file is deleted to clean up orphaned tabs
 * 
 * @param root - The layout tree root
 * @param filePath - Path of the file to remove tabs for
 * @returns New layout tree with matching tabs removed
 */
export function removeTabsByPath(
  root: LayoutNode,
  filePath: string
): LayoutNode {
  function transform(node: LayoutNode): LayoutNode {
    if (isPaneNode(node)) {
      // Filter out tabs with matching path
      const newTabs = node.tabs.filter(tab => tab.filePath !== filePath);
      
      // If no tabs were removed, return unchanged
      if (newTabs.length === node.tabs.length) {
        return node;
      }

      // Adjust active tab index
      let newActiveIndex = node.activeTabIndex;
      if (newTabs.length === 0) {
        newActiveIndex = -1;
      } else {
        // Find how many tabs before the active one were removed
        const removedBeforeActive = node.tabs
          .slice(0, node.activeTabIndex + 1)
          .filter(tab => tab.filePath === filePath).length;
        
        newActiveIndex = Math.max(0, Math.min(
          node.activeTabIndex - removedBeforeActive,
          newTabs.length - 1
        ));
      }

      return {
        ...node,
        tabs: newTabs,
        activeTabIndex: newActiveIndex,
      };
    }

    // Recursively transform split children
    return {
      ...node,
      children: node.children.map(child => transform(child)),
    };
  }

  return transform(root);
}

/**
 * Update the path and filename of tabs matching an old path
 * Used when a file is renamed to update open tabs
 * 
 * @param root - The layout tree root
 * @param oldPath - Old file path to match
 * @param newPath - New file path to set
 * @returns New layout tree with updated tab paths
 */
export function updateTabsPath(
  root: LayoutNode,
  oldPath: string,
  newPath: string
): LayoutNode {
  // Extract new filename from path
  const newFileName = newPath.split('/').pop() || newPath;

  function transform(node: LayoutNode): LayoutNode {
    if (isPaneNode(node)) {
      // Update tabs with matching path
      const newTabs = node.tabs.map(tab => {
        if (tab.filePath === oldPath) {
          return {
            ...tab,
            filePath: newPath,
            fileName: newFileName,
          };
        }
        return tab;
      });
      
      // Check if any tabs were updated
      const hasChanges = newTabs.some((tab, i) => tab !== node.tabs[i]);
      if (!hasChanges) {
        return node;
      }

      return {
        ...node,
        tabs: newTabs,
      };
    }

    // Recursively transform split children
    return {
      ...node,
      children: node.children.map(child => transform(child)),
    };
  }

  return transform(root);
}
