import type { MathfieldElement } from "mathlive";
type MathOperation = (field: MathfieldElement) => void;
const pending = new WeakMap<HTMLElement, MathOperation[]>();
export function beginQuantumMathInput(editor: HTMLElement): void { if (!pending.has(editor)) pending.set(editor, []); }
export function queueQuantumMathInput(editor: HTMLElement, operation: MathOperation): boolean {
  const operations = pending.get(editor); if (!operations) return false;
  operations.push(operation); return true;
}
export function flushQuantumMathInput(editor: HTMLElement, field: MathfieldElement): void {
  const operations = pending.get(editor) ?? []; pending.delete(editor);
  for (const operation of operations) operation(field);
}
export function cancelQuantumMathInput(editor: HTMLElement): void { pending.delete(editor); }
