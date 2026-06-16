import { describe, expect, it, vi } from "vitest";
import { focusAgentSession } from "@/lib/ai/agent-session-focus";

describe("focusAgentSession", () => {
  it("focuses a session target through the provided controller", () => {
    const focusSession = vi.fn();

    const focused = focusAgentSession({ focusSession }, "session-alpha", "trace");

    expect(focused).toBe(true);
    expect(focusSession).toHaveBeenCalledWith("session-alpha", "trace");
  });

  it("ignores missing session ids", () => {
    const focusSession = vi.fn();

    expect(focusAgentSession({ focusSession }, null, "memory")).toBe(false);
    expect(focusAgentSession({ focusSession }, undefined, "trace")).toBe(false);
    expect(focusSession).not.toHaveBeenCalled();
  });
});
