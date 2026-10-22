import { create } from "zustand";
import { getStorageAdapter, type StorageAdapter } from "@/lib/storage-adapter";
import { nativeHarnessTransport } from "@/lib/ai/harness/transport";
import { HARNESS_PROMPT_BYTE_LIMIT, normalizeHarnessEvent, reduceHarnessSession, validateHarnessPrompt } from "@/lib/ai/harness/protocol";
import type { HarnessConnection, HarnessConversationSession, HarnessEngine, HarnessEvent, HarnessImageInput, HarnessProbe, HarnessRuntimeConfig, HarnessScratchArtifact, HarnessToolCall, HarnessTransport } from "@/lib/ai/harness/types";
import { LATTICE_HARNESS_DYNAMIC_TOOLS } from "@/lib/ai/harness/tool-broker";
import { serializeHarnessToolResult } from "@/lib/ai/harness/tool-result";

const STORAGE_KEY = "lattice-ai-harness-v1";
interface SavedSession { engine: HarnessEngine; workspace: string; scratchPath: string; sessionId: string; events?: HarnessEvent[] }
interface PersistedHarness { version: 1; config: HarnessRuntimeConfig; configurations?: Partial<Record<HarnessEngine, HarnessRuntimeConfig>>; saved: Record<string, SavedSession> }
export interface HarnessSendTurnOptions {
  conversationId: string; workspace: string; text: string; signal?: AbortSignal;
  images?: HarnessImageInput[];
  /** Actual sanitized native events, including answer deltas and approval requests. */
  onEvent?: (event: HarnessEvent) => void;
  /** Authorized source/PDF proposal broker; never an apply/write permission callback. */
  onToolCall?: (call: HarnessToolCall) => Promise<{ success: boolean; text: string }>;
  /** Recheck the captured conversation/source after connecting, before sending text to the native model. */
  onBeforeTurn?: () => void | Promise<void>;
}
export interface AiHarnessStore {
  config: HarnessRuntimeConfig;
  configurations: Partial<Record<HarnessEngine, HarnessRuntimeConfig>>;
  probes: Partial<Record<HarnessEngine, HarnessProbe>>;
  isDiscovering: boolean; discoveryError: string | null; discoveryComplete: boolean;
  connections: Record<string, HarnessConnection>;
  sessions: Record<string, HarnessConversationSession>;
  saved: Record<string, SavedSession>;
  isHydrated: boolean; isLoading: boolean; error: string | null;
  hydrate(): Promise<void>;
  flush(): Promise<void>;
  setConfig(config: HarnessRuntimeConfig): void;
  selectEngine(engine: HarnessRuntimeConfig["engine"]): void;
  discover(): Promise<void>;
  probe(engine?: HarnessEngine, executable?: string): Promise<HarnessProbe>;
  connectConversation(conversationId: string, workspace: string): Promise<HarnessConnection>;
  sendTurn(options: HarnessSendTurnOptions): Promise<string>;
  interrupt(conversationId: string): Promise<void>;
  approve(conversationId: string, requestId: string, decision: "accept" | "decline" | "cancel"): Promise<void>;
  disconnect(conversationId: string): Promise<void>;
  readScratch(conversationId: string, path: string, expectedRevision?: string): Promise<HarnessScratchArtifact>;
}

