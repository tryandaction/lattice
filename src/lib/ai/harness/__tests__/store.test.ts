import { describe, expect, it } from "vitest";
import { createAiHarnessStore } from "@/stores/ai-harness-store";
import type { HarnessEvent, HarnessTransport } from "../types";
import type { StorageAdapter } from "@/lib/storage-adapter";

function storage(initial: unknown = null): StorageAdapter {
  let data = initial;
  return { get: async <T>() => data as T, set: async (_key, value) => { data = value; }, remove: async () => { data = null; }, clear: async () => { data = null; } };
}
function transport() {
  const queue: HarnessEvent[] = []; const submitted: string[] = []; const resumed: string[] = [];
  let sequence = 0;
  const emit = (kind: HarnessEvent["kind"], text?: string) => queue.push({ connectionId: "owned", conversationId: "c2", sessionId: "s2", turnId: "t2", sequence: ++sequence, timestamp: Date.now(), kind, text });
  const bridge: HarnessTransport = {
    probe: async (engine) => ({ engine, executable: "C:/codex.exe", version: "fixture", installed: true, supported: true, reason: null, protocol: "codex-app-server-jsonl", capabilities: { resume: true, interrupt: true, approvals: true, workspaceRead: true, scratchWrite: true } }),
    connect: async (request) => ({ connectionId: "owned", conversationId: request.conversationId, engine: request.engine, workspace: request.workspace, scratchPath: "C:/native-scratch/artifacts", permissionProfile: "native", probe: await bridge.probe(request.engine) }),
    start: async () => ({ connectionId: "owned", conversationId: "c2", sessionId: "s2" }),
    resume: async (request) => { resumed.push(request.sessionId); return bridge.start(request); },
    turn: async (request) => { submitted.push(request.text); emit("started"); emit("delta", "# 结果\n"); emit("delta", "完整正文"); emit("completed"); return { connectionId: "owned", conversationId: "c2", sessionId: "s2", turnId: "t2" }; },
    interrupt: async () => { emit("interrupted"); }, approval: async () => {}, disconnect: async () => {},
    toolResult: async () => {}, readScratch: async (_id, path) => ({ path, fileName: "fixture.md", content: "", byteLength: 0, revision: "fixture" }),
    drainEvents: async () => queue.splice(0),
  };
  return { bridge, submitted, resumed, emit };
}

