import type { HarnessEngine, HarnessModelOption, HarnessProbe } from "./types";

export interface HarnessDiscoveryCandidate {
  engine: HarnessEngine;
  displayName: string;
  executable: string | null;
  source: "saved" | "known-location" | "path" | "unavailable";
  probe: HarnessProbe | null;
}

export interface HarnessDiscoveryInput {
  engine: HarnessEngine;
  savedExecutable?: string;
  knownLocations?: string[];
  pathExecutables?: string[];
  probe?: HarnessProbe | null;
}

export function discoverHarness(input: HarnessDiscoveryInput): HarnessDiscoveryCandidate {
  const displayName = input.engine === "codex" ? "Codex" : input.engine === "claude" ? "Claude Code" : "DeepSeek";
  const saved = input.savedExecutable?.trim();
  const known = input.knownLocations?.find(Boolean);
  const path = input.pathExecutables?.find(Boolean);
  const executable = saved || known || path || null;
  const source = saved ? "saved" : known ? "known-location" : path ? "path" : "unavailable";
  return { engine: input.engine, displayName, executable, source, probe: input.probe ?? null };
}

export function normalizeHarnessModels(probe: Pick<HarnessProbe, "models"> | null): HarnessModelOption[] {
  const models = probe?.models ?? [];
  const seen = new Set<string>();
  return models.filter(model => {
    if (!model.id.trim() || seen.has(model.id)) return false;
    seen.add(model.id); return true;
  }).map(model => ({ ...model, name: model.name || model.id, source: "harness" as const }));
}
