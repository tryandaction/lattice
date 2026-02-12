import { exportAnnotationsForAI } from '@/lib/annotation-ai-bridge';
import type { AnnotationItem } from '@/types/universal-annotation';
import type { AiContext, AiContextItem, AiMessage } from './types';

export function buildAiContext(params: {
  filePath: string;
  content: string;
  selection?: string;
  annotations?: AnnotationItem[];
  maxTokens?: number;
}): AiContext {
  const items: AiContextItem[] = [];

  items.push({
    type: 'system',
    title: 'Project Context',
    content: 'Lattice is a local-first research workbench. Prefer precise, file-based answers.',
  });

  // If content is too long, truncate to fit within model context window
  let fileContent = params.content;
  if (params.maxTokens) {
    const estimatedTokens = Math.ceil(fileContent.length / 4);
    const budget = Math.floor(params.maxTokens * 0.6); // 60% for file content
    if (estimatedTokens > budget) {
      const charLimit = budget * 4;
      fileContent = fileContent.slice(0, charLimit) + '\n\n[... truncated]';
    }
  }

  items.push({
    type: 'file',
    title: `File: ${params.filePath}`,
    content: fileContent,
    metadata: { path: params.filePath },
  });

  if (params.selection) {
    items.push({
      type: 'selection',
      title: 'Selected Text',
      content: params.selection,
    });
  }

  if (params.annotations && params.annotations.length > 0) {
    items.push({
      type: 'annotations',
      title: 'Annotations',
      content: exportAnnotationsForAI(params.annotations),
    });
  }

  return {
    items,
    toPrompt: () =>
      items
        .map((item) => `# ${item.title}\n${item.content}`)
        .join('\n\n'),
    toMessages: () => {
      const messages: AiMessage[] = [];
      const systemItems = items.filter((i) => i.type === 'system');
      const contextItems = items.filter((i) => i.type !== 'system');

      if (systemItems.length > 0) {
        messages.push({
          role: 'system',
          content: systemItems.map((i) => i.content).join('\n\n'),
        });
      }

      if (contextItems.length > 0) {
        messages.push({
          role: 'user',
          content: contextItems
            .map((item) => `# ${item.title}\n${item.content}`)
            .join('\n\n'),
        });
      }

      return messages;
    },
  };
}
