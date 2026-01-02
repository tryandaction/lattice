/**
 * File System Types for Lattice Virtual Workspace
 * 
 * These types represent the hierarchical file tree structure
 * built from the File System Access API.
 */

/**
 * Represents a file node in the tree
 */
export interface FileNode {
  name: string;
  kind: "file";
  handle: FileSystemFileHandle;
  extension: string;
  path: string;
}

/**
 * Represents a directory node in the tree
 */
export interface DirectoryNode {
  name: string;
  kind: "directory";
  handle: FileSystemDirectoryHandle;
  children: TreeNode[];
  path: string;
  isExpanded: boolean;
}

/**
 * Union type for any node in the tree
 */
export type TreeNode = FileNode | DirectoryNode;

/**
 * Root file tree structure
 */
export interface FileTree {
  root: DirectoryNode | null;
}

/**
 * Type guard to check if a node is a file
 */
export function isFileNode(node: TreeNode): node is FileNode {
  return node.kind === "file";
}

/**
 * Type guard to check if a node is a directory
 */
export function isDirectoryNode(node: TreeNode): node is DirectoryNode {
  return node.kind === "directory";
}
