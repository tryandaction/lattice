import type { AiProvider, AiStreamChunk } from './types';
import { useSettingsStore } from '@/stores/settings-store';

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful research assistant in Lattice, a scientific workbench. Be concise and precise.';

function getSystemPrompt(): string {
  try {
    return useSettingsStore.getState().settings.aiSystemPrompt || DEFAULT_SYSTEM_PROMPT;
  } catch {
    return DEFAULT_SYSTEM_PROMPT;
  }
}

export async function* summarizeSelection(text: string, provider: AiProvider): AsyncIterable<string> {
  const messages = [
    { role: 'system' as const, content: getSystemPrompt() },
    { role: 'user' as const, content: `Summarize the following text concisely:\n\n${text}` },
  ];
  for await (const chunk of provider.stream(messages, { temperature: 0.3, maxTokens: 512 })) {
    if (chunk.type === 'text' && chunk.text) yield chunk.text;
  }
}

export async function* translateText(text: string, targetLang: string, provider: AiProvider): AsyncIterable<string> {
  const messages = [
    { role: 'system' as const, content: getSystemPrompt() },
    { role: 'user' as const, content: `Translate the following text to ${targetLang}. Only output the translation, nothing else:\n\n${text}` },
  ];
  for await (const chunk of provider.stream(messages, { temperature: 0.2, maxTokens: 2048 })) {
    if (chunk.type === 'text' && chunk.text) yield chunk.text;
  }
}

export async function* explainFormula(formula: string, provider: AiProvider): AsyncIterable<string> {
  const messages = [
    { role: 'system' as const, content: getSystemPrompt() },
    { role: 'user' as const, content: `Explain this formula/equation step by step:\n\n${formula}` },
  ];
  for await (const chunk of provider.stream(messages, { temperature: 0.3, maxTokens: 1024 })) {
    if (chunk.type === 'text' && chunk.text) yield chunk.text;
  }
}

export async function* improveWriting(text: string, provider: AiProvider): AsyncIterable<string> {
  const messages = [
    { role: 'system' as const, content: getSystemPrompt() },
    { role: 'user' as const, content: `Improve the following text for clarity and academic style. Output only the improved text:\n\n${text}` },
  ];
  for await (const chunk of provider.stream(messages, { temperature: 0.5, maxTokens: 2048 })) {
    if (chunk.type === 'text' && chunk.text) yield chunk.text;
  }
}

export async function* generateOutline(topic: string, provider: AiProvider): AsyncIterable<string> {
  const messages = [
    { role: 'system' as const, content: getSystemPrompt() },
    { role: 'user' as const, content: `Generate a detailed outline for a research document about:\n\n${topic}` },
  ];
  for await (const chunk of provider.stream(messages, { temperature: 0.7, maxTokens: 1024 })) {
    if (chunk.type === 'text' && chunk.text) yield chunk.text;
  }
}

export async function* continueWriting(text: string, provider: AiProvider): AsyncIterable<string> {
  const messages = [
    { role: 'system' as const, content: getSystemPrompt() },
    { role: 'user' as const, content: `Continue writing from where this text left off. Match the style and tone:\n\n${text}` },
  ];
  for await (const chunk of provider.stream(messages, { temperature: 0.7, maxTokens: 1024 })) {
    if (chunk.type === 'text' && chunk.text) yield chunk.text;
  }
}
