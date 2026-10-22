import type { AiContentPart, AiMessage } from './types';

/** Attach actual raster input to the latest request without converting it to text. */
export function withRequestImages(messages: AiMessage[], images?: readonly AiContentPart[]): AiMessage[] {
  if (!images?.length) return messages;
  const index = messages.findLastIndex(message => message.role === 'user');
  if (index < 0) throw new Error('图片需要附属于用户请求。');
  const content = messages[index].content;
  const parts: AiContentPart[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  return messages.map((message, position) => position === index ? { ...message, content: [...parts, ...images] } : message);
}
