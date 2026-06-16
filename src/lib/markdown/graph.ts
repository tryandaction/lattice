import { normalizeWorkspacePath } from "@/lib/link-router/path-utils";
import type { IndexedMarkdownLink, MarkdownLinkIndex } from "./link-index";

export interface MarkdownGraphNode {
  id: string;
  path: string;
  label: string;
  incoming: number;
  outgoing: number;
  degree: number;
  broken: boolean;
}

export interface MarkdownGraphEdge {
  id: string;
  source: string;
  target: string;
  rawTarget: string;
  label: string;
  broken: boolean;
}

export interface MarkdownGraph {
  nodes: MarkdownGraphNode[];
  edges: MarkdownGraphEdge[];
}

interface MutableGraphNode extends MarkdownGraphNode {
  incomingSet: Set<string>;
  outgoingSet: Set<string>;
}

export interface BuildMarkdownGraphOptions {
  includeBroken?: boolean;
}

function getNodeLabel(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const basename = normalized.split("/").pop() || normalized;
  return basename.replace(/\.(md|markdown)$/i, "");
}

function getBrokenNodeId(link: IndexedMarkdownLink, index: number): string {
  return `broken:${normalizeWorkspacePath(link.sourceFile)}:${link.rawTarget}:${index}`;
}

function ensureNode(nodes: Map<string, MutableGraphNode>, path: string, broken = false): MutableGraphNode {
  const normalized = broken ? path : normalizeWorkspacePath(path);
  const existing = nodes.get(normalized);
  if (existing) {
    existing.broken = existing.broken && broken;
    return existing;
  }

  const node: MutableGraphNode = {
    id: normalized,
    path: normalized,
    label: broken ? path.replace(/^broken:/, "") : getNodeLabel(normalized),
    incoming: 0,
    outgoing: 0,
    degree: 0,
    broken,
    incomingSet: new Set<string>(),
    outgoingSet: new Set<string>(),
  };
  nodes.set(normalized, node);
  return node;
}

function createEdge(link: IndexedMarkdownLink, target: string, index: number, broken: boolean): MarkdownGraphEdge {
  const source = normalizeWorkspacePath(link.sourceFile);
  return {
    id: `${source}->${target}:${index}`,
    source,
    target,
    rawTarget: link.rawTarget,
    label: link.displayText || link.rawTarget,
    broken,
  };
}

function finalizeNodes(nodes: Map<string, MutableGraphNode>): MarkdownGraphNode[] {
  return Array.from(nodes.values())
    .map((node) => ({
      id: node.id,
      path: node.path,
      label: node.label,
      incoming: node.incomingSet.size,
      outgoing: node.outgoingSet.size,
      degree: new Set([...node.incomingSet, ...node.outgoingSet]).size,
      broken: node.broken,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function buildMarkdownGraph(
  index: MarkdownLinkIndex,
  options: BuildMarkdownGraphOptions = {},
): MarkdownGraph {
  const nodes = new Map<string, MutableGraphNode>();
  const edges: MarkdownGraphEdge[] = [];
  let edgeIndex = 0;

  for (const [sourceFile, outgoingLinks] of index.outgoingByFile) {
    const source = normalizeWorkspacePath(sourceFile);
    const sourceNode = ensureNode(nodes, source);

    for (const link of outgoingLinks) {
      const resolvedTarget = link.resolvedPath ? normalizeWorkspacePath(link.resolvedPath) : null;
      const target = resolvedTarget ?? (options.includeBroken && link.broken ? getBrokenNodeId(link, edgeIndex) : null);
      if (!target) {
        continue;
      }

      const targetNode = ensureNode(nodes, target, !resolvedTarget);
      const edge = createEdge(link, targetNode.id, edgeIndex, !resolvedTarget);
      edgeIndex += 1;
      edges.push(edge);
      sourceNode.outgoingSet.add(targetNode.id);
      targetNode.incomingSet.add(sourceNode.id);
    }
  }

  return {
    nodes: finalizeNodes(nodes),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function buildLocalMarkdownGraph(graph: MarkdownGraph, centerFile: string, depth = 1): MarkdownGraph {
  const center = normalizeWorkspacePath(centerFile);
  const maxDepth = Math.max(0, Math.floor(depth));
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodeMap.has(center)) {
    return { nodes: [], edges: [] };
  }

  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set<string>());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set<string>());
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const visited = new Set<string>([center]);
  const queue: Array<{ id: string; depth: number }> = [{ id: center, depth: 0 }];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.depth >= maxDepth) {
      continue;
    }
    for (const next of adjacency.get(current.id) ?? []) {
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      queue.push({ id: next, depth: current.depth + 1 });
    }
  }

  return {
    nodes: graph.nodes.filter((node) => visited.has(node.id)),
    edges: graph.edges.filter((edge) => visited.has(edge.source) && visited.has(edge.target)),
  };
}
