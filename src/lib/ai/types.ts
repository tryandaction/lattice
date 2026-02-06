export type AiContextItemType = 'system' | 'file' | 'annotations';

export interface AiContextItem {
  type: AiContextItemType;
  title: string;
  content: string;
  metadata?: Record<string, string>;
}

export interface AiContext {
  items: AiContextItem[];
  toPrompt: () => string;
}

export interface AiProvider {
  id: string;
  name: string;
  generate: (prompt: string) => Promise<{ text: string }>;
}
