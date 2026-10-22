import type { MentionSuggestion } from './mention-resolver';

export interface MentionSelectionResult {
  value: string;
  continueSelection: boolean;
  nextQuery: string | null;
}

export type MentionSelectionStage = 'files' | 'fragments';

const COMPLETE_FOLDER_TASK_SUFFIX = /(?:中|里|下|内)(?:的)?(?=(?:文章|论文|文档|文件|资料|笔记|所有|全部|有哪些|有哪|包含|含有|都|查找|搜索|阅读|通读|总结|分析|解释|讲述|比较|对比|内容))/u;

/** UI-generated paths are encoded; whitespace ends the mention being edited. */
export function getActiveMentionQuery(value: string, caret: number): string | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || at > 0 && !/[\s([{，。；：、“「《]/u.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/[\s@]/u.test(query)) return null;
  // A manually typed folder mention may be followed immediately by Chinese
  // task text (the picker normally inserts a separating space). Once the
  // suffix is unambiguously an operation on the folder, let Enter reach the
  // composer instead of trapping it in an empty picker.
  if (query.startsWith('folder:')) {
    const pathQuery = query.slice('folder:'.length);
    const suffix = COMPLETE_FOLDER_TASK_SUFFIX.exec(pathQuery);
    if (suffix && suffix.index > pathQuery.lastIndexOf('/')) return null;
  }
  return query;
}

export function getMentionSelectionStage(query: string): MentionSelectionStage {
  return query.includes('#') ? 'fragments' : 'files';
}

export function createMentionBacktrackResult(currentQuery: string): MentionSelectionResult {
  const [fileQuery] = currentQuery.split('#', 1);
  const nextQuery = fileQuery.trim();
  return {
    value: `@${nextQuery}`,
    continueSelection: true,
    nextQuery,
  };
}

export function createMentionSelectionResult(
  item: Pick<MentionSuggestion, 'type' | 'value'>,
  currentQuery: string,
): MentionSelectionResult {
  const currentHasFragment = currentQuery.includes('#');
  const valueHasFragment = item.value.includes('#');
  const isFragmentPlaceholder = item.value.endsWith('#');

  if (item.type === 'file' && currentHasFragment && isFragmentPlaceholder) {
    const nextValue = valueHasFragment
      ? item.value
      : `${item.value}#`;
    return {
      value: nextValue,
      continueSelection: true,
      nextQuery: nextValue.slice(1),
    };
  }

  if (item.type === 'folder') {
    return { value: item.value, continueSelection: false, nextQuery: null };
  }

  return {
    value: item.value,
    continueSelection: false,
    nextQuery: null,
  };
}
