import type { DirectoryNode, FileNode, TreeNode } from "@/types/file-system";

function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function replacePathPrefix(path: string, sourcePath: string, nextPath: string): string {
  if (path === sourcePath) {
    return nextPath;
  }
  if (path.startsWith(`${sourcePath}/`)) {
    return `${nextPath}${path.slice(sourcePath.length)}`;
  }
  return path;
}

function rewriteTreeNode(
  node: TreeNode,
  sourcePath: string,
  nextPath: string,
  nextHandle?: FileSystemHandle,
): TreeNode {
  const rewrittenPath = replacePathPrefix(node.path, sourcePath, nextPath);
  const rewrittenName = rewrittenPath.split("/").pop() || node.name;
  const handle = node.path === sourcePath && nextHandle ? nextHandle : node.handle;

  if (node.kind === "directory") {
    return {
      ...node,
      name: rewrittenName,
      path: rewrittenPath,
      handle: handle as FileSystemDirectoryHandle,
      children: node.children.map((child) => rewriteTreeNode(child, sourcePath, nextPath)),
    };
  }

  const fileNode: FileNode = {
    ...node,
    name: rewrittenName,
    path: rewrittenPath,
    handle: handle as FileSystemFileHandle,
  };
  if (fileNode.parentPdfPath) {
    fileNode.parentPdfPath = replacePathPrefix(fileNode.parentPdfPath, sourcePath, nextPath);
  }
  if (fileNode.children?.length) {
    fileNode.children = fileNode.children.map((child) => rewriteTreeNode(child, sourcePath, nextPath));
  }
  return fileNode;
}

export function findTreeNode(root: DirectoryNode, path: string): TreeNode | null {
  if (root.path === path) {
    return root;
  }
  for (const child of root.children) {
    if (child.path === path) {
      return child;
    }
    if (child.kind === "directory") {
      const found = findTreeNode(child, path);
      if (found) {
        return found;
      }
    } else if (child.children?.length) {
      for (const virtualChild of child.children) {
        if (virtualChild.path === path) {
          return virtualChild;
        }
      }
    }
  }
  return null;
}

export function insertTreeNode(root: DirectoryNode, parentPath: string, node: TreeNode): DirectoryNode {
  if (root.path === parentPath) {
    const withoutDuplicate = root.children.filter((child) => child.path !== node.path);
    return {
      ...root,
      children: sortTreeNodes([...withoutDuplicate, node]),
    };
  }

  let changed = false;
  const children = root.children.map((child) => {
    if (child.kind !== "directory") {
      return child;
    }
    const nextChild = insertTreeNode(child, parentPath, node);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });

  return changed ? { ...root, children } : root;
}

export interface RemoveTreeNodeResult {
  root: DirectoryNode;
  removed: TreeNode | null;
}

export function removeTreeNode(root: DirectoryNode, path: string): RemoveTreeNodeResult {
  const directMatch = root.children.find((child) => child.path === path);
  if (directMatch) {
    return {
      root: {
        ...root,
        children: root.children.filter((child) => child.path !== path),
      },
      removed: directMatch,
    };
  }

  for (let index = 0; index < root.children.length; index += 1) {
    const child = root.children[index];
    if (child.kind !== "directory") {
      continue;
    }
    const nested = removeTreeNode(child, path);
    if (nested.removed) {
      const children = [...root.children];
      children[index] = nested.root;
      return {
        root: { ...root, children },
        removed: nested.removed,
      };
    }
  }

  return { root, removed: null };
}

export interface RelocateTreeNodeInput {
  sourcePath: string;
  targetDirectoryPath: string | null;
  nextPath: string;
  nextHandle?: FileSystemHandle;
}

export interface CopyTreeNodeInput {
  sourcePath: string;
  targetDirectoryPath: string;
  nextPath: string;
  nextHandle?: FileSystemHandle;
}

export function copyTreeNode(root: DirectoryNode, input: CopyTreeNodeInput): DirectoryNode {
  const source = findTreeNode(root, input.sourcePath);
  const target = findTreeNode(root, input.targetDirectoryPath);
  if (!source || target?.kind !== "directory") {
    return root;
  }

  const copied = rewriteTreeNode(
    source,
    input.sourcePath,
    input.nextPath,
    input.nextHandle,
  );
  return insertTreeNode(root, input.targetDirectoryPath, copied);
}

export function relocateTreeNode(root: DirectoryNode, input: RelocateTreeNodeInput): DirectoryNode {
  if (input.targetDirectoryPath && !findTreeNode(root, input.targetDirectoryPath)) {
    return root;
  }

  const removed = removeTreeNode(root, input.sourcePath);
  if (!removed.removed) {
    return root;
  }

  if (!input.targetDirectoryPath) {
    return removed.root;
  }

  const relocated = rewriteTreeNode(
    removed.removed,
    input.sourcePath,
    input.nextPath,
    input.nextHandle,
  );
  return insertTreeNode(removed.root, input.targetDirectoryPath, relocated);
}
