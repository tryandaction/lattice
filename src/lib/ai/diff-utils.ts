/**
 * Diff Utilities for AI Suggestions
 * Line-based diff computation and application
 */

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  unchanged: number;
}

/**
 * Compute a line-based diff between original and modified text
 * Uses a simple LCS (Longest Common Subsequence) approach
 */
export function computeDiff(original: string, modified: string): DiffResult {
  const oldLines = original.split('\n');
  const newLines = modified.split('\n');

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const lines: DiffLine[] = [];
  let i = m, j = n;

  const stack: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'unchanged', content: oldLines[i - 1], oldLineNum: i, newLineNum: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', content: newLines[j - 1], newLineNum: j });
      j--;
    } else {
      stack.push({ type: 'removed', content: oldLines[i - 1], oldLineNum: i });
      i--;
    }
  }

  // Reverse since we built it backwards
  for (let k = stack.length - 1; k >= 0; k--) {
    lines.push(stack[k]);
  }

  const additions = lines.filter(l => l.type === 'added').length;
  const deletions = lines.filter(l => l.type === 'removed').length;
  const unchanged = lines.filter(l => l.type === 'unchanged').length;

  return { lines, additions, deletions, unchanged };
}

/**
 * Apply a diff to produce the modified text
 */
export function applyDiff(original: string, diff: DiffResult): string {
  const result: string[] = [];
  for (const line of diff.lines) {
    if (line.type === 'unchanged' || line.type === 'added') {
      result.push(line.content);
    }
    // 'removed' lines are skipped
  }
  return result.join('\n');
}

/**
 * Extract code blocks from AI response text
 * Returns array of { language, code } objects
 */
export function extractCodeBlocks(text: string): Array<{ language: string; code: string }> {
  const blocks: Array<{ language: string; code: string }> = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: match[1] || '',
      code: match[2].trimEnd(),
    });
  }
  return blocks;
}
