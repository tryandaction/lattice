export type ControlFormulaChord =
  | { kind: "formula"; latex: string }
  | { kind: "matrix"; rows: number; columns: number };

const INTEGRAL_CHORDS: Record<string, string> = {
  "0": "\\oint",
  "1": "\\int",
  "2": "\\iint",
  "3": "\\iiint",
  "20": "\\oiint",
  "30": "\\oiiint",
};

export function resolveControlFormulaChord(keyCode: string, digits: string): ControlFormulaChord | null {
  if (keyCode === "KeyI") {
    const latex = INTEGRAL_CHORDS[digits];
    return latex ? { kind: "formula", latex } : null;
  }

  if (keyCode === "KeyM" && /^[1-9](?:[1-9])?$/.test(digits)) {
    const dimensions = digits.length === 1
      ? [Number(digits), Number(digits)]
      : [Number(digits[0]), Number(digits[1])];
    return { kind: "matrix", rows: dimensions[0], columns: dimensions[1] };
  }

  return null;
}
