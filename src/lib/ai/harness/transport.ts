import { invokeTauriCommand } from "@/lib/storage-adapter";
import type { HarnessTransport } from "./types";

const request = <T>(command: string, value: object) => invokeTauriCommand<T>(command, { request: value }, { timeoutMs: 60000 });

/** Native code owns every process. Web builds have no shell or arbitrary command fallback. */
export const nativeHarnessTransport: HarnessTransport = {
  discover: () => invokeTauriCommand("agent_harness_catalog", {}, { timeoutMs: 60000 }),
  probe: (engine, executable) => invokeTauriCommand("agent_harness_probe", { request: { engine, executable } }, { timeoutMs: 60000 }),
  // Discovery may inspect alternate installs before the owned process performs
  // its two bounded initialization RPCs (50 + 25 + 25 seconds maximum).
  connect: (value) => invokeTauriCommand("agent_harness_connect", { request: value }, { timeoutMs: 120000 }),
  start: (value) => request("agent_harness_start", value),
  resume: (value) => request("agent_harness_resume", value),
  turn: (value) => request("agent_harness_turn", value),
  interrupt: (value) => request("agent_harness_interrupt", value),
  approval: (value) => request("agent_harness_approval", value),
  toolResult: (value) => request("agent_harness_tool_result", value),
  readScratch: (connectionId, path, expectedRevision) => request("agent_harness_read_scratch", { connectionId, path, expectedRevision }),
  drainEvents: (connectionId) => request("agent_harness_drain_events", { connectionId }),
  disconnect: (connectionId) => request("agent_harness_disconnect", { connectionId }),
};
