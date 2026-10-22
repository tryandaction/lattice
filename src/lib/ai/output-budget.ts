import { isTrivialQuery } from './request-intent';

export type AiOutputPurpose = 'greeting' | 'standard' | 'detailed' | 'planning' | 'document-batch' | 'context-summary';
const PURPOSE_LIMITS: Record<AiOutputPurpose, number> = { greeting: 512, standard: 4096, detailed: 12288, planning: 4096, 'document-batch': 8192, 'context-summary': 700 };

/** Initial generation and recovery must agree with the provider's wire ceiling. */
export function effectiveOutputTokenCeiling(configured: number, modelLimit?: number): number {
  const userLimit = Number.isFinite(configured) && configured > 0 ? Math.max(1, Math.floor(configured)) : 4096;
  return modelLimit !== undefined && Number.isFinite(modelLimit) && modelLimit > 0
    ? Math.min(userLimit, Math.max(1, Math.floor(modelLimit))) : userLimit;
}

/** The configured limit is a ceiling, not a request size to send for every task. */
export function outputTokenBudget(configured: number, purpose: AiOutputPurpose): number {
  const limit = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 4096;
  return Math.max(1, Math.min(limit, PURPOSE_LIMITS[purpose]));
}

export function chatOutputBudget(configured: number, question: string, explanatory: boolean): number {
  return outputTokenBudget(configured,
    isTrivialQuery(question) ? 'greeting' : explanatory ? 'detailed' : 'standard');
}
