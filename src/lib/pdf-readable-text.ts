const PDF_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g;

function normalizeWhitespace(text: string): string {
  return text.replace(PDF_CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

function formatExponent(exponent: string): string {
  return exponent.includes("/") ? `^(${exponent})` : `^${exponent}`;
}

export function normalizePdfReadableText(text: string | null | undefined): string {
  let normalized = normalizeWhitespace(text ?? "").replace(/\u2212/g, "-");

  normalized = normalized
    .replace(/([\p{L}])-\s+([\p{Ll}])/gu, "$1$2")
    .replace(/([,.;:!?])(?=[\p{L}\p{N}])/gu, "$1 ")
    .replace(/(\d)\.\s+(\d)/g, "$1.$2")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+([,.;:!?%])/g, "$1")
    .replace(/([\p{L}\p{N}])\s*\/\s*([\p{L}\p{N}])/gu, "$1/$2")
    .replace(/(\d)([A-Za-z]{3,})/g, "$1 $2");

  normalized = normalized.replace(
    /\b(\d+(?:\.\d+)?)\s*-\s*(\d+)\b(?=\s*(?:\(|\d+\/|[A-Za-z]))/g,
    "$1^-$2",
  );

  normalized = normalized
    .replace(/(\([^()]{1,48}\/[^()]{1,48}\))\s*(\d+\/\d+)/g, (_, base: string, exponent: string) => (
      `${base}${formatExponent(exponent)}`
    ))
    .replace(/(\([^()]{1,48}\/[^()]{1,48}\))\s*(\d+)(?=\s|$|[A-Za-z])/g, "$1^$2");

  normalized = normalized.replace(
    /\b(\d+(?:\.\d+)?(?:\^-\d+)?)\s+(\d+\/[A-Za-z])\s+(\d+(?:\/\d+)?)(?=\s+(?:V\/cm|V|Hz|MHz|GHz|cm|m|s|K)\b)/g,
    (_, coefficient: string, ratio: string, exponent: string) => (
      `${coefficient}(${ratio})${formatExponent(exponent)}`
    ),
  );

  return normalizeWhitespace(normalized);
}
