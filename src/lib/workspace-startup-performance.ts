export const WORKSPACE_STARTUP_STAGES = [
  "workspace-open-start",
  "root-tree-ready",
  "first-file-ready",
  "background-index-complete",
] as const;

export type WorkspaceStartupStage = typeof WORKSPACE_STARTUP_STAGES[number];
export type WorkspaceStartupSnapshot = Readonly<Record<WorkspaceStartupStage, number | null>>;

function emptySnapshot(): Record<WorkspaceStartupStage, number | null> {
  return Object.fromEntries(WORKSPACE_STARTUP_STAGES.map((stage) => [stage, null])) as Record<WorkspaceStartupStage, number | null>;
}

let startupSnapshot = emptySnapshot();

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function resetWorkspaceStartupPerformance(): void {
  startupSnapshot = emptySnapshot();
}

export function markWorkspaceStartup(stage: WorkspaceStartupStage): void {
  if (startupSnapshot[stage] !== null) {
    return;
  }

  const stageIndex = WORKSPACE_STARTUP_STAGES.indexOf(stage);
  const previousMarks = WORKSPACE_STARTUP_STAGES
    .slice(0, stageIndex)
    .map((candidate) => startupSnapshot[candidate])
    .filter((value): value is number => typeof value === "number");
  const timestamp = Math.max(now(), ...previousMarks);
  startupSnapshot = { ...startupSnapshot, [stage]: timestamp };

  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    try {
      performance.mark(`lattice:${stage}`);
    } catch {
      // Performance marks are diagnostic only and must never affect startup.
    }
  }
}

export function getWorkspaceStartupSnapshot(): WorkspaceStartupSnapshot {
  return { ...startupSnapshot };
}
