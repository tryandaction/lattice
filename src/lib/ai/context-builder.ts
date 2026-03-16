import { exportAnnotationsForAI } from '@/lib/annotation-ai-bridge';
import type { AnnotationItem } from '@/types/universal-annotation';
import type { AiContext, AiContextItem, AiMessage } from './types';
import { estimateTokens } from './token-estimator';
import { aiContextGraph } from './context-graph';

export function buildAiContext(params: {
  filePath: string;
  content: string;
  selection?: string;
  annotations?: AnnotationItem[];
  maxTokens?: number;
}): AiContext {
  const promptContext = aiContextGraph.buildPromptContext(
    {
      filePath: params.filePath,
      content: params.content,
      selection: params.selection,
      annotations: params.annotations,
      query: params.filePath,
    },
    params.maxTokens ?? Math.max(estimateTokens(params.content), 6000),
  );

  const items: AiContextItem[] = [
    {
      type: 'system',
      title: 'Project Context',
      content: 'Lattice is a local-first, evidence-first research workbench. Prefer precise, file-based answers with traceable references.',
    },
  ];

  for (const node of promptContext.nodes) {
    let type: AiContextItem['type'] = 'file';
    if (node.kind === 'selection') type = 'selection';
    if (node.kind === 'annotation') type = 'annotations';
    items.push({
      type,
      title: node.label,
      content: node.content,
      metadata: node.evidenceRef ? { locator: node.evidenceRef.locator } : undefined,
    });
  }

  if (params.annotations && params.annotations.length > 0 && !items.some((item) => item.type === 'annotations')) {
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
