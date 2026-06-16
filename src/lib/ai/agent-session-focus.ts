export type AgentSessionFocusTarget = "trace" | "memory";

export interface AgentSessionFocusController {
  focusSession: (sessionId: string, target: AgentSessionFocusTarget) => void;
}

export function focusAgentSession(
  controller: AgentSessionFocusController,
  sessionId: string | null | undefined,
  target: AgentSessionFocusTarget,
): boolean {
  if (!sessionId) {
    return false;
  }
  controller.focusSession(sessionId, target);
  return true;
}
