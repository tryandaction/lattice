import { expect, it } from 'vitest';
import { withRequestImages } from '../request-images';
it('preserves actual image data on the latest user message and keeps earlier text unchanged', () => {
  const messages = [{ role: 'system' as const, content: 'Research' }, { role: 'user' as const, content: 'Explain figure' }];
  const image = { type: 'image' as const, data: 'binary-fixture', mimeType: 'image/png' };
  const result = withRequestImages(messages, [image]);
  expect(result[1].content).toEqual([{ type: 'text', text: 'Explain figure' }, image]);
  expect(messages[1].content).toBe('Explain figure');
});
