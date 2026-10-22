import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { linter, type Diagnostic as CodeMirrorDiagnostic } from "@codemirror/lint";
import { EditorState, type Extension, type Text } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";
import type {
  VSCodeHostLanguageFeatureRequest,
  VSCodeHostLanguageFeatureResponse,
  VSCodeHostPosition,
  VSCodeHostRange,
} from "@/lib/vscode-extension-host/types";

interface VSCodeCompletionResult {
  label?: unknown;
  detail?: unknown;
  documentation?: unknown;
  kind?: unknown;
  insertText?: unknown;
  filterText?: unknown;
  sortText?: unknown;
}

interface VSCodeHoverResult {
  contents?: unknown;
  range?: VSCodeHostRange;
}

interface VSCodeDefinitionResult {
  filePath?: unknown;
  range?: VSCodeHostRange;
}

interface VSCodeDiagnosticResult {
  message?: unknown;
  severity?: unknown;
  code?: unknown;
  source?: unknown;
  range?: VSCodeHostRange;
}

interface VSCodeTextEditResult {
  range?: VSCodeHostRange;
  newText?: unknown;
}

interface VSCodeWorkspaceEditResult {
  changes?: unknown;
}

export type VSCodeRenameApplyResult =
  | { supported: true; content: string }
  | { supported: false; reason: "empty" | "cross-file" | "invalid" };

export type VSCodeCodeActionApplyResult =
  | {
    supported: true;
    title: string;
    content: string;
    command?: { command: string; arguments: unknown[] };
  }
  | { supported: false; reason: "empty" | "disabled" | "cross-file" | "invalid" };

export interface VSCodeDefinitionLocation {
  filePath: string;
  line: number;
  column: number;
}

export interface VSCodeLanguageBridgeOptions {
  filePath: string;
  languageId: string;
  getVersion: () => number;
  request: (request: VSCodeHostLanguageFeatureRequest) => Promise<VSCodeHostLanguageFeatureResponse>;
  onDiagnostics?: (diagnostics: VSCodeLanguageDiagnostic[]) => void;
}

export interface VSCodeLanguageDiagnostic extends CodeMirrorDiagnostic {
  line: number;
}

