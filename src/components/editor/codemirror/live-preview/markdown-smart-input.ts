import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  runMarkdownEditingCommand,
  type MarkdownCommandPayload,
  type MarkdownEditingCommandId,
} from "./markdown-editing-commands";

interface SlashCommandSpec {
  label: string;
  detail: string;
  aliases?: string[];
  commandId: MarkdownEditingCommandId;
  payload?: MarkdownCommandPayload;
}

const SLASH_COMMANDS: SlashCommandSpec[] = [
  { label: "heading 1", detail: "Heading 1", aliases: ["h1", "#"], commandId: "insert.heading", payload: { headingLevel: 1 } },
  { label: "heading 2", detail: "Heading 2", aliases: ["h2", "##"], commandId: "insert.heading", payload: { headingLevel: 2 } },
  { label: "heading 3", detail: "Heading 3", aliases: ["h3", "###"], commandId: "insert.heading", payload: { headingLevel: 3 } },
  { label: "properties", detail: "YAML properties", aliases: ["frontmatter", "metadata"], commandId: "insert.properties", payload: { propertyKey: "status", propertyValue: "draft" } },
  { label: "table", detail: "Markdown table", aliases: ["grid", "|"], commandId: "insert.table" },
  { label: "callout note", detail: "Callout block", aliases: ["admonition", "note"], commandId: "insert.callout", payload: { calloutType: "note" } },
  { label: "callout tip", detail: "Tip callout", aliases: ["hint", "important"], commandId: "insert.callout", payload: { calloutType: "tip" } },
  { label: "task list", detail: "Task checklist", aliases: ["todo", "checkbox"], commandId: "insert.taskList" },
  { label: "code block", detail: "Fenced code block", aliases: ["fence", "```"], commandId: "insert.codeBlock" },
  { label: "math block", detail: "LaTeX math block", aliases: ["latex", "$$"], commandId: "insert.mathBlock" },
  { label: "footnote", detail: "Footnote reference", aliases: ["cite", "note ref"], commandId: "insert.footnote" },
  { label: "wiki link", detail: "Internal wiki link", aliases: ["internal link", "[["], commandId: "insert.wikiLink" },
  { label: "embed", detail: "Embedded attachment", aliases: ["attachment", "![[", "transclude"], commandId: "insert.embed" },
  { label: "image", detail: "Markdown image", aliases: ["picture", "asset"], commandId: "insert.image" },
];

function commandMatches(command: SlashCommandSpec, query: string): boolean {
  if (!query) return true;
  const terms = [command.label, command.detail, ...(command.aliases ?? [])];
  return terms.some((term) => term.toLowerCase().includes(query));
}

export function slashCommandCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/(?:^|\s)\/[\w -]*$/);
  if (!before) return null;

  const slashIndex = before.text.lastIndexOf("/");
  if (slashIndex < 0) return null;

  const from = before.from + slashIndex;
  const query = before.text.slice(slashIndex + 1).trim().toLowerCase();
  const options: Completion[] = SLASH_COMMANDS
    .filter((command) => commandMatches(command, query))
    .map((command) => ({
      label: command.label,
      detail: command.aliases?.length
        ? `${command.detail} · ${command.aliases.join(", ")}`
        : command.detail,
      type: "keyword",
      apply: (view) => {
        view.dispatch({
          changes: { from, to: context.pos, insert: "" },
          selection: EditorSelection.cursor(from),
        });
        runMarkdownEditingCommand(view, command.commandId, command.payload);
      },
    }));

  if (options.length === 0) return null;

  return {
    from: from + 1,
    options,
    validFor: /^[\w -]*$/,
  };
}

const URL_PATTERN = /^(https?:\/\/[^\s<>()]+|mailto:[^\s<>()]+)$/i;

function pasteUrlAsMarkdownLink(event: ClipboardEvent, view: EditorView): boolean {
  const text = event.clipboardData?.getData("text/plain")?.trim();
  if (!text || !URL_PATTERN.test(text)) return false;

  const selection = view.state.selection.main;
  if (selection.empty) return false;

  const selectedText = view.state.sliceDoc(selection.from, selection.to).trim();
  if (!selectedText || /^\[.*\]\(.*\)$/.test(selectedText)) return false;

  event.preventDefault();
  const insert = `[${selectedText}](${text})`;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(selection.from + insert.length),
  });
  return true;
}

const urlPasteExtension = EditorView.domEventHandlers({
  paste: pasteUrlAsMarkdownLink,
  keydown: (event, view) => {
    if (event.key !== " " || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (normalizeMarkdownShortcut(view)) {
      event.preventDefault();
      return true;
    }
    return false;
  },
});

function normalizeMarkdownShortcut(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const line = view.state.doc.lineAt(selection.head);
  const beforeCursor = view.state.sliceDoc(line.from, selection.head);
  const leading = beforeCursor.match(/^\s*/)?.[0] ?? "";
  const token = beforeCursor.slice(leading.length);
  const replaceLinePrefix = (insert: string, cursorOffset = insert.length) => {
    view.dispatch({
      changes: { from: line.from, to: selection.head, insert: `${leading}${insert}` },
      selection: EditorSelection.cursor(line.from + leading.length + cursorOffset),
    });
    return true;
  };

  if (/^#{1,6}$/.test(token)) {
    return replaceLinePrefix(`${token} `);
  }
  if (token === ">") {
    return replaceLinePrefix("> ");
  }
  if (/^[-*+]\[\]$/.test(token.replace(/\s+/g, ""))) {
    return replaceLinePrefix("- [ ] ");
  }
  if (token === "||" || token === "|") {
    return replaceLinePrefix("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |", 2);
  }

  return false;
}

export const markdownSmartInputExtension: Extension[] = [
  urlPasteExtension,
];
