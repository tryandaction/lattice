import { parseCloudSourceSelections, type CloudAgentSourceSelection } from "./cloud-source";

/** Keep routing mentions in the stored draft while the textbox edits only the question. */
export function cloudComposerInput(text: string, options: { committed?: boolean } = {}): { question: string; mentions: string[] } {
  const mentions: string[] = [];
  let question = "", cursor = 0;
  for (const match of text.matchAll(/@(cloud-folder|cloud):[^\s@]*/g)) {
    const mention = match[0].replace(/[，。；,;]+$/, "");
    // A hand-typed token is still editable until whitespace or punctuation closes it.
    if (!options.committed && !/[\s，。；,;]/u.test(text[match.index + mention.length] ?? "")) continue;
    if (parseCloudSourceSelections(mention).length !== 1) continue;
    mentions.push(mention);
    question += text.slice(cursor, match.index);
    cursor = match.index + mention.length;
    if (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
  }
  return { question: question + text.slice(cursor), mentions };
}

export function withCloudComposerQuestion(current: string, question: string): string {
  const { mentions } = cloudComposerInput(current);
  return mentions.length ? `${mentions.join(" ")} ${question}` : question;
}

export function withoutCloudComposerSource(current: string, source: CloudAgentSourceSelection): string {
  const { question, mentions } = cloudComposerInput(current);
  const remaining = mentions.filter(mention => {
    const selected = parseCloudSourceSelections(mention)[0];
    return selected.kind !== source.kind || selected.libraryId !== source.libraryId || selected.itemId !== source.itemId;
  });
  return remaining.length ? `${remaining.join(" ")} ${question}` : question;
}
