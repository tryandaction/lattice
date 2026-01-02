"use client";

import type { DirectoryNode } from "@/types/file-system";
import { TreeNodeComponent } from "./tree-node";

interface TreeViewProps {
  root: DirectoryNode;
}

/**
 * Tree View component that renders the file tree
 * Starts from the root directory node
 */
export function TreeView({ root }: TreeViewProps) {
  return (
    <div className="py-2">
      <TreeNodeComponent node={root} depth={0} />
    </div>
  );
}
