import type { MentionSuggestion } from './mention-resolver';

export interface MentionSelectionResult {
  value: string;
  continueSelection: boolean;
  nextQuery: string | null;
}

export type MentionSelectionStage = 'files' | 'fragments';

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

  if (item.type === 'file' && (!currentHasFragment || isFragmentPlaceholder)) {
    const nextValue = valueHasFragment
      ? item.value
      : `${item.value}#`;
    return {
      value: nextValue,
      continueSelection: true,
      nextQuery: nextValue.slice(1),
    };
  }

  return {
    value: item.value,
    continueSelection: false,
    nextQuery: null,
  };
}
