import type { EditorView } from "@codemirror/view";
import type { KeyboardEvent } from "react";
import { useState } from "react";

export type MarkdownPropertyValueType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "list";

export interface MarkdownPropertyRow {
  id: string;
  key: string;
  value: string;
  editable: boolean;
  raw: string;
  valueType: MarkdownPropertyValueType;
  astKind: "scalar" | "raw" | "blank" | "continuation" | "complex";
  preserveReason?: string;
}

interface PropertiesEditorProps {
  source: string;
  from: number;
  to: number;
  view: EditorView;
}

const PROPERTY_KEY_PATTERN = /^[A-Za-z_][\w.-]*$/;
const DATE_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
type PropertyKeyIssue = "invalid" | "duplicate";

const WORKSPACE_METADATA_KEY_TYPES: Record<string, MarkdownPropertyValueType> = {
  aliases: "list",
  area: "text",
  archived: "boolean",
  categories: "list",
  completed: "boolean",
  created: "date",
  deadline: "date",
  due: "date",
  favorite: "boolean",
  labels: "list",
  priority: "number",
  rating: "number",
  status: "text",
  tags: "list",
  topics: "list",
  updated: "date",
};

function normalizePropertyKey(value: string): string {
  return value.trim().replace(/\s+/g, "-");
}

function quotePropertyValue(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '""';
  if (/^(true|false|null|[-+]?\d+(?:\.\d+)?)$/i.test(normalized))
    return normalized;
  if (/^\[.*\]$/.test(normalized)) return normalized;
  if (/^".*"$/.test(normalized) || /^'.*'$/.test(normalized)) return normalized;
  return JSON.stringify(normalized);
}

function inferPropertyValueType(value: string): MarkdownPropertyValueType {
  const trimmed = value.trim();
  if (/^(true|false)$/i.test(trimmed)) return "boolean";
  if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) return "number";
  if (DATE_VALUE_PATTERN.test(trimmed)) return "date";
  if (/^\[.*\]$/.test(trimmed)) return "list";
  return "text";
}

export function suggestPropertyValueType(
  key: string,
): MarkdownPropertyValueType | null {
  const normalized = normalizePropertyKey(key).toLowerCase();
  if (!normalized) return null;
  if (WORKSPACE_METADATA_KEY_TYPES[normalized]) {
    return WORKSPACE_METADATA_KEY_TYPES[normalized];
  }
  if (/^(tags?|aliases?|categories?|topics?|labels?)$/.test(normalized))
    return "list";
  if (
    /^(due|deadline|date|start-date|end-date|created|updated|published-at)$/.test(
      normalized,
    )
  )
    return "date";
  if (
    /^(published|draft|done|archived|pinned|favorite|starred|completed)$/.test(
      normalized,
    )
  )
    return "boolean";
  if (/^(priority|order|rank|count|index|weight|rating)$/.test(normalized))
    return "number";
  if (normalized.endsWith("-date") || normalized.endsWith("_date"))
    return "date";
  if (normalized.endsWith("-count") || normalized.endsWith("_count"))
    return "number";
  return null;
}

export function getWorkspaceMetadataKeySuggestions(
  rows: MarkdownPropertyRow[],
): Array<{ key: string; valueType: MarkdownPropertyValueType }> {
  const suggestions = new Map<string, MarkdownPropertyValueType>();

  Object.entries(WORKSPACE_METADATA_KEY_TYPES).forEach(([key, valueType]) => {
    suggestions.set(key, valueType);
  });

  rows.forEach((row) => {
    if (!row.editable || !row.key.trim()) return;
    suggestions.set(normalizePropertyKey(row.key), row.valueType);
  });

  return [...suggestions.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, valueType]) => ({ key, valueType }));
}

export function getTodayDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getRelativeDateString(daysFromToday: number, date = new Date()): string {
  const next = new Date(date);
  next.setDate(next.getDate() + daysFromToday);
  return getTodayDateString(next);
}

function hasUnquotedYamlComment(value: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inDoubleQuote) {
      escaped = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (
      char === "#" &&
      !inSingleQuote &&
      !inDoubleQuote &&
      (index === 0 || /\s/.test(value[index - 1] ?? ""))
    ) {
      return true;
    }
  }

  return false;
}

function shouldPreserveYamlValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (hasUnquotedYamlComment(value)) return true;
  if (/^\{.*\}$/.test(trimmed)) return true;
  if (/^\[.*\{.*\}.*\]$/.test(trimmed)) return true;
  if (/^![^\s]+(?:\s|$)/.test(trimmed)) return true;
  if (/(^|\s)[&*][A-Za-z0-9_-]+/.test(trimmed)) return true;
  return false;
}

function getYamlPreserveReason(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (hasUnquotedYamlComment(value)) return "comment";
  if (/^\{.*\}$/.test(trimmed)) return "inline object";
  if (/^\[.*\{.*\}.*\]$/.test(trimmed)) return "nested collection";
  if (/^![^\s]+(?:\s|$)/.test(trimmed)) return "custom tag";
  if (/(^|\s)[&*][A-Za-z0-9_-]+/.test(trimmed)) return "anchor or alias";
  return undefined;
}

function unquotePropertyValue(value: string): string {
  const trimmed = value.trim();
  if (/^\[.*\]$/.test(trimmed)) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => unquotePropertyValue(item.trim()))
      .filter(Boolean)
      .join(", ");
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function serializePropertyValue(
  value: string,
  valueType: MarkdownPropertyValueType,
): string {
  const normalized = value.trim();
  if (valueType === "boolean")
    return normalized.toLowerCase() === "true" ? "true" : "false";
  if (valueType === "number")
    return normalized && /^[-+]?\d+(?:\.\d+)?$/.test(normalized)
      ? normalized
      : "0";
  if (valueType === "date")
    return DATE_VALUE_PATTERN.test(normalized)
      ? normalized
      : quotePropertyValue(normalized);
  if (valueType === "list") {
    const values = normalized
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => quotePropertyValue(item));
    return `[${values.join(", ")}]`;
  }
  return quotePropertyValue(normalized);
}

