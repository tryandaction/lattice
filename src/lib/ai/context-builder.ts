import { exportAnnotationsForAI } from '@/lib/annotation-ai-bridge';
import type { AnnotationItem } from '@/types/universal-annotation';
import type { AiContext, AiContextItem } from './types';

export function buildAiContext(params: {
  filePath: string;
  content: string;
  annotations?: AnnotationItem[];
}): AiContext {
  const items: AiContextItem[] = [];

  items.push({
    type: 'system',
    title: 'Project Context',
    content: 'Lattice is a local-first research workbench. Prefer precise, file-based answers.',
  });

  items.push({
    type: 'file',
    title: `File: ${params.filePath}`,
    content: params.content,
    metadata: { path: params.filePath },
  });

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
  };
}
