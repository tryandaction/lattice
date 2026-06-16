export type CodeOutlineSymbolKind =
  | "heading"
  | "class"
  | "function"
  | "method"
  | "variable"
  | "type"
  | "interface"
  | "enum"
  | "struct";

export interface CodeOutlineSymbol {
  id: string;
  name: string;
  kind: CodeOutlineSymbolKind;
  line: number;
  level: number;
  detail?: string;
}

const MAX_SYMBOLS = 300;

function makeSymbol(
  symbols: CodeOutlineSymbol[],
  name: string,
  kind: CodeOutlineSymbolKind,
  line: number,
  level = 1,
  detail?: string,
) {
  if (!name.trim() || symbols.length >= MAX_SYMBOLS) {
    return;
  }

  symbols.push({
    id: `${kind}:${line}:${symbols.length}:${name}`,
    name: name.trim(),
    kind,
    line,
    level,
    detail,
  });
}

function normalizeLanguage(language: string | null | undefined): string {
  return (language ?? "").trim().toLowerCase();
}

function extractMarkdownOutline(lines: string[]): CodeOutlineSymbol[] {
  const symbols: CodeOutlineSymbol[] = [];
  let inFence = false;

  lines.forEach((line, index) => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      return;
    }

    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) {
      return;
    }

    makeSymbol(symbols, match[2], "heading", index + 1, match[1].length);
  });

  return symbols;
}

function extractPythonOutline(lines: string[]): CodeOutlineSymbol[] {
  const symbols: CodeOutlineSymbol[] = [];

  lines.forEach((line, index) => {
    const classMatch = line.match(/^(\s*)class\s+([A-Za-z_]\w*)\b/);
    if (classMatch) {
      makeSymbol(symbols, classMatch[2], "class", index + 1, Math.floor(classMatch[1].length / 4) + 1);
      return;
    }

    const functionMatch = line.match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
    if (functionMatch) {
      const level = Math.floor(functionMatch[1].length / 4) + 1;
      makeSymbol(symbols, functionMatch[2], level > 1 ? "method" : "function", index + 1, level);
    }
  });

  return symbols;
}

function extractJavaScriptOutline(lines: string[]): CodeOutlineSymbol[] {
  const symbols: CodeOutlineSymbol[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) {
      return;
    }

    const declarationMatch = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)\b/);
    if (declarationMatch) {
      makeSymbol(
        symbols,
        declarationMatch[2],
        declarationMatch[1] as CodeOutlineSymbolKind,
        index + 1,
      );
      return;
    }

    const variableFunctionMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
    if (variableFunctionMatch) {
      makeSymbol(symbols, variableFunctionMatch[1], "function", index + 1);
      return;
    }

    const variableMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/);
    if (variableMatch) {
      makeSymbol(symbols, variableMatch[1], "variable", index + 1);
    }
  });

  return symbols;
}

function extractCStyleOutline(lines: string[]): CodeOutlineSymbol[] {
  const symbols: CodeOutlineSymbol[] = [];
  const controlKeywords = new Set(["if", "for", "while", "switch", "catch"]);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#")) {
      return;
    }

    const typeMatch = trimmed.match(/^(?:typedef\s+)?(struct|class|enum)\s+([A-Za-z_]\w*)\b/);
    if (typeMatch) {
      const keyword = typeMatch[1] as "struct" | "class" | "enum";
      makeSymbol(symbols, typeMatch[2], keyword, index + 1);
      return;
    }

    const functionMatch = trimmed.match(/^(?:template\s*<[^>]+>\s*)?(?:[\w:*&<>,~]+\s+)+((?:[A-Za-z_]\w*::)*[A-Za-z_~]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:->\s*[\w:*&<>,\s]+)?[{]?$/);
    if (!functionMatch || controlKeywords.has(functionMatch[1])) {
      return;
    }

    const name = functionMatch[1].split("::").pop() ?? functionMatch[1];
    makeSymbol(symbols, name, "function", index + 1, 1, functionMatch[1]);
  });

  return symbols;
}

export function extractCodeOutlineSymbols(content: string, language: string): CodeOutlineSymbol[] {
  const normalized = normalizeLanguage(language);
  const lines = content.split(/\r?\n/);

  if (normalized === "markdown") {
    return extractMarkdownOutline(lines);
  }

  if (normalized === "python") {
    return extractPythonOutline(lines);
  }

  if (normalized === "javascript" || normalized === "typescript") {
    return extractJavaScriptOutline(lines);
  }

  if (normalized === "c" || normalized === "cpp") {
    return extractCStyleOutline(lines);
  }

  return [];
}
