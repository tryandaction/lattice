import { LATTICE_HARNESS_TOOLS } from './lattice-tool-definitions';
import type { HarnessDynamicTool } from "./types";

const originalNames = new Map<string, string>(LATTICE_HARNESS_TOOLS.map((tool) => [tool.name.replace(/\./gu, "_"), tool.name]));

export function harnessToolNameToLattice(name: string): string {
  const original = originalNames.get(name);
  if (!original) throw new Error("本地 Harness 请求了未声明的 Lattice 工具。");
  return original;
}

/** Responses function names cannot contain dots. The source broker retains its stable API names. */
export const LATTICE_HARNESS_DYNAMIC_TOOLS: HarnessDynamicTool[] = LATTICE_HARNESS_TOOLS.map((tool) => ({
  type: "function", name: tool.name.replace(/\./gu, "_"), description: tool.description, inputSchema: tool.parameters,
}));
