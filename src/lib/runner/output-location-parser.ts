export interface ParsedOutputLocation {
  filePath?: string;
  line: number;
  column?: number;
  severity: "info" | "warning" | "error";
  message: string;
  rawLine: string;
  source: "gcc" | "msvc" | "node" | "typescript";
}

function toPositiveNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function cleanPath(value: string): string {
  const trimmed = value.trim().replace(/^file:\/\/\/?/, "");
  return decodeURIComponent(trimmed);
}

function severityFromText(value: string): ParsedOutputLocation["severity"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("warning")) {
    return "warning";
  }
  if (normalized.includes("note")) {
    return "info";
  }
  return "error";
}

export function parseOutputLocationLine(line: string): ParsedOutputLocation | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const typescriptMatch = trimmed.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.*)$/i);
  if (typescriptMatch) {
    const lineNumber = toPositiveNumber(typescriptMatch[2]);
    if (!lineNumber) {
      return null;
    }
    return {
      filePath: cleanPath(typescriptMatch[1]),
      line: lineNumber,
      column: toPositiveNumber(typescriptMatch[3]),
      severity: severityFromText(typescriptMatch[4]),
      message: `${typescriptMatch[5]}: ${typescriptMatch[6]}`.trim(),
      rawLine: line,
      source: "typescript",
    };
  }

  const msvcMatch = trimmed.match(/^(.+?)\((\d+)(?:,(\d+))?\)\s*:\s*((?:fatal\s+)?error|warning)\s+([A-Z]+\d+)?:?\s*(.*)$/i);
  if (msvcMatch) {
    const lineNumber = toPositiveNumber(msvcMatch[2]);
    if (!lineNumber) {
      return null;
    }
    return {
      filePath: cleanPath(msvcMatch[1]),
      line: lineNumber,
      column: toPositiveNumber(msvcMatch[3]),
      severity: severityFromText(msvcMatch[4]),
      message: [msvcMatch[5], msvcMatch[6]].filter(Boolean).join(": ").trim() || trimmed,
      rawLine: line,
      source: "msvc",
    };
  }

  const gccMatch = trimmed.match(/^(.+?):(\d+)(?::(\d+))?:\s*((?:fatal\s+)?error|warning|note)\s*:?\s*(.*)$/i);
  if (gccMatch) {
    const lineNumber = toPositiveNumber(gccMatch[2]);
    if (!lineNumber) {
      return null;
    }
    return {
      filePath: cleanPath(gccMatch[1]),
      line: lineNumber,
      column: toPositiveNumber(gccMatch[3]),
      severity: severityFromText(gccMatch[4]),
      message: gccMatch[5]?.trim() || trimmed,
      rawLine: line,
      source: "gcc",
    };
  }

  const nodeMatch = trimmed.match(/\bat\s+(?:.+?\s+\()?((?:file:\/\/\/?)?(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/]).+?):(\d+):(\d+)\)?$/);
  if (nodeMatch) {
    const lineNumber = toPositiveNumber(nodeMatch[2]);
    if (!lineNumber) {
      return null;
    }
    return {
      filePath: cleanPath(nodeMatch[1]),
      line: lineNumber,
      column: toPositiveNumber(nodeMatch[3]),
      severity: "error",
      message: trimmed,
      rawLine: line,
      source: "node",
    };
  }

  return null;
}

export function parseOutputLocations(text: string): ParsedOutputLocation[] {
  return text
    .split(/\r?\n/)
    .map(parseOutputLocationLine)
    .filter((location): location is ParsedOutputLocation => location !== null);
}
