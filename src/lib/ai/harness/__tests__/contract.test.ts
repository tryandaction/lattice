import { describe, expect, it } from "vitest";
import { normalizeHarnessEvent, reduceHarnessSession, validateHarnessPrompt } from "../protocol";

describe("harness conversation and terminal boundaries", () => {
  const session = { conversationId: "c2", connectionId: "native-2", sessionId: "s2", turnId: "t2", status: "running" as const, sequence: 0, text: "", events: [], approvals: [] };
  it("keeps the complete 50K mixed prompt and rejects the explicit byte limit", () => {
    const text = "中文LaTeX $\\alpha$\n".repeat(3500);
    expect(validateHarnessPrompt(text)).toBe(text);
    expect(() => validateHarnessPrompt("汉".repeat(400000))).toThrow(/1 MiB/);
  });
  it("rejects cross conversation events and running deltas after interrupt", () => {
    const event = { connectionId: "native-2", conversationId: "other", sessionId: "s2", turnId: "t2", sequence: 1, timestamp: 1, kind: "delta" as const, text: "wrong" };
    expect(reduceHarnessSession(session, event)).toBe(session);
    const stopped = reduceHarnessSession(session, { ...event, conversationId: "c2", kind: "interrupted" });
    expect(stopped.status).toBe("interrupted");
    expect(reduceHarnessSession(stopped, { ...event, conversationId: "c2", sequence: 2 })).toBe(stopped);
  });
  it("does not mistake an internal reasoning event for an answer", () => {
    expect(normalizeHarnessEvent({ ...session, sequence: 1, timestamp: 1, kind: "reasoning", text: "private chain" })).toBeNull();
  });
  it("keeps visible interim commentary separate from final answer text", () => {
    const raw = { connectionId: "native-2", conversationId: "c2", sessionId: "s2", turnId: "t2", sequence: 1, timestamp: 1, kind: "commentary", phase: "commentary", text: "正在读取本文" };
    const commentary = normalizeHarnessEvent(raw);
    expect(commentary).not.toBeNull();
    const next = reduceHarnessSession(session, commentary!);
    expect(next.text).toBe("");
    expect(next.events[0].text).toBe("正在读取本文");
    const final = reduceHarnessSession(next, { ...raw, sequence: 2, kind: "message", phase: "final_answer", text: "本文结论" } as never);
    expect(final.text).toBe("本文结论");
  });
  it("binds approval IDs to the current session and deduplicates events", () => {
    const event = { connectionId: "native-2", conversationId: "c2", sessionId: "s2", turnId: "t2", sequence: 1, timestamp: 1, kind: "approval" as const, approval: { requestId: "a1", itemId: "item", method: "item/fileChange/requestApproval", decisionScope: "scratch-only" as const, action: "Write scratch", paths: ["scratch/result.md"], diff: "+content", canAccept: true } };
    const next = reduceHarnessSession(session, event);
    expect(next.approvals).toHaveLength(1);
    expect(reduceHarnessSession(next, event)).toBe(next);
  });
  it("preserves bounded delivered tool-result metadata without adding it to the answer", () => {
    const result = { requestId: "request", callId: "call", success: true, resultBytes: 18, summary: "value=17", truncated: true };
    const event = normalizeHarnessEvent({ connectionId: "native-2", conversationId: "c2", sessionId: "s2", turnId: "t2",
      sequence: 1, timestamp: 1, kind: "tool-complete", text: "Lattice tool result delivered", toolResult: result });
    const next = reduceHarnessSession(session, event!);
    expect(next.events[0]).toMatchObject({ toolResult: result });
    expect(next.text).toBe("");
  });
  it("drops malformed or oversized result receipts rather than persisting unchecked payloads", () => {
    const receipt = { requestId: "request", callId: "call", success: false, resultBytes: 18, summary: "result body omitted", truncated: true };
    const raw = { connectionId: "native-2", conversationId: "c2", sessionId: "s2", turnId: "t2", sequence: 1, timestamp: 1, kind: "tool-complete" };
    for (const patch of [{ resultBytes: -1 }, { resultBytes: 2 * 1024 * 1024 }, { summary: "x".repeat(513) }, { success: "true" }, { truncated: null }]) {
      expect(normalizeHarnessEvent({ ...raw, toolResult: { ...receipt, ...patch } })).not.toHaveProperty("toolResult");
    }
    expect(normalizeHarnessEvent({ ...raw, toolResult: { ...receipt, privateRawBody: "must not persist" } })).toMatchObject({ toolResult: receipt });
    expect(JSON.stringify(normalizeHarnessEvent({ ...raw, toolResult: { ...receipt, privateRawBody: "must not persist" } }))).not.toContain("must not persist");
  });
});
