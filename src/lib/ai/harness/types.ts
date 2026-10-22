export type HarnessEngine = "codex" | "claude" | "deepseek";
export interface HarnessModelOption { id: string; name: string; isDefault?: boolean; source?: "api" | "harness" | "default"; }
export type HarnessStatus = "connected" | "ready" | "running" | "waiting-approval" | "completed" | "interrupted" | "error" | "disconnected";

export interface HarnessProbe {
  engine: HarnessEngine;
  executable: string | null;
  version: string | null;
  installed: boolean;
  supported: boolean;
  reason: string | null;
  protocol: "codex-app-server-jsonl" | "claude-stream-json" | "unsupported";
  displayName?: string;
  authStatus?: "ready" | "login-required" | "unknown";
  models?: HarnessModelOption[];
  capabilities: {
    resume: boolean; interrupt: boolean; approvals: boolean;
    /** Direct native filesystem tools; Lattice's scoped source tools are separate. */
    workspaceRead: boolean; scratchWrite: boolean;
    /** This connection disables inherited MCP servers; Lattice tools are registered separately.
     * Older bridges may report an unverified external-tool boundary as true. */
    inheritedExternalTools?: boolean;
  };
}

export interface HarnessConnectRequest {
  engine: HarnessEngine;
  executable?: string;
  conversationId: string;
  /** Authorized local path or opaque lattice-cloud:<scope>; native code resolves either. */
  workspace: string;
  /** Reconnect only to a native-created scratch recorded for this conversation. */
  scratchPath?: string;
}

export interface HarnessConnection {
  connectionId: string;
  conversationId: string;
  engine: HarnessEngine;
  workspace: string;
  /** Opaque cloud identity; workspace above remains the native-owned physical directory. */
  workspaceSpec?: string;
  scratchPath: string;
  permissionProfile: string | null;
  probe: HarnessProbe;
}

export interface HarnessDynamicTool { type: "function"; name: string; description: string; inputSchema: object }
export interface HarnessToolCall { requestId: string; callId: string; tool: string; arguments: unknown }
export interface HarnessToolResultRequest extends HarnessInterruptRequest { requestId: string; callId: string; success: boolean; text: string }
export interface HarnessScratchArtifact { path: string; fileName: string; content: string; byteLength: number; revision: string }
export interface HarnessSessionRequest { connectionId: string; model?: string; dynamicTools?: HarnessDynamicTool[] }
export interface HarnessResumeRequest extends HarnessSessionRequest { sessionId: string }
export interface HarnessSessionInfo { sessionId: string; connectionId: string; conversationId: string }
/** Uploaded inline image only; raw standard base64, never a local path or remote URL. */
export interface HarnessImageInput { data: string; mimeType: string }
export interface HarnessTurnRequest { connectionId: string; sessionId: string; text: string; model?: string; images?: HarnessImageInput[] }
export interface HarnessTurnInfo extends HarnessSessionInfo { turnId: string }
export interface HarnessInterruptRequest { connectionId: string; sessionId: string; turnId: string }
export interface HarnessApprovalRequest extends HarnessInterruptRequest { requestId: string; decision: "accept" | "decline" | "cancel" }

export interface HarnessApproval {
  requestId: string;
  itemId: string;
  method: string;
  action: string;
  paths: string[];
  diff?: string;
  /** Shell/permission escalation requests can be declined, never accepted. */
  canAccept: boolean;
  decisionScope: "scratch-only";
}

export interface HarnessEvent {
  connectionId: string;
  conversationId: string;
  sessionId?: string | null;
  turnId?: string | null;
  sequence: number;
  timestamp: number;
  kind: "connected" | "session" | "started" | "delta" | "message" | "commentary" | "tool-start" | "tool-complete" | "tool-call" | "file-change" | "approval" | "approval-resolved" | "completed" | "interrupted" | "error" | "disconnected" | "notice";
  text?: string;
  /** Public assistant message phase; no hidden reasoning is exposed. */
  phase?: "commentary" | "final_answer";
  itemId?: string;
  method?: string;
  approval?: HarnessApproval;
  toolCall?: HarnessToolCall;
  /** Receipt after native delivery; result bodies are omitted from the event history. */
  toolResult?: { requestId: string; callId: string; success: boolean; resultBytes: number; summary: string; truncated: boolean };
  /** Native-resolved paths inside this connection's owned scratch only. */
  scratchPaths?: string[];
  exitCode?: number | null;
}

export interface HarnessConversationSession {
  conversationId: string;
  connectionId: string;
  sessionId: string | null;
  turnId: string | null;
  status: HarnessStatus;
  sequence: number;
  text: string;
  events: HarnessEvent[];
  approvals: HarnessApproval[];
  error?: string | null;
}

export interface HarnessRuntimeConfig { engine: "api" | HarnessEngine; executable?: string; model?: string }

export interface HarnessTransport {
  discover?(): Promise<HarnessProbe[]>;
  probe(engine: HarnessEngine, executable?: string): Promise<HarnessProbe>;
  connect(request: HarnessConnectRequest): Promise<HarnessConnection>;
  start(request: HarnessSessionRequest): Promise<HarnessSessionInfo>;
  resume(request: HarnessResumeRequest): Promise<HarnessSessionInfo>;
  turn(request: HarnessTurnRequest): Promise<HarnessTurnInfo>;
  interrupt(request: HarnessInterruptRequest): Promise<void>;
  approval(request: HarnessApprovalRequest): Promise<void>;
  toolResult(request: HarnessToolResultRequest): Promise<void>;
  readScratch(connectionId: string, path: string, expectedRevision?: string): Promise<HarnessScratchArtifact>;
  drainEvents(connectionId: string): Promise<HarnessEvent[]>;
  disconnect(connectionId: string): Promise<void>;
}
