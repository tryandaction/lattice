import type { AiContentPart } from "./types";

export async function* parseSseJson(response: Response, options?: { onDone?: () => void; strict?: boolean }): AsyncIterable<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming response body is unavailable");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || /^(?::|event:|id:|retry:)/.test(trimmed)) continue;
        const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
        if (!payload) continue;
        if (payload === "[DONE]") { options?.onDone?.(); return; }
        try {
          const parsed = JSON.parse(payload) as unknown;
          if (parsed && typeof parsed === "object") yield parsed as Record<string, unknown>;
        } catch {
          if (options?.strict) throw new Error('The provider stream contained invalid or incomplete JSON. Retry the unfinished answer.');
        }
      }
    }

    const trailing = (buffer + decoder.decode()).trim();
    if (trailing && !/^(?::|event:|id:|retry:)/.test(trailing)) {
      const payload = trailing.startsWith("data:") ? trailing.slice(5).trim() : trailing;
      if (payload === '[DONE]') { options?.onDone?.(); return; }
      if (payload && payload !== "[DONE]") {
        try {
          const parsed = JSON.parse(payload) as unknown;
          if (parsed && typeof parsed === "object") yield parsed as Record<string, unknown>;
        } catch {
          if (options?.strict) throw new Error('The provider stream contained invalid or incomplete JSON. Retry the unfinished answer.');
        }
      }
    }
  } finally {
    // Cancellation stops native SSE work on DONE or consumer return. Do not wait for
    // the transport close handshake or let a cleanup error replace the read error.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Extracts final answer text without ever promoting provider reasoning fields. */
export function extractProviderText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const candidate = part as Partial<AiContentPart>;
        return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
      })
      .join("");
  }
  if (value && typeof value === "object" && "content" in value) {
    return extractProviderText((value as { content?: unknown }).content);
  }
  return "";
}

export function extractStreamTextDelta(value: unknown): string {
  if (value && typeof value === "object" && "delta" in value) {
    return extractStreamTextDelta((value as { delta?: unknown }).delta);
  }
  return extractProviderText(value);
}
