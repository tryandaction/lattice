/**
 * Mention Resolver
 * Parses @mentions from chat messages and resolves them to file content
 */

import { useWorkspaceStore } from '@/stores/workspace-store';
import type { LayoutNode } from '@/types/layout';

export interface Mention {
  type: 'file' | 'selection';
  raw: string;       // e.g. "@README.md" or "@selection"
  target: string;    // e.g. "README.md" or "selection"
  resolved?: string; // resolved content
}

/** Collect all tabs from the layout tree */
function collectAllTabs(node: LayoutNode): Array<{ filePath: string }> {
  if (node.type === 'pane') return node.tabs;
  return node.children.flatMap(c => collectAllTabs(c));
}

/**
 * Parse @mentions from a message string
 * Supports: @filename.ext, @selection
 */
export function parseMentions(text: string): Mention[] {
  const mentions: Mention[] = [];
  const regex = /@(selection|[\w./-]+\.\w+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const target = match[1];
    mentions.push({
      type: target === 'selection' ? 'selection' : 'file',
      raw: match[0],
      target,
    });
  }

  return mentions;
}

/**
 * Resolve all mentions in a message to their content
 */
export async function resolveMentions(
  mentions: Mention[],
  options?: {
    currentSelection?: string;
    readFile?: (path: string) => Promise<string>;
  }
): Promise<Mention[]> {
  const resolved: Mention[] = [];

  for (const mention of mentions) {
    if (mention.type === 'selection') {
      resolved.push({
        ...mention,
        resolved: options?.currentSelection ?? '[No text selected]',
      });
    } else if (mention.type === 'file') {
      try {
        let content: string;
        if (options?.readFile) {
          content = await options.readFile(mention.target);
        } else {
          const state = useWorkspaceStore.getState();
          const allTabs = collectAllTabs(state.layout.root);
          const tab = allTabs.find(t => t.filePath.endsWith(mention.target));
          content = tab ? `[File: ${tab.filePath}]` : `[File not found: ${mention.target}]`;
        }
        resolved.push({ ...mention, resolved: content });
      } catch {
        resolved.push({ ...mention, resolved: `[Error reading: ${mention.target}]` });
      }
    }
  }

  return resolved;
}

/**
 * Build enriched context string from a message text (convenience wrapper)
 */
export async function buildMentionContext(text: string): Promise<string> {
  const mentions = parseMentions(text);
  if (mentions.length === 0) return '';
  const resolved = await resolveMentions(mentions);
  return resolved
    .filter(m => m.resolved)
    .map(m => {
      const header = m.type === 'selection'
        ? '## Current Selection'
        : `## File: ${m.target}`;
      return `${header}\n${m.resolved}`;
    })
    .join('\n\n');
}

/**
 * Strip @mentions from message text
 */
export function stripMentions(text: string): string {
  return text.replace(/@(selection|[\w./-]+\.\w+)/g, '').trim();
}

/**
 * Get available files for mention autocomplete
 */
export function getAvailableFiles(): Array<{ path: string; name: string }> {
  try {
    const state = useWorkspaceStore.getState();
    const allTabs = collectAllTabs(state.layout.root);
    const files = allTabs.map(t => ({
      path: t.filePath,
      name: t.filePath.split('/').pop() ?? t.filePath,
    }));
    const seen = new Set<string>();
    return files.filter(f => {
      if (seen.has(f.path)) return false;
      seen.add(f.path);
      return true;
    });
  } catch {
    return [];
  }
}