const identity = (path: string) => {
  const normalized = path.replace(/\\/gu, "/").replace(/^\/\/\?\//u, "").replace(/\/+$/u, "");
  return /^[a-z]:\//iu.test(normalized) || normalized.startsWith("//") ? normalized.toLocaleLowerCase() : normalized;
};
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const validConfig = (value: unknown): value is HarnessRuntimeConfig => Boolean(value && typeof value === "object" && ["api", "codex", "claude", "deepseek"].includes((value as HarnessRuntimeConfig).engine));

export function createAiHarnessStore(options: { transport?: HarnessTransport; storage?: StorageAdapter; pollMs?: number } = {}) {
  const transport = options.transport ?? nativeHarnessTransport;
  const storage = () => options.storage ?? getStorageAdapter();
  let hydration: Promise<void> | null = null;
  let persistence: Promise<void> = Promise.resolve();
  let discovery: Promise<void> | null = null;
  let configRevision = 0;
  const connecting = new Map<string, Promise<HarnessConnection>>();
  const connectedConfigurations = new Map<string, HarnessRuntimeConfig>();
  const runs = new Map<string, { cancelled: boolean; interruptSent: boolean }>();
  const store = create<AiHarnessStore>((set, get) => {
    const persist = () => {
      const current = get();
      const snapshot: PersistedHarness = { version: 1, config: { ...current.config }, configurations: { ...current.configurations }, saved: JSON.parse(JSON.stringify(current.saved)) as Record<string, SavedSession> };
      persistence = persistence.catch(() => {}).then(async () => {
        const adapter = storage();
        await (adapter.setStrict ? adapter.setStrict(STORAGE_KEY, snapshot) : adapter.set(STORAGE_KEY, snapshot));
      }).catch((error: unknown) => { set({ error: `本地 Harness 状态保存失败：${errorText(error)}` }); throw error; });
      void persistence.catch(() => {});
    };
    const acceptEvents = async (conversationId: string, onEvent?: (event: HarnessEvent) => void, onToolCall?: HarnessSendTurnOptions["onToolCall"]) => {
      const connection = get().connections[conversationId];
      if (!connection) return;
      const events = await transport.drainEvents(connection.connectionId);
      for (const raw of events) {
        const event = normalizeHarnessEvent(raw); const current = get().sessions[conversationId];
        if (!event || !current) continue;
        const next = reduceHarnessSession(current, event);
        // Reducer identity is the acceptance gate. A late or cross-scope event
        // must never reach UI callbacks or a Lattice tool broker.
        if (next === current) continue;
        set((state) => ({ sessions: { ...state.sessions, [conversationId]: next } }));
        onEvent?.(event);
        if (event.kind === "tool-call" && event.toolCall && event.sessionId && event.turnId) {
          let result: { success: boolean; text: string };
          try { result = onToolCall ? await onToolCall(event.toolCall) : { success: false, text: "当前会话未绑定授权源/PDF提案 broker；工具未执行。" }; }
          catch (error) { result = { success: false, text: errorText(error) }; }
          const currentRun = runs.get(conversationId);
          if (currentRun?.cancelled) continue;
          await transport.toolResult({ connectionId: event.connectionId, sessionId: event.sessionId, turnId: event.turnId, requestId: event.toolCall.requestId, callId: event.toolCall.callId, ...serializeHarnessToolResult(result) });
        }
      }
    };
    return {
      config: { engine: "api" }, configurations: {}, probes: {}, isDiscovering: false, discoveryError: null, discoveryComplete: false, connections: {}, sessions: {}, saved: {}, isHydrated: false, isLoading: false, error: null,
      hydrate: () => {
        if (get().isHydrated) return Promise.resolve();
        if (hydration) return hydration;
        const revision = configRevision; set({ isLoading: true });
        hydration = (async () => {
          try {
            const adapter = storage();
            const value = await (adapter.getStrict ? adapter.getStrict<PersistedHarness>(STORAGE_KEY) : adapter.get<PersistedHarness>(STORAGE_KEY));
            if (value && value.version === 1) {
              const saved: Record<string, SavedSession> = {};
              for (const [key, item] of Object.entries(value.saved ?? {}).slice(0, 200)) {
                if (item && ["codex", "claude"].includes(item.engine) && typeof item.workspace === "string" && typeof item.scratchPath === "string" && typeof item.sessionId === "string") saved[key] = { ...item, events: (item.events ?? []).map(normalizeHarnessEvent).filter((event): event is HarnessEvent => event !== null).slice(-400) };
              }
              const configurations: Partial<Record<HarnessEngine, HarnessRuntimeConfig>> = {};
              for (const engine of ["codex", "claude", "deepseek"] as const) {
                const entry = value.configurations?.[engine];
                if (validConfig(entry) && entry.engine === engine) configurations[engine] = entry;
              }
              if (validConfig(value.config) && value.config.engine !== "api") configurations[value.config.engine] = value.config;
              set({ saved, configurations: { ...configurations, ...get().configurations }, ...(revision === configRevision && validConfig(value.config) ? { config: { engine: value.config.engine, executable: value.config.executable, model: value.config.model } } : {}) });
            }
            set({ isHydrated: true, isLoading: false });
          } catch (error) { set({ isLoading: false, error: `本地 Harness 状态恢复失败：${errorText(error)}` }); throw error; }
          finally { hydration = null; }
        })();
        return hydration;
      },
      flush: async () => { await get().hydrate(); await persistence; },
      setConfig: (config) => {
        if (!validConfig(config)) throw new Error("未知 Harness 运行方式。");
        configRevision++;
        const normalized = { engine: config.engine, ...(config.executable?.trim() ? { executable: config.executable.trim() } : {}), ...(config.model?.trim() ? { model: config.model.trim() } : {}) };
        set(state => ({ config: normalized, ...(config.engine !== "api" ? { configurations: { ...state.configurations, [config.engine]: normalized } } : {}), error: null }));
        // Hydrate before persisting so early UI edits cannot erase saved conversation mappings.
        void get().hydrate().then(() => persist()).catch(() => {});
      },
      selectEngine: engine => get().setConfig(engine === "api" ? { engine } : get().configurations[engine] ?? { engine }),
      discover: () => {
        if (discovery) return discovery;
        set({ isDiscovering: true, discoveryError: null });
        discovery = (async () => {
          try {
            await get().hydrate();
            const results = transport.discover ? await transport.discover() : [];
            const explicit = await Promise.all(Object.values(get().configurations).filter(config => config?.engine !== "api" && config?.executable).map(config => transport.probe(config!.engine as HarnessEngine, config!.executable)));
            set(state => ({ probes: { ...state.probes, ...Object.fromEntries([...results, ...explicit].map(result => [result.engine, result])) }, discoveryComplete: true, isDiscovering: false }));
          } catch (error) { set({ isDiscovering: false, discoveryError: errorText(error) }); throw error; }
          finally { discovery = null; }
        })();
        return discovery;
      },
      probe: async (engine, executable) => {
        const config = get().config;
        const selected = engine ?? (config.engine === "api" ? "codex" : config.engine);
        set({ isLoading: true, error: null });
        const path = executable ?? (config.engine === selected ? config.executable : get().configurations[selected]?.executable);
        try { const result = await transport.probe(selected, path); set((state) => ({ probes: { ...state.probes, [selected]: result }, isLoading: false, error: result.supported ? null : result.reason })); return result; }
        catch (error) { set({ isLoading: false, error: errorText(error) }); throw error; }
      },
      connectConversation: (conversationId, workspace) => {
        if (connecting.has(conversationId)) {
          const selected={...get().config};const revision=configRevision;
          return connecting.get(conversationId)!.then(connection => {
            const bound=connectedConfigurations.get(conversationId);
            if (revision!==configRevision || connection.engine!==selected.engine || identity(bound?.executable??"")!==identity(selected.executable??"") || identity(connection.workspaceSpec ?? connection.workspace)!==identity(workspace)) throw new Error("AI 来源或工作区已切换，旧连接未用于本次请求；请重新发送。");
            return connection;
          });
        }
        const pending = (async () => {
          await get().hydrate();
          const config = { ...get().config };
          const revision = configRevision;
          if (config.engine === "api") throw new Error("当前为 API 研究助手，请选择本机 Harness。");
          const existing = get().connections[conversationId];
          const current = get().sessions[conversationId];
          const boundConfig = connectedConfigurations.get(conversationId);
          const sameExecutable = identity(boundConfig?.executable ?? '') === identity(config.executable ?? '');
          if (existing && sameExecutable && existing.engine === config.engine && identity(existing.workspaceSpec ?? existing.workspace) === identity(workspace) && current?.status !== "disconnected" && current?.status !== "error" && !(existing.engine === "claude" && current?.status === "interrupted")) return existing;
          // A new turn owns runs[conversationId] already; replacing its old idle
          // connection must not cancel the newly registered turn.
          if (existing) { await transport.disconnect(existing.connectionId); connectedConfigurations.delete(conversationId); }
          const previous = get().saved[conversationId];
          const resume = previous && previous.engine === config.engine && identity(previous.workspace) === identity(workspace) ? previous : null;
          set({ isLoading: true, error: null });
          const connection = await transport.connect({ engine: config.engine, executable: config.executable, conversationId, workspace, ...(resume ? { scratchPath: resume.scratchPath } : {}) });
          if (revision !== configRevision || connection.engine !== config.engine || connection.conversationId !== conversationId || identity(connection.workspaceSpec ?? connection.workspace) !== identity(workspace)) {
            await transport.disconnect(connection.connectionId);
            throw new Error("AI 来源或工作区已变化，旧连接未发送正文；请重新发送。");
          }
          connectedConfigurations.set(conversationId, config);
          set((state) => ({ connections: { ...state.connections, [conversationId]: connection }, sessions: { ...state.sessions, [conversationId]: { conversationId, connectionId: connection.connectionId, sessionId: null, turnId: null, sequence: 0, status: "connected", text: "", events: resume?.events ?? [], approvals: [] } } }));
          try {
            const session = resume ? await transport.resume({ connectionId: connection.connectionId, sessionId: resume.sessionId, model: config.model, dynamicTools: LATTICE_HARNESS_DYNAMIC_TOOLS }) : await transport.start({ connectionId: connection.connectionId, model: config.model, dynamicTools: LATTICE_HARNESS_DYNAMIC_TOOLS });
            if (revision !== configRevision) throw new Error("AI 来源已切换，旧会话未发送正文；请重新发送。");
            if (session.conversationId !== conversationId || session.connectionId !== connection.connectionId) throw new Error("Harness 会话映射与当前 conversation 不匹配。");
            set((state) => ({ probes: { ...state.probes, [connection.engine]: connection.probe }, sessions: { ...state.sessions, [conversationId]: { ...state.sessions[conversationId], sessionId: session.sessionId, status: "ready" } }, saved: { ...state.saved, [conversationId]: { engine: connection.engine, workspace: connection.workspaceSpec ?? connection.workspace, scratchPath: connection.scratchPath, sessionId: session.sessionId, events: state.sessions[conversationId]?.events ?? [] } }, isLoading: false }));
            await acceptEvents(conversationId); persist();
            if (revision !== configRevision) throw new Error("AI 来源已切换，旧会话未发送正文；请重新发送。");
            return connection;
          } catch (error) { await transport.disconnect(connection.connectionId); connectedConfigurations.delete(conversationId); set((state) => ({ isLoading: false, error: errorText(error), connections: Object.fromEntries(Object.entries(state.connections).filter(([id]) => id !== conversationId)), sessions: { ...state.sessions, [conversationId]: { ...state.sessions[conversationId], status: "error", error: errorText(error) } } })); throw error; }
        })().catch((error: unknown) => { set({ isLoading: false, error: errorText(error) }); throw error; }).finally(() => { connecting.delete(conversationId); });
        connecting.set(conversationId, pending); return pending;
      },
      sendTurn: async (request) => {
        const images = request.images?.map(({ data, mimeType }) => ({ data, mimeType }));
        const text = !request.text.trim() && images?.length ? request.text : validateHarnessPrompt(request.text);
        if (!text.trim() && new TextEncoder().encode(text).byteLength > HARNESS_PROMPT_BYTE_LIMIT) throw new Error("本地 Harness 单次正文上限为 1 MiB，请按章节分批发送；原草稿仍完整保留。");
        const id = request.conversationId;
        if (runs.has(id)) throw new Error("当前对话已有本地任务。");
        const run = { cancelled: request.signal?.aborted ?? false, interruptSent: false }; runs.set(id, run);
        const requestRevision = configRevision;
        const onAbort = () => { run.cancelled = true; void get().interrupt(id).catch(() => {}); };
        request.signal?.addEventListener("abort", onAbort, { once: true });
        try {
          await get().hydrate();
          if (requestRevision !== configRevision) throw new Error("AI 来源已切换，本次未发送正文；请重新发送。");
          const selectedModel = get().config.model;
          const selectedEngine = get().config.engine;
          const connection = await get().connectConversation(id, request.workspace);
          if (requestRevision !== configRevision || connection.engine!==selectedEngine || identity(connection.workspaceSpec ?? connection.workspace) !== identity(request.workspace)) throw new Error("AI 来源或工作区已变化，本次未发送正文；请重新发送。");
          if (run.cancelled) throw new DOMException("已停止本地任务。", "AbortError");
          const session = get().sessions[id];
          if (!session?.sessionId) throw new Error("Harness 未返回 session ID。");
          await request.onBeforeTurn?.();
          if (requestRevision !== configRevision) throw new Error("AI 来源已切换，本次未发送正文；请重新发送。");
          if (run.cancelled || request.signal?.aborted) throw new DOMException("已停止本地任务。", "AbortError");
          set((state) => ({ sessions: { ...state.sessions, [id]: { ...state.sessions[id], text: "", turnId: null, status: "running", approvals: [], error: null } } }));
          let turnReady = false; let turnError: unknown = null;
          const started = transport.turn({ connectionId: connection.connectionId, sessionId: session.sessionId, text, model: selectedModel, ...(images?.length ? { images } : {}) }).then((info) => {
            if (run.cancelled || get().connections[id]?.connectionId !== connection.connectionId) throw new DOMException("已停止本地任务。", "AbortError");
            if (info.connectionId !== connection.connectionId || info.conversationId !== id || info.sessionId !== session.sessionId) throw new Error("Harness turn 映射不匹配。");
            const current = get().sessions[id];
            if (current?.turnId && current.turnId !== info.turnId) throw new Error("Harness turn ID 与事件流不一致。");
            set((state) => ({ sessions: { ...state.sessions, [id]: { ...state.sessions[id], turnId: info.turnId } } })); turnReady = true;
          }).catch((error: unknown) => { turnReady = true; turnError = error; });
          const deadline = Date.now() + 20 * 60 * 1000;
          while (Date.now() < deadline) {
            await acceptEvents(id, request.onEvent, request.onToolCall);
            const current = get().sessions[id];
            if (run.cancelled) {
              if (!turnReady && !current.turnId) await get().disconnect(id);
              else await get().interrupt(id);
              throw new DOMException("已停止本地任务。", "AbortError");
            }
            if (turnReady && turnError) throw turnError;
            if (turnReady && current.status === "completed") { await started; return current.text; }
            if (turnReady && ["interrupted", "error", "disconnected"].includes(current.status)) throw new Error(current.error ?? "本地任务已停止；部分输出已保留。");
            await new Promise<void>((resolve) => setTimeout(resolve, options.pollMs ?? 60));
          }
          run.cancelled = true; await get().interrupt(id); throw new Error("本地任务超过 20 分钟，已停止并保留输出。");
        } catch (error) {
          const current = get().sessions[id];
          if (current && current.status !== "completed") set((state) => ({ error: errorText(error), sessions: { ...state.sessions, [id]: { ...state.sessions[id], status: run.cancelled ? "interrupted" : "error", approvals: [], error: errorText(error) } } }));
          throw error;
        } finally {
          request.signal?.removeEventListener("abort", onAbort); runs.delete(id);
          const current = get().sessions[id]; const previous = get().saved[id];
          if (current && previous) set((state) => ({ saved: { ...state.saved, [id]: { ...previous, events: current.events.slice(-400) } } }));
          persist(); await persistence;
        }
      },
      interrupt: async (id) => {
        const run = runs.get(id); if (run) run.cancelled = true;
        const current = get().sessions[id];
        if (!current) return;
        set((state) => ({ sessions: { ...state.sessions, [id]: { ...state.sessions[id], status: "interrupted", approvals: [] } } }));
        if (current.sessionId && current.turnId && !run?.interruptSent) {
          if (run) run.interruptSent = true;
          await transport.interrupt({ connectionId: current.connectionId, sessionId: current.sessionId, turnId: current.turnId });
        }
      },
      approve: async (id, requestId, decision) => {
        const current = get().sessions[id]; const approval = current?.approvals.find((item) => item.requestId === requestId);
        if (!current?.sessionId || !current.turnId || !approval || (decision === "accept" && !approval.canAccept)) throw new Error("审批已过期、范围不匹配或该操作不可授权。");
        await transport.approval({ connectionId: current.connectionId, sessionId: current.sessionId, turnId: current.turnId, requestId, decision });
        if (decision === "cancel") await get().interrupt(id);
      },
      disconnect: async (id) => {
        const connection = get().connections[id];
        if (runs.has(id)) await get().interrupt(id);
        if (connection) await transport.disconnect(connection.connectionId);
        connectedConfigurations.delete(id);
        set((state) => ({ connections: Object.fromEntries(Object.entries(state.connections).filter(([key]) => key !== id)), sessions: state.sessions[id] ? { ...state.sessions, [id]: { ...state.sessions[id], status: "disconnected", approvals: [] } } : state.sessions }));
        persist();
      },
      readScratch: async (id, path, expectedRevision) => {
        const connection = get().connections[id];
        if (!connection) throw new Error("请先连接拥有该 scratch 的本地会话。");
        return transport.readScratch(connection.connectionId, path, expectedRevision);
      },
    };
  });
  return store;
}

export const useAiHarnessStore = createAiHarnessStore();
