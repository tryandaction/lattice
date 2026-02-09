import type { ReactNode } from "react";

export function highlightMatch(text: string | null | undefined, query: string): ReactNode {
  const safeText = text ?? "";
  const trimmed = query.trim();
  if (!trimmed) return safeText;

  const lowerText = safeText.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  if (!lowerText.includes(lowerQuery)) return safeText;

  const parts: ReactNode[] = [];
  let start = 0;
  while (true) {
    const index = lowerText.indexOf(lowerQuery, start);
    if (index === -1) break;
    if (index > start) {
      parts.push(safeText.slice(start, index));
    }
    const match = safeText.slice(index, index + trimmed.length);
    parts.push(
      <span key={`${index}-${start}`} className="rounded-sm bg-primary/15 text-foreground px-0.5">
        {match}
      </span>
    );
    start = index + trimmed.length;
  }
  if (start < safeText.length) {
    parts.push(safeText.slice(start));
  }
  return <>{parts}</>;
}
