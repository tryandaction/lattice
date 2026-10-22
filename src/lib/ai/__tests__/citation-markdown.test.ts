import { expect, it } from 'vitest';
import { linkifyBareCitationTokens } from '../citation-markdown';
import { getAnswerCitationLinks, validateAnswerCitations } from '../citation-validation';

it('recovers provider source tokens including a wrapped query without exposing their encoding', () => {
  const input = '论点。 citation:citation-v2-source?\nquote=This%20motivates%20the%20search\n下一段';
  expect(linkifyBareCitationTokens(input)).toBe('论点。 [来源](citation:citation-v2-source?quote=This%20motivates%20the%20search)\n下一段');
  expect(getAnswerCitationLinks(input)).toEqual([expect.objectContaining({ href: 'citation:citation-v2-source?quote=This%20motivates%20the%20search' })]);
  expect(validateAnswerCitations(input, []).issues).toHaveLength(1);
});
it('leaves code examples, existing links and raw HTML alone', () => {
  const input = '[p.3](citation:bound?quote=x%20y)\n`citation:example`\n```text\ncitation:example\n```\n<a href="citation:example">example</a>';
  expect(linkifyBareCitationTokens(input)).toBe(input);
});
it('is idempotent and preserves the prose and mathematical claim', () => {
  const input = '$\\delta^2$ 的误差项。 citation:citation-v2-a?quote=x%20y';
  const result = linkifyBareCitationTokens(input);
  expect(linkifyBareCitationTokens(result)).toBe(result);
  expect(result).toContain('$\\delta^2$ 的误差项。');
});