describe("AI harness store", () => {
  it("does not reuse a stale pending assistant while its final event drain is delayed", async () => {
    const t=transport();const original=t.bridge.drainEvents;
    let entered!:()=>void,release!:()=>void;
    const draining=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
    t.bridge.drainEvents=async id=>{entered();await gate;return original(id);};
    const store=createAiHarnessStore({transport:t.bridge,storage:storage(),pollMs:1});store.getState().setConfig({engine:"codex"});
    const first=store.getState().connectConversation("c2","C:/workspace").catch(error=>error);await draining;
    store.getState().setConfig({engine:"claude",model:"claude-model"});
    const second=store.getState().sendTurn({conversationId:"c2",workspace:"C:/workspace",text:"Synthetic draft"}).catch(error=>error);
    release();expect(await first).toBeInstanceOf(Error);expect(await second).toBeInstanceOf(Error);expect(t.submitted).toEqual([]);
  });
  it.each([{engine:"api" as const},{engine:"claude" as const,model:"other-model"},{engine:"codex" as const,executable:"C:/other/codex.exe"},{engine:"codex" as const,model:"other-model"}])("does not submit an old connection after selection changes during preflight: %j", async selected => {
    const t=transport();const original=t.bridge.connect;const disconnected:string[]=[];
    let entered!:()=>void,release!:()=>void;
    const connecting=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
    t.bridge.connect=async request=>{entered();await gate;return original(request);};
    t.bridge.disconnect=async id=>{disconnected.push(id);};
    const store=createAiHarnessStore({transport:t.bridge,storage:storage(),pollMs:1});
    store.getState().setConfig({engine:"codex",model:"selected-model"});
    const outcome=store.getState().sendTurn({conversationId:"c2",workspace:"C:/workspace",text:"Synthetic draft"}).catch(error=>error);
    await connecting;store.getState().setConfig(selected);release();
    expect(await outcome).toBeInstanceOf(Error);
    expect(t.submitted).toEqual([]);expect(disconnected).toEqual(["owned"]);
    expect(store.getState().connections.c2).toBeUndefined();
  });
  it("does not reuse an in-flight connection for another workspace", async () => {
    const t=transport();const original=t.bridge.connect;
    let entered!:()=>void,release!:()=>void;
    const connecting=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
    t.bridge.connect=async request=>{entered();await gate;return original(request);};
    const store=createAiHarnessStore({transport:t.bridge,storage:storage(),pollMs:1});store.getState().setConfig({engine:"codex"});
    const first=store.getState().connectConversation("c2","C:/root-A");await connecting;
    const second=store.getState().connectConversation("c2","C:/root-B").catch(error=>error);release();await first;
    expect(await second).toBeInstanceOf(Error);expect(t.submitted).toEqual([]);
  });
  it("rechecks selection after the asynchronous source validation and before dispatch", async () => {
    const t=transport();const store=createAiHarnessStore({transport:t.bridge,storage:storage(),pollMs:1});store.getState().setConfig({engine:"codex"});
    await expect(store.getState().sendTurn({conversationId:"c2",workspace:"C:/workspace",text:"Synthetic draft",onBeforeTurn:async()=>{store.getState().setConfig({engine:"claude"});}})).rejects.toThrow();
    expect(t.submitted).toEqual([]);
  });
  it.each([true,false])("replaces discovery-only capabilities with the actual connection (native=%s)", async native => {
    const t=transport();const connect=t.bridge.connect;const discover=t.bridge.probe;
    t.bridge.probe=async (...args)=>{const probe=await discover(...args);return {...probe,capabilities:{...probe.capabilities,workspaceRead:!native,scratchWrite:!native}};};
    const reason=native?"MXC execution check passed":"MXC unavailable; Lattice tools only";
    t.bridge.connect=async request=>{const connection=await connect(request);return {...connection,probe:{...connection.probe,reason,capabilities:{...connection.probe.capabilities,workspaceRead:native,scratchWrite:native}}};};
    const store=createAiHarnessStore({transport:t.bridge,storage:storage()});
    store.getState().setConfig({engine:"codex"});
    await store.getState().probe("codex");
    await store.getState().connectConversation("c2","C:/workspace");
    expect(store.getState().probes.codex?.reason).toBe(reason);
    expect(store.getState().probes.codex?.capabilities.workspaceRead).toBe(native);
    expect(store.getState().probes.codex?.capabilities.scratchWrite).toBe(native);
    expect(store.getState().connections.c2.probe).toEqual(store.getState().probes.codex);
  });
  it("passes captured uploaded images as typed native turn input", async () => {
    const t = transport(); const original = t.bridge.turn; let images: unknown;
    t.bridge.turn = async request => { images = request.images; return original(request); };
    const store = createAiHarnessStore({ transport: t.bridge, storage: storage(), pollMs: 1 });
    store.getState().setConfig({ engine: "codex" });
    const uploaded = [{ data: "iVBORw0KGgo=", mimeType: "image/png" }];
    await store.getState().sendTurn({ conversationId: "c2", workspace: "C:/workspace", text: "解释此图", images: uploaded });
    expect(images).toEqual(uploaded);
    expect(t.submitted).toEqual(["解释此图"]);
  });
  it("allows an uploaded image turn without replacing its contents with text", async () => {
    const t = transport(); const store = createAiHarnessStore({ transport: t.bridge, storage: storage(), pollMs: 1 });
    store.getState().setConfig({ engine: "codex" });
    await expect(store.getState().sendTurn({ conversationId: "c2", workspace: "C:/workspace", text: "", images: [{ data: "iVBORw0KGgo=", mimeType: "image/png" }] })).resolves.toBe("# 结果\n完整正文");
    expect(t.submitted).toEqual([""]);
  });
  it("reconnects the conversation after choosing another executable", async () => {
    const t = transport(); const connect = t.bridge.connect; const paths: Array<string | undefined> = [];
    t.bridge.connect = async request => { paths.push(request.executable); return connect(request); };
    const store = createAiHarnessStore({ transport: t.bridge, storage: storage() });
    store.getState().setConfig({ engine: "codex", executable: "C:/first/codex.exe" });
    await store.getState().connectConversation("c2", "C:/workspace");
    store.getState().setConfig({ engine: "codex", executable: "C:/second/codex.exe" });
    await store.getState().connectConversation("c2", "C:/workspace");
    expect(paths).toEqual(["C:/first/codex.exe", "C:/second/codex.exe"]);
  });
  it("does not cancel the new turn when replacing the previous assistant connection", async () => {
    const t = transport(); const store = createAiHarnessStore({ transport: t.bridge, storage: storage(), pollMs: 1 });
    store.getState().setConfig({ engine: "codex", executable: "C:/first/codex.exe" });
    await store.getState().connectConversation("c2", "C:/workspace");
    store.getState().setConfig({ engine: "claude", executable: "C:/second/claude.exe" });
    await expect(store.getState().sendTurn({ conversationId: "c2", workspace: "C:/workspace", text: "Continue the task" })).resolves.toBe("# 结果\n完整正文");
  });
  it("retains each assistant's model and executable when switching sources and restarting", async () => {
    const adapter = storage();
    const t = transport();
    const store = createAiHarnessStore({ transport: t.bridge, storage: adapter });
    await store.getState().hydrate();
    store.getState().setConfig({ engine: "codex", executable: "C:/Apps/codex.exe", model: "codex-fixture-model" });
    store.getState().setConfig({ engine: "claude", executable: "C:/Apps/claude.exe", model: "claude-fixture-model" });
    store.getState().selectEngine("api");
    store.getState().selectEngine("codex");
    expect(store.getState().config).toEqual({ engine: "codex", executable: "C:/Apps/codex.exe", model: "codex-fixture-model" });
    await store.getState().flush();
    const restarted = createAiHarnessStore({ transport: t.bridge, storage: adapter });
    await restarted.getState().hydrate();
    restarted.getState().selectEngine("claude");
    expect(restarted.getState().config).toEqual({ engine: "claude", executable: "C:/Apps/claude.exe", model: "claude-fixture-model" });
  });
  it("deduplicates discovery and preserves saved preferences after detection fails", async () => {
    const t = transport(); let attempts = 0;
    t.bridge.discover = async () => { attempts++; throw new Error("Detection temporarily unavailable"); };
    const store = createAiHarnessStore({ transport: t.bridge, storage: storage() });
    store.getState().setConfig({ engine: "codex", executable: "C:/Apps/codex.exe", model: "selected-model" });
    await Promise.allSettled([store.getState().discover(), store.getState().discover()]);
    expect(attempts).toBe(1);
    expect(store.getState().config.model).toBe("selected-model");
    expect(store.getState().config.executable).toBe("C:/Apps/codex.exe");
    expect(store.getState().discoveryError).toContain("temporarily");
    expect(store.getState().isDiscovering).toBe(false);
  });
  it("does not probe Claude using the active Codex executable", async () => {
    const t = transport(); const paths: Array<string | undefined> = []; const original = t.bridge.probe;
    t.bridge.probe = async (engine, executable) => { paths.push(executable); return original(engine, executable); };
    const store = createAiHarnessStore({ transport: t.bridge, storage: storage() });
    store.getState().setConfig({ engine: "codex", executable: "C:/Apps/codex.exe" });
    await store.getState().probe("claude");
    expect(paths).toEqual([undefined]);
  });
  it("restores configuration and resumes only the matching workspace/conversation mapping", async () => {
    const t = transport();
    const store = createAiHarnessStore({ transport: t.bridge, storage: storage({ version: 1, config: { engine: "codex" }, saved: { c2: { engine: "codex", workspace: "C:/workspace", scratchPath: "C:/native-scratch/artifacts", sessionId: "s2" } } }), pollMs: 1 });
    await store.getState().hydrate();
    expect(store.getState().config.engine).toBe("codex");
    await store.getState().connectConversation("c2", "C:/workspace");
    expect(t.resumed).toEqual(["s2"]);
    expect(store.getState().sessions.c2.status).toBe("ready");
  });
  it("persists opaque cloud identity and resumes the same native-owned workspace", async () => {
    const t = transport(); const original = t.bridge.connect; const adapter = storage(); let connections = 0;
    t.bridge.connect = async request => { connections++; return { ...await original(request), workspace: "C:/native/cloud-workspaces/owned", workspaceSpec: request.workspace }; };
    const store = createAiHarnessStore({ transport: t.bridge, storage: adapter });
    store.getState().setConfig({ engine: "codex", model: "selected-model" });
    await store.getState().connectConversation("c2", "lattice-cloud:provider_scope");
    await store.getState().connectConversation("c2", "lattice-cloud:provider_scope");
    expect(connections).toBe(1);
    expect(store.getState().saved.c2.workspace).toBe("lattice-cloud:provider_scope");
    await store.getState().flush();
    const restarted = createAiHarnessStore({ transport: t.bridge, storage: adapter });
    await restarted.getState().connectConversation("c2", "lattice-cloud:provider_scope");
    expect(t.resumed).toEqual(["s2"]);
  });
  it("passes a changed selected model when resuming a persisted conversation", async () => {
    const t = transport(); let resumedModel: string | undefined;
    const resume = t.bridge.resume; t.bridge.resume = async request => { resumedModel = request.model; return resume(request); };
    const store = createAiHarnessStore({ transport: t.bridge, storage: storage({ version: 1, config: { engine: "codex", model: "new-model" }, saved: { c2: { engine: "codex", workspace: "C:/workspace", scratchPath: "C:/native-scratch/artifacts", sessionId: "s2" } } }) });
    await store.getState().connectConversation("c2", "C:/workspace");
    expect(resumedModel).toBe("new-model");
  });
  it("treats Windows canonical path prefixes as the same authorized workspace", async () => {
    const t = transport();
    const store = createAiHarnessStore({ transport: t.bridge, storage: storage({ version: 1, config: { engine: "codex" }, saved: { c2: { engine: "codex", workspace: "\\\\?\\C:\\workspace", scratchPath: "C:/native-scratch/artifacts", sessionId: "s2" } } }) });
    await store.getState().connectConversation("c2", "C:/workspace");
    expect(t.resumed).toEqual(["s2"]);
  });
  it("does not resume a different case-sensitive POSIX workspace", async () => {
    const t = transport();
    const store = createAiHarnessStore({ transport: t.bridge, storage: storage({ version: 1, config: { engine: "codex" }, saved: { c2: { engine: "codex", workspace: "/workspace/A", scratchPath: "/native-scratch/artifacts", sessionId: "s2" } } }) });
    await store.getState().connectConversation("c2", "/workspace/a");
    expect(t.resumed).toEqual([]);
  });
  it("submits a complete long UTF-8 turn and delivers answer-only callbacks", async () => {
    const t = transport(); const store = createAiHarnessStore({ transport: t.bridge, storage: storage(), pollMs: 1 });
    store.getState().setConfig({ engine: "codex" });
    const text = "中文和 LaTeX $\\psi$\n".repeat(3500); const seen: string[] = [];
    const answer = await store.getState().sendTurn({ conversationId: "c2", workspace: "C:/workspace", text, onEvent: (event) => seen.push(event.kind) });
    expect(t.submitted).toEqual([text]); expect(answer).toBe("# 结果\n完整正文");
    expect(store.getState().sessions.c2.status).toBe("completed"); expect(seen).toContain("completed");
  });
  it("keeps completed task events and its native session when disconnected and reopened", async () => {
    const adapter = storage(), t = transport();
    const store = createAiHarnessStore({ transport: t.bridge, storage: adapter, pollMs: 1 });
    store.getState().setConfig({ engine: "codex" });
    await store.getState().sendTurn({ conversationId: "c2", workspace: "C:/workspace", text: "synthetic history" });
    await store.getState().disconnect("c2");
    await store.getState().flush();
    const reopened = createAiHarnessStore({ transport: t.bridge, storage: adapter });
    await reopened.getState().connectConversation("c2", "C:/workspace");
    expect(t.resumed).toEqual(["s2"]);
    expect(reopened.getState().sessions.c2.events.map(event => event.kind)).toEqual(["started", "delta", "delta", "completed"]);
    expect(reopened.getState().sessions.c2.events.filter(event => event.text).map(event => event.text).join("")).toBe("# 结果\n完整正文");
  });
  it("restores delivered tool receipts separately from the next turn answer", async () => {
    const toolResult = { requestId: "request", callId: "call", success: false, resultBytes: 123, summary: "工具结果已交付；正文省略。", truncated: true };
    const t = transport(), adapter = storage({ version: 1, config: { engine: "codex" }, saved: { c2: { engine: "codex", workspace: "C:/workspace", scratchPath: "C:/native-scratch/artifacts", sessionId: "s2",
      events: [{ connectionId: "previous", conversationId: "c2", sessionId: "s2", turnId: "old-turn", sequence: 1, timestamp: 1, kind: "tool-complete", text: toolResult.summary, toolResult }] } } });
    const store = createAiHarnessStore({ transport: t.bridge, storage: adapter, pollMs: 1 });
    await store.getState().connectConversation("c2", "C:/workspace");
    expect(store.getState().sessions.c2.events[0].toolResult).toEqual(toolResult);
    const answer = await store.getState().sendTurn({ conversationId: "c2", workspace: "C:/workspace", text: "next synthetic task" });
    expect(answer).toBe("# 结果\n完整正文");
    expect(answer).not.toContain(toolResult.summary);
    expect(store.getState().saved.c2.events?.[0].toolResult).toEqual(toolResult);
  });
  it("preserves failed tool task history when the result bridge fails and resumes before the next task", async () => {
    const adapter = storage(), t = transport();
    const originalTurn = t.bridge.turn; let first = true;
    t.bridge.turn = async request => {
      if (!first) return originalTurn(request);
      first = false; t.emit("started");
      const toolEvent: HarnessEvent = { connectionId: "owned", conversationId: "c2", sessionId: "s2", turnId: "t2", sequence: 2, timestamp: 1, kind: "tool-call",
        toolCall: { requestId: "request", callId: "call", tool: "lattice_sources_read", arguments: { path: "note.md" } } };
      const drain = t.bridge.drainEvents;
      t.bridge.drainEvents = async id => { t.bridge.drainEvents = drain; return [...await drain(id), toolEvent]; };
      return { connectionId: "owned", conversationId: "c2", sessionId: "s2", turnId: "t2" };
    };
    t.bridge.toolResult = async () => { throw new Error("native tool result channel disconnected"); };
    const store = createAiHarnessStore({ transport: t.bridge, storage: adapter, pollMs: 1 });
    store.getState().setConfig({ engine: "codex" });
    await expect(store.getState().sendTurn({ conversationId: "c2", workspace: "C:/workspace", text: "synthetic failing tool",
      onToolCall: async () => { throw new Error("source permission revoked"); } })).rejects.toThrow("native tool result channel disconnected");
    expect(store.getState().sessions.c2.status).toBe("error");
    expect(store.getState().saved.c2.events?.some(event => event.kind === "tool-call")).toBe(true);
    await store.getState().disconnect("c2"); await store.getState().flush();
    const reopened = createAiHarnessStore({ transport: t.bridge, storage: adapter, pollMs: 1 });
    await reopened.getState().connectConversation("c2", "C:/workspace");
    expect(t.resumed).toEqual(["s2"]);
    expect(reopened.getState().sessions.c2.events.some(event => event.kind === "tool-call")).toBe(true);
    await expect(reopened.getState().sendTurn({ conversationId: "c2", workspace: "C:/workspace", text: "retry synthetic task" })).resolves.toBe("# 结果\n完整正文");
  });
  it("rechecks the captured source after native connect and before sending its document context", async () => {
    const t = transport(); const store = createAiHarnessStore({ transport: t.bridge, storage: storage(), pollMs: 1 });
    store.getState().setConfig({ engine: "codex" });
    await expect(store.getState().sendTurn({ conversationId: "c2", workspace: "lattice-cloud:account_scope", text: "Private cloud excerpt", onBeforeTurn: () => { throw new Error("cloud account changed"); } }))
      .rejects.toThrow("cloud account changed");
    expect(t.submitted).toEqual([]);
    expect(store.getState().sessions.c2.status).toBe("error");
  });
  it("reconnects and resumes Claude after interrupt killed its owned process", async () => {
    const t = transport(); let connections = 0;
    const connect = t.bridge.connect;
    t.bridge.connect = async (request) => { connections++; return connect(request); };
    const store = createAiHarnessStore({ transport: t.bridge, storage: storage(), pollMs: 1 });
    store.getState().setConfig({ engine: "claude" });
    await store.getState().connectConversation("c2", "C:/workspace");
    store.setState((state) => ({ sessions: { ...state.sessions, c2: { ...state.sessions.c2, turnId: "t2", status: "running" } } }));
    await store.getState().interrupt("c2");
    await store.getState().connectConversation("c2", "C:/workspace");
    expect(connections).toBe(2);
    expect(t.resumed).toEqual(["s2"]);
  });
  it("cancels a turn before its start reply and ignores its late reply", async () => {
    const t = transport(); let finishTurn!: (value: Awaited<ReturnType<HarnessTransport["turn"]>>) => void;
    let markStarted!: () => void; const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let disconnected = 0;
    t.bridge.turn = () => { markStarted(); return new Promise((resolve) => { finishTurn = resolve; }); };
    t.bridge.disconnect = async () => { disconnected++; };
    const store = createAiHarnessStore({ transport: t.bridge, storage: storage(), pollMs: 1 });
    store.getState().setConfig({ engine: "codex" });
    const controller = new AbortController();
    const result = store.getState().sendTurn({ conversationId: "c2", workspace: "C:/workspace", text: "cancel before start", signal: controller.signal }).catch((error: unknown) => error);
    await started; controller.abort();
    const outcome = await Promise.race([result, new Promise<string>((resolve) => setTimeout(() => resolve("cancel timed out"), 200))]);
    expect(outcome).toBeInstanceOf(DOMException);
    expect(disconnected).toBe(1);
    finishTurn({ connectionId: "owned", conversationId: "c2", sessionId: "s2", turnId: "late-turn" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(store.getState().sessions.c2.turnId).toBeNull();
    expect(store.getState().sessions.c2.status).not.toBe("running");
  });
});
