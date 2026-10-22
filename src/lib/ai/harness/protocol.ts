import type { HarnessConversationSession, HarnessEvent } from "./types";

export const HARNESS_PROMPT_BYTE_LIMIT = 1024 * 1024;
const kinds = new Set<HarnessEvent["kind"]>(["connected", "session", "started", "delta", "message", "commentary", "tool-start", "tool-complete", "tool-call", "file-change", "approval", "approval-resolved", "completed", "interrupted", "error", "disconnected", "notice"]);
const terminal = new Set(["completed", "interrupted", "error", "disconnected"]);

export function validateHarnessPrompt(text: string): string {
  if (!text.trim()) throw new Error("请输入消息。");
  if (new TextEncoder().encode(text).byteLength > HARNESS_PROMPT_BYTE_LIMIT) {
    throw new Error("本地 Harness 单次正文上限为 1 MiB，请按章节分批发送；原草稿仍完整保留。");
  }
  return text;
}

/** No raw provider trace, account metadata, token usage or hidden reasoning enters the timeline. */
export function normalizeHarnessEvent(value: unknown): HarnessEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as HarnessEvent;
  if (!kinds.has(event.kind) || typeof event.connectionId !== "string" || typeof event.conversationId !== "string" ||
      !Number.isSafeInteger(event.sequence) || event.sequence < 1 || !Number.isFinite(event.timestamp)) return null;
  return {
    connectionId: event.connectionId, conversationId: event.conversationId,
    sessionId: typeof event.sessionId === "string" ? event.sessionId : null,
    turnId: typeof event.turnId === "string" ? event.turnId : null,
    sequence: event.sequence, timestamp: event.timestamp, kind: event.kind,
    ...(typeof event.text === "string" ? { text: event.text } : {}),
    ...(event.phase === "commentary" || event.phase === "final_answer" ? { phase: event.phase } : {}),
    ...(typeof event.itemId === "string" ? { itemId: event.itemId } : {}),
    ...(typeof event.method === "string" ? { method: event.method } : {}),
    ...(event.approval && typeof event.approval.requestId === "string" ? { approval: event.approval } : {}),
    ...(event.toolCall && typeof event.toolCall.requestId === "string" && typeof event.toolCall.callId === "string" && typeof event.toolCall.tool === "string" ? { toolCall: event.toolCall } : {}),
    ...(event.kind === "tool-complete" && event.toolResult && typeof event.toolResult.requestId === "string" && event.toolResult.requestId.length <= 256 &&
      typeof event.toolResult.callId === "string" && event.toolResult.callId.length <= 256 && typeof event.toolResult.success === "boolean" &&
      Number.isSafeInteger(event.toolResult.resultBytes) && event.toolResult.resultBytes >= 0 && event.toolResult.resultBytes <= HARNESS_PROMPT_BYTE_LIMIT &&
      typeof event.toolResult.summary === "string" && event.toolResult.summary.length <= 512 && typeof event.toolResult.truncated === "boolean"
      ? { toolResult: { requestId: event.toolResult.requestId, callId: event.toolResult.callId, success: event.toolResult.success, resultBytes: event.toolResult.resultBytes, summary: event.toolResult.summary, truncated: event.toolResult.truncated } } : {}),
    ...(Array.isArray(event.scratchPaths) ? { scratchPaths: event.scratchPaths.filter((path): path is string => typeof path === 'string' && path.length < 4096).slice(0, 64) } : {}),
    ...(typeof event.exitCode === "number" || event.exitCode === null ? { exitCode: event.exitCode } : {}),
  };
}

export function reduceHarnessSession(session: HarnessConversationSession, event: HarnessEvent): HarnessConversationSession {
  if (session.connectionId !== event.connectionId || session.conversationId !== event.conversationId ||
      (session.sessionId && event.sessionId && session.sessionId !== event.sessionId) ||
      (session.turnId && event.turnId && session.turnId !== event.turnId) || event.sequence <= session.sequence) return session;
  if (terminal.has(session.status) && !["disconnected", "notice"].includes(event.kind)) return session;
  const next = { ...session, sequence: event.sequence, events: [...session.events, event].slice(-400) };
  if (event.kind === "delta" && event.phase !== "commentary") next.text += event.text ?? "";
  if (event.kind === "message" && event.phase !== "commentary") next.text = event.text ?? next.text;
  if (event.kind === "started") { next.status = "running"; next.turnId = event.turnId ?? next.turnId; }
  if (event.kind === "session") { next.status = "ready"; next.sessionId = event.sessionId ?? next.sessionId; }
  if (event.kind === "approval" && event.approval) {
    next.status = "waiting-approval";
    next.approvals = [...next.approvals.filter((item) => item.requestId !== event.approval!.requestId), event.approval];
  }
  if (event.kind === "approval-resolved") {
    next.approvals = next.approvals.filter((item) => item.requestId !== event.itemId);
    next.status = next.approvals.length ? "waiting-approval" : "running";
  }
  if (event.kind === "completed" || event.kind === "interrupted" || event.kind === "error" || event.kind === "disconnected") {
    next.status = event.kind;
    next.approvals = [];
    if (event.kind === "error") next.error = event.text ?? "本地 Harness 失败。";
  }
  return next;
}
