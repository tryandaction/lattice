/**
 * AI Token Estimator
 * Provides better token count estimates than simple length/4
 * Adapts to content type (English, CJK, code)
 */

/**
 * Detect dominant content type for better estimation
 */
function detectContentType(text: string): 'english' | 'cjk' | 'code' | 'mixed' {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const codeIndicators = (text.match(/[{}();=<>\/\[\]]/g) || []).length;
  const totalChars = text.length;

  if (totalChars === 0) return 'english';

  const cjkRatio = cjkChars / totalChars;
  const codeRatio = codeIndicators / totalChars;

  if (cjkRatio > 0.3) return 'cjk';
  if (codeRatio > 0.05) return 'code';
  if (cjkRatio > 0.1) return 'mixed';
  return 'english';
}

/**
 * Estimate token count for a given text
 *
 * Heuristics:
 * - English prose: ~4 chars per token (1 token ≈ 0.75 words)
 * - CJK text: ~1.5 chars per token
 * - Code: ~3.5 chars per token
 * - Mixed: ~3 chars per token
 */
export function estimateTokens(text: string, _model?: string): number {
  if (!text) return 0;

  const contentType = detectContentType(text);

  switch (contentType) {
    case 'english':
      return Math.ceil(text.length / 4);
    case 'cjk':
      return Math.ceil(text.length / 1.5);
    case 'code':
      return Math.ceil(text.length / 3.5);
    case 'mixed':
      return Math.ceil(text.length / 3);
    default:
      return Math.ceil(text.length / 4);
  }
}

/**
 * Estimate cost in USD for a given token count
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  // Pricing per 1M tokens (approximate, as of 2025)
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4.1': { input: 2, output: 8 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-4.1-nano': { input: 0.1, output: 0.4 },
    'o3': { input: 10, output: 40 },
    'o3-mini': { input: 1.1, output: 4.4 },
    'o4-mini': { input: 1.1, output: 4.4 },
    'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
    'claude-opus-4-6': { input: 15, output: 75 },
    'claude-sonnet-4-20250514': { input: 3, output: 15 },
    'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
    'gemini-2.5-pro': { input: 1.25, output: 10 },
    'gemini-2.5-flash': { input: 0.15, output: 0.6 },
    'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  };

  const price = pricing[model] ?? { input: 2, output: 8 };
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