function getListItems(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeListItems(items: string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

function appendListItem(value: string, item: string): string {
  return serializeListItems([...getListItems(value), item]);
}

function removeListItem(value: string, itemIndex: number): string {
  return serializeListItems(
    getListItems(value).filter((_, index) => index !== itemIndex),
  );
}

function collectPropertyKeyIssues(
  rows: MarkdownPropertyRow[],
): Map<string, PropertyKeyIssue> {
  const issues = new Map<string, PropertyKeyIssue>();
  const normalizedKeys = rows
    .filter((row) => row.editable)
    .map((row) => ({ id: row.id, key: normalizePropertyKey(row.key) }));
  const keyCounts = new Map<string, number>();

  for (const row of normalizedKeys) {
    keyCounts.set(row.key, (keyCounts.get(row.key) ?? 0) + 1);
  }

  for (const row of normalizedKeys) {
    if (!PROPERTY_KEY_PATTERN.test(row.key)) {
      issues.set(row.id, "invalid");
    } else if ((keyCounts.get(row.key) ?? 0) > 1) {
      issues.set(row.id, "duplicate");
    }
  }

  return issues;
}

function getPropertyKeyIssueMessage(issue: PropertyKeyIssue): string {
  return issue === "duplicate"
    ? "Duplicate property key"
    : "Use letters, numbers, _, ., or -, and start with a letter or _.";
}

export function parsePropertiesSource(source: string): MarkdownPropertyRow[] {
  const lines = source.split(/\r?\n/);
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  const body =
    lines[0]?.trim() === "---" && closingIndex > 0
      ? lines.slice(1, closingIndex)
      : lines;

  return body.map((line, index): MarkdownPropertyRow => {
    if (!line.trim()) {
      return {
        id: `blank-${index}`,
        key: "",
        value: "",
        editable: false,
        raw: line,
        valueType: "text",
        astKind: "blank",
        preserveReason: "blank line",
      };
    }

    const match = line.match(/^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/);
    const value = (match?.[2] ?? "").trim();
    const nextBodyLine = body
      .slice(index + 1)
      .find((candidate) => candidate.trim().length > 0);
    const hasIndentedContinuation = Boolean(
      match &&
      nextBodyLine?.match(/^\s+/) &&
      (value.length === 0 || /^[|>][+-]?$/.test(value)),
    );

    const preserveReason = match ? getYamlPreserveReason(value) : "non-scalar YAML";
    if (!match || hasIndentedContinuation || preserveReason || shouldPreserveYamlValue(value)) {
      return {
        id: `raw-${index}`,
        key: "",
        value: "",
        editable: false,
        raw: line,
        valueType: "text",
        astKind: hasIndentedContinuation ? "complex" : line.match(/^\s+/) ? "continuation" : "raw",
        preserveReason: hasIndentedContinuation
          ? "block scalar or nested YAML"
          : preserveReason,
      };
    }

    const rawValue = match[2] ?? "";
    return {
      id: `${match[1]}-${index}`,
      key: match[1],
      value: unquotePropertyValue(rawValue),
      editable: true,
      raw: line,
      valueType: rawValue.trim()
        ? inferPropertyValueType(rawValue)
        : (suggestPropertyValueType(match[1]) ?? "text"),
      astKind: "scalar",
    };
  });
}

export function serializePropertiesRows(rows: MarkdownPropertyRow[]): string {
  const keyIssues = collectPropertyKeyIssues(rows);
  const body = rows.map((row) => {
    if (!row.editable) return row.raw;
    const key = normalizePropertyKey(row.key);
    if (keyIssues.has(row.id)) return row.raw;
    return `${key}: ${serializePropertyValue(row.value, row.valueType)}`;
  });

  return ["---", ...body, "---"].join("\n");
}

function replaceProperties(
  view: EditorView,
  from: number,
  to: number,
  rows: MarkdownPropertyRow[],
): void {
  const insert = serializePropertiesRows(rows);
  view.dispatch({
    changes: { from, to, insert },
  });
}

export function PropertiesEditor({
  source,
  from,
  to,
  view,
}: PropertiesEditorProps) {
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const rows = parsePropertiesSource(source);
  const displayRows = rows.map((row) =>
    row.editable && keyDrafts[row.id] !== undefined
      ? { ...row, key: keyDrafts[row.id] }
      : row,
  );
  const keyIssues = collectPropertyKeyIssues(displayRows);
  const editableRows = displayRows.filter((row) => row.editable);
  const rawRows = rows.filter((row) => !row.editable);
  const metadataSuggestions = getWorkspaceMetadataKeySuggestions(rows);
  const metadataListId = "cm-properties-metadata-keys";
  const preservedComplexRows = rawRows.filter((row) => row.astKind === "complex").length;

  const updateRow = (
    rowId: string,
    patch: Partial<Pick<MarkdownPropertyRow, "key" | "value" | "valueType">>,
  ) => {
    replaceProperties(
      view,
      from,
      to,
      rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  };

  const updateKey = (rowId: string, nextKey: string) => {
    const candidateRows = displayRows.map((row) =>
      row.id === rowId ? { ...row, key: nextKey } : row,
    );
    const candidateIssues = collectPropertyKeyIssues(candidateRows);

    if (candidateIssues.has(rowId)) {
      setKeyDrafts((drafts) => ({ ...drafts, [rowId]: nextKey }));
      return;
    }

    setKeyDrafts((drafts) => {
      const { [rowId]: _removed, ...rest } = drafts;
      return rest;
    });
    const currentRow = rows.find((row) => row.id === rowId);
    const suggestedType = currentRow?.value
      ? null
      : suggestPropertyValueType(nextKey);
    updateRow(rowId, {
      key: nextKey,
      ...(suggestedType ? { valueType: suggestedType } : {}),
    });
  };

  const deleteRow = (rowId: string) => {
    replaceProperties(
      view,
      from,
      to,
      rows.filter((row) => row.id !== rowId),
    );
  };

  const addRow = () => {
    const existing = new Set(
      rows.filter((row) => row.editable).map((row) => row.key),
    );
    let index = 1;
    let key = "property";
    while (existing.has(key)) {
      index += 1;
      key = `property-${index}`;
    }

    replaceProperties(view, from, to, [
      ...rows,
      {
        id: `${key}-${rows.length}`,
        key,
        value: "",
        editable: true,
        raw: `${key}: ""`,
        valueType: suggestPropertyValueType(key) ?? "text",
        astKind: "scalar",
      },
    ]);
  };

  const focusRelativeRow = (
    rowIndex: number,
    direction: -1 | 1,
    preferredClassName:
      | "cm-properties-key"
      | "cm-properties-type"
      | "cm-properties-value",
    ownerDocument: Document,
  ) => {
    const targetIndex = rowIndex + direction;
    if (targetIndex < 0 || targetIndex >= editableRows.length) return;
    const rowSelector = `[data-property-row-index="${targetIndex}"]`;
    const target =
      ownerDocument.querySelector<HTMLElement>(
        `${rowSelector} .${preferredClassName}`,
      ) ??
      ownerDocument.querySelector<HTMLElement>(
        `${rowSelector} .cm-properties-value`,
      ) ??
      ownerDocument.querySelector<HTMLElement>(
        `${rowSelector} .cm-properties-key`,
      );
    target?.focus();
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    rowIndex: number,
  ) => {
    const target = event.currentTarget;
    const preferredClassName = target.classList.contains("cm-properties-key")
      ? "cm-properties-key"
      : target.classList.contains("cm-properties-type")
        ? "cm-properties-type"
        : "cm-properties-value";
    if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      focusRelativeRow(rowIndex, 1, preferredClassName, target.ownerDocument);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRelativeRow(rowIndex, -1, preferredClassName, target.ownerDocument);
    }
  };

  const commitListInput = (
    input: HTMLInputElement,
    row: MarkdownPropertyRow,
  ) => {
    const item = input.value.trim();
    if (!item) return;
    input.value = "";
    updateRow(row.id, { value: appendListItem(row.value, item) });
  };

  const handleListInputKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    row: MarkdownPropertyRow,
    rowIndex: number,
  ) => {
    if (event.key === "Enter" || event.key === ",") {
      const hasItem = event.currentTarget.value.trim().length > 0;
      if (hasItem || event.key === ",") {
        event.preventDefault();
        commitListInput(event.currentTarget, row);
        return;
      }
    }

    if (event.key === "Backspace" && event.currentTarget.value.length === 0) {
      const items = getListItems(row.value);
      if (items.length > 0) {
        event.preventDefault();
        updateRow(row.id, { value: serializeListItems(items.slice(0, -1)) });
        return;
      }
    }

    handleRowKeyDown(event, rowIndex);
  };

  return (
    <section className="cm-properties-panel" aria-label="Markdown properties">
      <div className="cm-properties-header">
        <div>
          <span className="cm-properties-title">Properties</span>
          <div className="cm-properties-subtitle">
            {editableRows.length} scalar / {rawRows.length} preserved AST row
            {rawRows.length === 1 ? "" : "s"}
            {preservedComplexRows > 0 ? ` / ${preservedComplexRows} complex` : ""}
          </div>
        </div>
        <div className="cm-properties-header-actions">
          <button type="button" className="cm-properties-add" onClick={addRow}>
            Add
          </button>
        </div>
      </div>
      <datalist id={metadataListId}>
        {metadataSuggestions.map((suggestion) => (
          <option
            key={suggestion.key}
            value={suggestion.key}
            label={suggestion.valueType}
          />
        ))}
      </datalist>

      <div className="cm-properties-rows">
        {editableRows.length === 0 ? (
          <div className="cm-properties-empty">No editable properties</div>
        ) : null}

        {editableRows.map((row, rowIndex) => {
          const keyIssue = keyIssues.get(row.id);
          const keyIssueId = `cm-property-key-issue-${row.id}`;
          const valueType = row.valueType;
          const isBooleanValue = valueType === "boolean";
          const isListValue = valueType === "list";
          const listItems = isListValue ? getListItems(row.value) : [];

          return (
            <div
              className="cm-properties-row"
              key={row.id}
              data-property-row-index={rowIndex}
            >
              <div className="cm-properties-key-cell">
                <input
                  className="cm-properties-key"
                  aria-label="Property key"
                  aria-invalid={keyIssue ? true : undefined}
                  aria-describedby={keyIssue ? keyIssueId : undefined}
                  list={metadataListId}
                  value={row.key}
                  onChange={(event) =>
                    updateKey(row.id, event.currentTarget.value)
                  }
                  onKeyDown={(event) => handleRowKeyDown(event, rowIndex)}
                  onMouseDown={(event) => event.stopPropagation()}
                />
                {keyIssue ? (
                  <div
                    className="cm-properties-key-error"
                    id={keyIssueId}
                    role="status"
                  >
                    {getPropertyKeyIssueMessage(keyIssue)}
                  </div>
                ) : null}
              </div>
              <select
                className="cm-properties-type"
                aria-label={`Property type for ${row.key}`}
                value={valueType}
                onChange={(event) =>
                  updateRow(row.id, {
                    valueType: event.currentTarget
                      .value as MarkdownPropertyValueType,
                  })
                }
                onKeyDown={(event) => handleRowKeyDown(event, rowIndex)}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="date">Date</option>
                <option value="list">List</option>
              </select>
              {isBooleanValue ? (
                <label className="cm-properties-boolean">
                  <input
                    className="cm-properties-value"
                    aria-label={`Property value for ${row.key}`}
                    type="checkbox"
                    checked={row.value.toLowerCase() === "true"}
                    onChange={(event) =>
                      updateRow(row.id, {
                        value: event.currentTarget.checked ? "true" : "false",
                      })
                    }
                    onKeyDown={(event) => handleRowKeyDown(event, rowIndex)}
                    onMouseDown={(event) => event.stopPropagation()}
                  />
                  <span>
                    {row.value.toLowerCase() === "true" ? "True" : "False"}
                  </span>
                </label>
              ) : isListValue ? (
                <div
                  className="cm-properties-list"
                  role="group"
                  aria-label={`List values for ${row.key}`}
                >
                  {listItems.map((item, itemIndex) => (
                    <span
                      className="cm-properties-chip"
                      key={`${item}-${itemIndex}`}
                    >
                      <span>{item}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${item} from ${row.key}`}
                        onClick={() =>
                          updateRow(row.id, {
                            value: removeListItem(row.value, itemIndex),
                          })
                        }
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                  <input
                    className="cm-properties-value cm-properties-list-input"
                    aria-label={`Add list item for ${row.key}`}
                    type="text"
                    placeholder="Add item"
                    onBlur={(event) =>
                      commitListInput(event.currentTarget, row)
                    }
                    onKeyDown={(event) =>
                      handleListInputKeyDown(event, row, rowIndex)
                    }
                    onMouseDown={(event) => event.stopPropagation()}
                  />
                </div>
              ) : valueType === "date" ? (
                <div className="cm-properties-date">
                  <input
                    className="cm-properties-value"
                    aria-label={`Property value for ${row.key}`}
                    type="date"
                    value={row.value}
                    onChange={(event) =>
                      updateRow(row.id, { value: event.currentTarget.value })
                    }
                    onKeyDown={(event) => handleRowKeyDown(event, rowIndex)}
                    onMouseDown={(event) => event.stopPropagation()}
                  />
                  <button
                    type="button"
                    className="cm-properties-inline-action"
                    aria-label={`Set ${row.key} to today`}
                    onClick={() =>
                      updateRow(row.id, { value: getTodayDateString() })
                    }
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className="cm-properties-inline-action"
                    aria-label={`Set ${row.key} to tomorrow`}
                    onClick={() =>
                      updateRow(row.id, { value: getRelativeDateString(1) })
                    }
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    Tomorrow
                  </button>
                  <button
                    type="button"
                    className="cm-properties-inline-action"
                    aria-label={`Set ${row.key} to next week`}
                    onClick={() =>
                      updateRow(row.id, { value: getRelativeDateString(7) })
                    }
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    Next week
                  </button>
                  <button
                    type="button"
                    className="cm-properties-inline-action"
                    aria-label={`Clear ${row.key}`}
                    onClick={() => updateRow(row.id, { value: "" })}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <input
                  className="cm-properties-value"
                  aria-label={`Property value for ${row.key}`}
                  type={valueType === "number" ? "number" : "text"}
                  value={row.value}
                  onChange={(event) =>
                    updateRow(row.id, { value: event.currentTarget.value })
                  }
                  onKeyDown={(event) => handleRowKeyDown(event, rowIndex)}
                  onMouseDown={(event) => event.stopPropagation()}
                />
              )}
              <button
                type="button"
                className="cm-properties-delete"
                aria-label={`Delete property ${row.key}`}
                onClick={() => deleteRow(row.id)}
              >
                Delete
              </button>
            </div>
          );
        })}
      </div>

      {rawRows.length > 0 ? (
        <details className="cm-properties-raw">
          <summary>Preserved YAML</summary>
          <pre>
            {rawRows
              .map((row) => {
                const reason = row.preserveReason
                  ? ` (${row.preserveReason})`
                  : "";
                return `[${row.astKind}]${reason} ${row.raw}`;
              })
              .join("\n")}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
