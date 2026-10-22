import { HARNESS_PROMPT_BYTE_LIMIT } from './protocol';

interface HarnessToolOutput { success: boolean; text: string }

/** Keep the native UTF-8 wire limit separate from source character budgets. */
export function serializeHarnessToolResult(result: HarnessToolOutput): HarnessToolOutput {
  const byteLength = new TextEncoder().encode(result.text).byteLength;
  if (byteLength <= HARNESS_PROMPT_BYTE_LIMIT) return result;

  return { success: false, text: JSON.stringify({
    error: {
      code: 'tool_result_budget_exceeded', recoverable: true,
      message: 'The tool response exceeds the native UTF-8 result budget. Its original output was omitted, not truncated. The operation may already have executed.',
      resultBytes: byteLength, maxResultBytes: HARNESS_PROMPT_BYTE_LIMIT,
      retry: 'For reads/searches, reduce maxChars and maxUnits; for listings, reduce limit and resume with the last received cursor. Use returned unit offsets for partial reads. Do not assume omitted results or complete coverage. For proposals, inspect the existing Workbench draft before repeating the action.',
    },
  }) };
}