const COMPLETION_KIND_TO_TYPE: Record<number, string> = {
  0: "text",
  1: "method",
  2: "function",
  3: "class",
  4: "property",
  5: "variable",
  6: "class",
  7: "type",
  8: "namespace",
  9: "property",
  11: "constant",
  12: "enum",
  13: "keyword",
  14: "snippet",
  16: "file",
  17: "reference",
  18: "folder",
  19: "enum",
  20: "constant",
  21: "type",
  22: "event",
  23: "operator",
  24: "type",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function isPosition(value: unknown): value is VSCodeHostPosition {
  const record = asRecord(value);
  return Boolean(
    record &&
    Number.isInteger(Number(record.line)) &&
    Number(record.line) >= 0 &&
    Number.isInteger(Number(record.character)) &&
    Number(record.character) >= 0,
  );
}

function isRange(value: unknown): value is VSCodeHostRange {
  const record = asRecord(value);
  return Boolean(record && isPosition(record.start) && isPosition(record.end));
}

function positionToOffset(doc: Text, position: VSCodeHostPosition): number {
  const lineNumber = Math.min(doc.lines, position.line + 1);
  const line = doc.line(lineNumber);
  return Math.min(line.to, line.from + position.character);
}

function rangeToOffsets(doc: Text, range: VSCodeHostRange): { from: number; to: number } {
  const from = positionToOffset(doc, range.start);
  const to = positionToOffset(doc, range.end);
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

export function offsetToVSCodePosition(doc: Text, offset: number): VSCodeHostPosition {
  const boundedOffset = Math.max(0, Math.min(doc.length, offset));
  const line = doc.lineAt(boundedOffset);
  return {
    line: line.number - 1,
    character: boundedOffset - line.from,
  };
}

export function textOffsetToVSCodePosition(text: string, offset: number): VSCodeHostPosition {
  const boundedOffset = Math.max(0, Math.min(text.length, offset));
  const before = text.slice(0, boundedOffset);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length - 1,
    character: lines.at(-1)?.length ?? 0,
  };
}

export function mapVSCodeCompletionResponse(
  response: VSCodeHostLanguageFeatureResponse,
  currentVersion: number,
  from: number,
): CompletionResult | null {
  if (!response.ok || response.feature !== "completion" || response.documentVersion !== currentVersion) {
    return null;
  }
  const options = response.results.flatMap((value) => {
    const item = asRecord(value) as VSCodeCompletionResult | null;
    if (!item || typeof item.label !== "string" || !item.label) {
      return [];
    }
    const kind = Number(item.kind);
    return [{
      label: item.label,
      ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
      ...(typeof item.documentation === "string" ? { info: item.documentation } : {}),
      ...(typeof item.insertText === "string" ? { apply: item.insertText } : {}),
      ...(typeof item.filterText === "string" ? { boost: item.filterText === item.label ? 1 : 0 } : {}),
      type: COMPLETION_KIND_TO_TYPE[kind] ?? "variable",
    }];
  });
  return options.length > 0 ? { from, options } : null;
}

function diagnosticSeverity(value: unknown): CodeMirrorDiagnostic["severity"] {
  if (Number(value) === 1) return "warning";
  if (Number(value) === 2) return "info";
  if (Number(value) === 3) return "hint";
  return "error";
}

export function mapVSCodeDiagnosticsResponse(
  response: VSCodeHostLanguageFeatureResponse,
  currentVersion: number,
  doc: Text,
): CodeMirrorDiagnostic[] {
  if (!response.ok || response.feature !== "diagnostics" || response.documentVersion !== currentVersion) {
    return [];
  }
  return response.results.flatMap((value) => {
    const diagnostic = asRecord(value) as VSCodeDiagnosticResult | null;
    if (!diagnostic || typeof diagnostic.message !== "string" || !isRange(diagnostic.range)) {
      return [];
    }
    const offsets = rangeToOffsets(doc, diagnostic.range);
    return [{
      ...offsets,
      severity: diagnosticSeverity(diagnostic.severity),
      message: diagnostic.message,
      ...(typeof diagnostic.source === "string" ? { source: diagnostic.source } : {}),
    }];
  });
}

export function firstVSCodeDefinitionLocation(
  response: VSCodeHostLanguageFeatureResponse,
  currentVersion: number,
): VSCodeDefinitionLocation | null {
  if (!response.ok || response.feature !== "definition" || response.documentVersion !== currentVersion) {
    return null;
  }
  for (const value of response.results) {
    const definition = asRecord(value) as VSCodeDefinitionResult | null;
    if (definition && typeof definition.filePath === "string" && isRange(definition.range)) {
      return {
        filePath: definition.filePath,
        line: definition.range.start.line + 1,
        column: definition.range.start.character + 1,
      };
    }
  }
  return null;
}

export function mapVSCodeReferenceLocations(
  response: VSCodeHostLanguageFeatureResponse,
  currentVersion: number,
): VSCodeDefinitionLocation[] {
  if (!response.ok || response.feature !== "references" || response.documentVersion !== currentVersion) {
    return [];
  }
  return response.results.flatMap((value) => {
    const reference = asRecord(value) as VSCodeDefinitionResult | null;
    if (!reference || typeof reference.filePath !== "string" || !isRange(reference.range)) {
      return [];
    }
    return [{
      filePath: reference.filePath,
      line: reference.range.start.line + 1,
      column: reference.range.start.character + 1,
    }];
  });
}

export function applyVSCodeFormattingResponse(
  text: string,
  response: VSCodeHostLanguageFeatureResponse,
  currentVersion: number,
): string {
  if (!response.ok || response.feature !== "formatting" || response.documentVersion !== currentVersion) {
    return text;
  }
  const doc = EditorState.create({ doc: text }).doc;
  const edits = response.results.flatMap((value) => {
    const edit = asRecord(value) as VSCodeTextEditResult | null;
    if (!edit || typeof edit.newText !== "string" || !isRange(edit.range)) {
      return [];
    }
    return [{ ...rangeToOffsets(doc, edit.range), newText: edit.newText }];
  });

  return applyTextEdits(text, edits) ?? text;
}

function applyTextEdits(
  text: string,
  edits: Array<{ from: number; to: number; newText: string }>,
): string | null {
  const ordered = [...edits].sort((left, right) => right.from - left.from || right.to - left.to);

  let nextBoundary = text.length;
  let formatted = text;
  for (const edit of ordered) {
    if (edit.to > nextBoundary || edit.from > edit.to) {
      return null;
    }
    formatted = `${formatted.slice(0, edit.from)}${edit.newText}${formatted.slice(edit.to)}`;
    nextBoundary = edit.from;
  }
  return formatted;
}

function normalizedFilePath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

export function applyVSCodeRenameResponse(
  text: string,
  response: VSCodeHostLanguageFeatureResponse,
  currentVersion: number,
  currentFilePath: string,
): VSCodeRenameApplyResult {
  if (!response.ok || response.feature !== "rename" || response.documentVersion !== currentVersion) {
    return { supported: false, reason: "invalid" };
  }
  const workspaceEdit = response.results
    .map(asRecord)
    .find((value): value is Record<string, unknown> => Boolean(value && Array.isArray(value.changes))) as VSCodeWorkspaceEditResult | undefined;
  if (!workspaceEdit || !Array.isArray(workspaceEdit.changes)) {
    return { supported: false, reason: "empty" };
  }
  return applyWorkspaceEditToCurrentDocument(text, workspaceEdit, currentFilePath);
}

function applyWorkspaceEditToCurrentDocument(
  text: string,
  workspaceEdit: VSCodeWorkspaceEditResult,
  currentFilePath: string,
): VSCodeRenameApplyResult {
  if (!Array.isArray(workspaceEdit.changes)) {
    return { supported: false, reason: "empty" };
  }
  const currentPath = normalizedFilePath(currentFilePath);
  const changes = workspaceEdit.changes.flatMap((value) => {
    const change = asRecord(value);
    return change ? [change] : [];
  });
  if (changes.some((change) => typeof change.filePath !== "string" || normalizedFilePath(change.filePath) !== currentPath)) {
    return { supported: false, reason: "cross-file" };
  }
  const doc = EditorState.create({ doc: text }).doc;
  const edits = changes.flatMap((change) => Array.isArray(change.edits) ? change.edits : []).flatMap((value) => {
    const edit = asRecord(value) as VSCodeTextEditResult | null;
    if (!edit || typeof edit.newText !== "string" || !isRange(edit.range)) {
      return [];
    }
    return [{ ...rangeToOffsets(doc, edit.range), newText: edit.newText }];
  });
  if (edits.length === 0) {
    return { supported: false, reason: "empty" };
  }
  const content = applyTextEdits(text, edits);
  return content === null
    ? { supported: false, reason: "invalid" }
    : { supported: true, content };
}

export function resolveVSCodeCodeActionResponse(
  text: string,
  response: VSCodeHostLanguageFeatureResponse,
  currentVersion: number,
  currentFilePath: string,
): VSCodeCodeActionApplyResult {
  if (!response.ok || response.feature !== "codeAction" || response.documentVersion !== currentVersion) {
    return { supported: false, reason: "invalid" };
  }
  const actions = response.results.flatMap((value) => {
    const action = asRecord(value);
    return action && typeof action.title === "string" ? [action] : [];
  });
  const action = actions.find((candidate) => candidate.isPreferred === true && !candidate.disabled)
    ?? actions.find((candidate) => !candidate.disabled);
  if (!action) {
    return { supported: false, reason: actions.length > 0 ? "disabled" : "empty" };
  }

  let content = text;
  if (action.edit) {
    const applied = applyWorkspaceEditToCurrentDocument(
      text,
      action.edit as VSCodeWorkspaceEditResult,
      currentFilePath,
    );
    if (!applied.supported) {
      return applied;
    }
    content = applied.content;
  }
  const command = asRecord(action.command);
  const normalizedCommand = command && typeof command.command === "string"
    ? {
      command: command.command,
      arguments: Array.isArray(command.arguments) ? command.arguments : [],
    }
    : undefined;
  if (content === text && !normalizedCommand) {
    return { supported: false, reason: "empty" };
  }
  return {
    supported: true,
    title: String(action.title),
    content,
    ...(normalizedCommand ? { command: normalizedCommand } : {}),
  };
}

function hoverText(value: unknown): string[] {
  const hover = asRecord(value) as VSCodeHoverResult | null;
  if (!hover) return [];
  const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
  return contents.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

export function buildVSCodeLanguageEditorExtensions(options: VSCodeLanguageBridgeOptions): Extension[] {
  const completionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/[\w$]*/);
    if (!context.explicit && (!word || word.from === word.to)) {
      return null;
    }
    const version = options.getVersion();
    const previousCharacter = context.pos > 0 ? context.state.doc.sliceString(context.pos - 1, context.pos) : "";
    const response = await options.request({
      feature: "completion",
      filePath: options.filePath,
      languageId: options.languageId,
      version,
      position: offsetToVSCodePosition(context.state.doc, context.pos),
      ...(/[^\w$]/.test(previousCharacter) ? { triggerCharacter: previousCharacter } : {}),
    });
    return mapVSCodeCompletionResponse(response, options.getVersion(), word?.from ?? context.pos);
  };

  const hover = hoverTooltip(async (view, pos) => {
    const version = options.getVersion();
    const response = await options.request({
      feature: "hover",
      filePath: options.filePath,
      languageId: options.languageId,
      version,
      position: offsetToVSCodePosition(view.state.doc, pos),
    });
    if (!response.ok || response.feature !== "hover" || response.documentVersion !== options.getVersion()) {
      return null;
    }
    const values = response.results.flatMap(hoverText);
    if (values.length === 0) return null;
    const first = asRecord(response.results[0]) as VSCodeHoverResult | null;
    const offsets = first && isRange(first.range) ? rangeToOffsets(view.state.doc, first.range) : { from: pos, to: pos };
    return {
      pos: offsets.from,
      end: offsets.to,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "max-w-[36rem] whitespace-pre-wrap px-2 py-1 text-xs";
        dom.textContent = values.join("\n\n");
        return { dom };
      },
    };
  });

  const diagnostics = linter(async (view) => {
    const version = options.getVersion();
    const response = await options.request({
      feature: "diagnostics",
      filePath: options.filePath,
      languageId: options.languageId,
      version,
    });
    const mapped = mapVSCodeDiagnosticsResponse(response, options.getVersion(), view.state.doc);
    options.onDiagnostics?.(mapped.map((diagnostic) => ({
      ...diagnostic,
      line: view.state.doc.lineAt(diagnostic.from).number,
    })));
    return mapped;
  }, { delay: 450 });

  return [
    EditorState.languageData.of(() => [{ autocomplete: completionSource }]),
    hover,
    diagnostics,
  ];
}
