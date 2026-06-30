"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  FileText,
  ListChecks,
  MessageSquare,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  buildCodingQaRunnerApprovalRequest,
  buildCodingQaEvidenceCandidates,
  buildCodingQaRunnerViewModel,
  type CodingQaEvidenceCandidate,
  type CodingQaRunnerViewModel,
} from "@/lib/ai/coding-qa-runner-view-model";
import {
  buildAgentCoworkInboxViewModel,
  formatAgentCoworkInboxMarkdown,
  type AgentCoworkInboxItem,
  type AgentCoworkInboxItemKind,
  type AgentCoworkInboxWorkspaceRisk,
} from "@/lib/ai/agent-cowork-inbox-view-model";
import { focusAgentSession } from "@/lib/ai/agent-session-focus";
import type { TranslationKey } from "@/lib/i18n";
import { findPane, getAllPaneIds } from "@/lib/layout-utils";
import { useAgentSessionStore } from "@/stores/agent-session-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useI18n } from "@/hooks/use-i18n";
import type { LayoutNode, TabState } from "@/types/layout";

type ProtocolStatus = "pending" | "in_progress" | "completed";
type WorkspaceTab = "execution" | "evidence" | "decisions" | "handoff";

interface ProtocolStage {
  id: string;
  title: string;
  description: string;
  checks: string[];
}

interface TaskContext {
  goal: string;
  scope: string;
  notes: string;
}

interface RiskDraft {
  operationType: string;
  impactScope: string;
  riskAssessment: string;
}

interface ClosureGate {
  id: string;
  title: string;
  description: string;
  evidenceKeywords: string[];
}

type EvidenceStatus = "passed" | "failed" | "blocked";
type EvidenceFilter = EvidenceStatus | "all";

interface EvidenceEntry {
  id: string;
  label: string;
  command: string;
  result: string;
  status: EvidenceStatus;
  importedKey?: string;
  sourceKind?: "coding-qa";
  sourceSessionId?: string;
  sourceApprovalId?: string;
}

interface EvidenceDraft {
  label: string;
  command: string;
  result: string;
  status: EvidenceStatus;
}

interface EvidenceTemplate {
  id: string;
  title: string;
  command: string;
  result: string;
  status: EvidenceStatus;
}

interface DecisionRecord {
  id: string;
  title: string;
  basis: string;
  impact: string;
}

interface DecisionDraft {
  title: string;
  basis: string;
  impact: string;
}

interface WorkbenchContextSnapshot {
  workspaceName: string;
  workspaceRootPath: string;
  activePaneId: string;
  paneCount: number;
  openTabCount: number;
  dirtyTabCount: number;
  dirtyTabPaths: string[];
  activeTabName: string;
  activeTabPath: string;
  activeTabKind: string;
}

interface RunSnapshotMeta {
  capturedAt: string;
  pagePath: string;
}

const STORAGE_KEY = "lattice-agent-protocol-state-v1";
const CHECK_STORAGE_KEY = "lattice-agent-protocol-checks-v1";
const TASK_CONTEXT_STORAGE_KEY = "lattice-agent-protocol-task-context-v1";
const RISK_DRAFT_STORAGE_KEY = "lattice-agent-protocol-risk-draft-v1";
const CLOSURE_GATE_STORAGE_KEY = "lattice-agent-protocol-closure-gates-v1";
const EVIDENCE_STORAGE_KEY = "lattice-agent-protocol-evidence-v1";
const DECISION_STORAGE_KEY = "lattice-agent-protocol-decisions-v1";
const CURRENT_VALIDATION_STORAGE_KEY = "lattice-agent-protocol-current-validation-recorded-v1";
const CURRENT_VALIDATION_RECORD_ID = "agent-protocol-desktop-build-20260603";

const STATUS_LABEL_KEYS: Record<ProtocolStatus, TranslationKey> = {
  pending: "agentProtocol.status.pending",
  in_progress: "agentProtocol.status.inProgress",
  completed: "agentProtocol.status.completed",
};
const DEFAULT_STATUS_LABELS: Record<ProtocolStatus, string> = {
  pending: "未开始",
  in_progress: "进行中",
  completed: "已完成",
};

const STATUS_ORDER: ProtocolStatus[] = ["pending", "in_progress", "completed"];
const WORKSPACE_TAB_LABEL_KEYS: Record<WorkspaceTab, { label: TranslationKey; description: TranslationKey }> = {
  execution: {
    label: "agentProtocol.tab.execution",
    description: "agentProtocol.tab.execution.description",
  },
  evidence: {
    label: "agentProtocol.tab.evidence",
    description: "agentProtocol.tab.evidence.description",
  },
  decisions: {
    label: "agentProtocol.tab.decisions",
    description: "agentProtocol.tab.decisions.description",
  },
  handoff: {
    label: "agentProtocol.tab.handoff",
    description: "agentProtocol.tab.handoff.description",
  },
};
const WORKSPACE_TAB_IDS: WorkspaceTab[] = ["execution", "evidence", "decisions", "handoff"];
const EVIDENCE_STATUS_LABEL_KEYS: Record<EvidenceStatus, TranslationKey> = {
  passed: "agentProtocol.evidenceStatus.passed",
  failed: "agentProtocol.evidenceStatus.failed",
  blocked: "agentProtocol.evidenceStatus.blocked",
};
const AGENT_PROTOCOL_COPY_KEYS = [
  "agentProtocol.main.eyebrow",
  "agentProtocol.main.title",
  "agentProtocol.main.description",
  "agentProtocol.main.recordValidation",
  "agentProtocol.main.copyProtocol",
  "agentProtocol.main.exportMarkdown",
  "agentProtocol.main.reset",
  "agentProtocol.tabs.aria",
  "agentProtocol.inbox.description",
  "agentProtocol.task.title",
  "agentProtocol.task.goal",
  "agentProtocol.task.goalPlaceholder",
  "agentProtocol.task.scope",
  "agentProtocol.task.scopePlaceholder",
  "agentProtocol.task.notes",
  "agentProtocol.task.notesPlaceholder",
  "agentProtocol.progress.stageProgress",
  "agentProtocol.progress.completedStages",
  "agentProtocol.progress.completedHint",
  "agentProtocol.progress.checkProgress",
  "agentProtocol.progress.currentFocus",
  "agentProtocol.progress.noActiveStage",
  "agentProtocol.progress.focusHint",
  "agentProtocol.closure.title",
  "agentProtocol.closure.description",
  "agentProtocol.closure.hasEvidence",
  "agentProtocol.closure.needsEvidence",
  "agentProtocol.evidence.title",
  "agentProtocol.evidence.description",
  "agentProtocol.evidence.templates",
  "agentProtocol.evidence.filter.all",
  "agentProtocol.evidence.name",
  "agentProtocol.evidence.namePlaceholder",
  "agentProtocol.evidence.status",
  "agentProtocol.evidence.command",
  "agentProtocol.evidence.commandPlaceholder",
  "agentProtocol.evidence.result",
  "agentProtocol.evidence.resultPlaceholder",
  "agentProtocol.evidence.cancelEdit",
  "agentProtocol.evidence.update",
  "agentProtocol.evidence.record",
  "agentProtocol.evidence.emptyCommand",
  "agentProtocol.evidence.emptyResult",
  "agentProtocol.evidence.viewSourceTraceTitle",
  "agentProtocol.evidence.emptyFilter",
  "agentProtocol.decision.title",
  "agentProtocol.decision.description",
  "agentProtocol.decision.titleField",
  "agentProtocol.decision.titlePlaceholder",
  "agentProtocol.decision.basis",
  "agentProtocol.decision.basisPlaceholder",
  "agentProtocol.decision.impact",
  "agentProtocol.decision.impactPlaceholder",
  "agentProtocol.decision.cancelEdit",
  "agentProtocol.decision.update",
  "agentProtocol.decision.save",
  "agentProtocol.decision.empty",
  "agentProtocol.report.title",
  "agentProtocol.report.completedStages",
  "agentProtocol.report.confirmedChecks",
  "agentProtocol.report.nextStep",
  "agentProtocol.report.allChecksDone",
  "agentProtocol.report.closureReady",
  "agentProtocol.handoff.title",
  "agentProtocol.handoff.copyAria",
  "agentProtocol.runSnapshot.title",
  "agentProtocol.runSnapshot.copyAria",
  "agentProtocol.workbench.title",
  "agentProtocol.workbench.copyAria",
  "agentProtocol.workbench.workspace",
  "agentProtocol.workbench.rootPath",
  "agentProtocol.workbench.activePane",
  "agentProtocol.workbench.activeTab",
  "agentProtocol.workbench.openTabs",
  "agentProtocol.workbench.dirtyTabs",
  "agentProtocol.risk.title",
  "agentProtocol.risk.copyAria",
  "agentProtocol.risk.operationType",
  "agentProtocol.risk.impactScope",
  "agentProtocol.risk.riskAssessment",
  "agentProtocol.protocolPreview.title",
  "agentProtocol.dangerGate.title",
  "agentProtocol.dangerGate.description",
  "agentProtocol.common.copy",
] as const satisfies readonly TranslationKey[];
type AgentProtocolCopyKey = (typeof AGENT_PROTOCOL_COPY_KEYS)[number];

const DEFAULT_TASK_CONTEXT: TaskContext = {
  goal: "",
  scope: "Lattice / Agent 协议中心",
  notes: "",
};

const DEFAULT_RISK_DRAFT: RiskDraft = {
  operationType: "代码提交 / 打包收尾",
  impactScope: "当前 Lattice 工作区",
  riskAssessment: "可能影响未提交改动、构建产物或桌面端发布包，需要用户明确确认后执行。",
};

const DEFAULT_EVIDENCE_DRAFT: EvidenceDraft = {
  label: "",
  command: "",
  result: "",
  status: "passed",
};

const DEFAULT_DECISION_DRAFT: DecisionDraft = {
  title: "",
  basis: "",
  impact: "",
};

const CURRENT_VALIDATION_TASK_CONTEXT: TaskContext = {
  goal: "完成 Agent Protocol Center 的真实工程落地与页面状态对齐",
  scope: "Lattice / Agent 协议中心 / Next dev-build 隔离 / 本地页面健康验证",
  notes: "已修复 /agent-protocol hydration mismatch；已修复 next dev 与 next build 共用 web-dist 导致的 500；已新增本地页面健康门禁和 Dev / Build 产物隔离回归模板；已完成 Tauri 桌面产品打包并生成 EXE、MSI、NSIS 安装器。",
};

const DEFAULT_RUN_SNAPSHOT_META: RunSnapshotMeta = {
  capturedAt: "等待客户端快照",
  pagePath: "/agent-protocol",
};

const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  passed: "通过",
  failed: "失败",
  blocked: "阻塞",
};

const CLOSURE_GATES: ClosureGate[] = [
  {
    id: "tests",
    title: "针对性测试通过",
    description: "新增或变更的交互路径已被 Vitest 覆盖。",
    evidenceKeywords: ["vitest", "test", "测试"],
  },
  {
    id: "typecheck",
    title: "类型检查通过",
    description: "TypeScript 检查无错误，未引入隐式类型风险。",
    evidenceKeywords: ["typecheck", "tsc", "类型"],
  },
  {
    id: "build",
    title: "生产构建通过",
    description: "Next 生产构建包含新增路由和页面。",
    evidenceKeywords: ["build", "next build", "构建"],
  },
  {
    id: "local-page-health",
    title: "本地页面健康",
    description: "本地开发页面返回 200，浏览器控制台无 hydration、500 或运行时错误。",
    evidenceKeywords: ["localhost", "200", "500", "hydration", "browser", "页面"],
  },
  {
    id: "desktop-package",
    title: "桌面产品打包更新",
    description: "收尾时更新桌面打包产物；部署和发布由用户自行执行。",
    evidenceKeywords: ["desktop", "tauri", "打包", "package"],
  },
  {
    id: "handoff",
    title: "交接说明完成",
    description: "明确本次改动、验证结果、剩余风险和用户后续动作。",
    evidenceKeywords: ["交接", "handoff", "summary"],
  },
];

const EVIDENCE_TEMPLATES: EvidenceTemplate[] = [
  {
    id: "agent-vitest",
    title: "Agent 协议中心组件测试",
    command: "npx vitest run \"src/components/agent/__tests__/agent-protocol-center.test.tsx\" \"src/components/ui/__tests__/plugin-command-dialog.test.tsx\" --maxWorkers=2",
    result: "记录 Agent 协议中心、命令面板入口和交互回归测试结果。",
    status: "passed",
  },
  {
    id: "typecheck",
    title: "类型检查",
    command: "npm run typecheck",
    result: "记录 TypeScript 类型检查结果。",
    status: "passed",
  },
  {
    id: "build",
    title: "生产构建",
    command: "npm run build",
    result: "记录 Next 生产构建结果，并确认 /agent-protocol 路由生成。",
    status: "passed",
  },
  {
    id: "browser-smoke",
    title: "浏览器 Smoke 回归",
    command: "Playwright: open /agent-protocol, switch tabs, record evidence and decision, inspect handoff.",
    result: "记录真实浏览器交互结果。",
    status: "passed",
  },
  {
    id: "dev-build-isolation",
    title: "Dev / Build 产物隔离回归",
    command: "npm run build && Invoke-WebRequest http://localhost:3000/agent-protocol",
    result: "记录生产构建后本地 dev 页面仍返回 200，避免 web-dist 与 dev 产物互相覆盖造成 500。",
    status: "passed",
  },
  {
    id: "desktop-package",
    title: "桌面产品打包更新",
    command: "npm run tauri build / desktop packaging checklist",
    result: "收尾阶段由用户确认后执行；当前先作为门禁待办记录。",
    status: "blocked",
  },
];

const PROTOCOL_STAGES: ProtocolStage[] = [
  {
    id: "todo-board",
    title: "Todo 状态板",
    description: "将任务拆成可追踪条目，并保证同一时间只有一个 in_progress。",
    checks: [
      "使用 update_plan 建立任务板",
      "每个子任务标注 pending / in_progress / completed",
      "推进任务时同步更新状态",
    ],
  },
  {
    id: "response-contract",
    title: "结构化协作回复",
    description: "每轮协作都明确当前状态、Todo 与下一步动作。",
    checks: [
      "输出 Status Update",
      "输出 Todo 列表",
      "输出 Next Steps 并说明工具调用原因",
    ],
  },
  {
    id: "risk-gate",
    title: "危险操作确认",
    description: "删除、提交、生产请求、系统配置等高风险动作必须先确认。",
    checks: [
      "识别文件系统、Git、数据库、生产 API、包管理风险",
      "按固定格式说明影响范围和风险",
      "等待明确的 是 / 确认 / 继续 后再执行",
    ],
  },
  {
    id: "tooling",
    title: "MCP 工具纪律",
    description: "复杂问题用 sequential-thinking，技术决策用 context7 查权威文档。",
    checks: [
      "复杂设计先做系统分析",
      "框架、库、API 决策查询官方文档",
      "结果基于事实和工具输出，不凭空猜测",
    ],
  },
  {
    id: "engineering-principles",
    title: "工程原则执行",
    description: "每次变更都落实 KISS、YAGNI、DRY、SOLID。",
    checks: [
      "选择最小可行实现",
      "避免未确认需求的过度设计",
      "只在真实收益明确时抽象复用",
    ],
  },
  {
    id: "verification",
    title: "验证与反馈",
    description: "改动完成后运行相关检查，并说明结果与残余风险。",
    checks: [
      "窄范围改动运行最小测试",
      "共享逻辑或用户流程扩大验证范围",
      "无法验证时明确原因和风险",
    ],
  },
];

function createDefaultState(): Record<string, ProtocolStatus> {
  return Object.fromEntries(PROTOCOL_STAGES.map((stage) => [stage.id, "pending"])) as Record<string, ProtocolStatus>;
}

function getCheckId(stageId: string, checkIndex: number): string {
  return `${stageId}:${checkIndex}`;
}

function createDefaultCheckState(): Record<string, boolean> {
  return Object.fromEntries(
    PROTOCOL_STAGES.flatMap((stage) =>
      stage.checks.map((_, checkIndex) => [getCheckId(stage.id, checkIndex), false]),
    ),
  ) as Record<string, boolean>;
}

function createDefaultClosureGateState(): Record<string, boolean> {
  return Object.fromEntries(CLOSURE_GATES.map((gate) => [gate.id, false])) as Record<string, boolean>;
}

function readProtocolState(): Record<string, ProtocolStatus> {
  if (typeof window === "undefined") {
    return createDefaultState();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultState();
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nextState = createDefaultState();
    PROTOCOL_STAGES.forEach((stage) => {
      const value = parsed[stage.id];
      if (value === "pending" || value === "in_progress" || value === "completed") {
        nextState[stage.id] = value;
      }
    });
    return nextState;
  } catch (error) {
    console.warn("Failed to read agent protocol state:", error);
    return createDefaultState();
  }
}

function readProtocolChecks(): Record<string, boolean> {
  if (typeof window === "undefined") {
    return createDefaultCheckState();
  }

  try {
    const raw = window.localStorage.getItem(CHECK_STORAGE_KEY);
    if (!raw) {
      return createDefaultCheckState();
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nextState = createDefaultCheckState();
    PROTOCOL_STAGES.forEach((stage) => {
      stage.checks.forEach((_, checkIndex) => {
        const checkId = getCheckId(stage.id, checkIndex);
        if (typeof parsed[checkId] === "boolean") {
          nextState[checkId] = parsed[checkId];
        }
      });
    });
    return nextState;
  } catch (error) {
    console.warn("Failed to read agent protocol checks:", error);
    return createDefaultCheckState();
  }
}

function readTaskContext(): TaskContext {
  if (typeof window === "undefined") {
    return DEFAULT_TASK_CONTEXT;
  }

  try {
    const raw = window.localStorage.getItem(TASK_CONTEXT_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_TASK_CONTEXT;
    }

    const parsed = JSON.parse(raw) as Partial<TaskContext>;
    return {
      goal: typeof parsed.goal === "string" ? parsed.goal : DEFAULT_TASK_CONTEXT.goal,
      scope: typeof parsed.scope === "string" ? parsed.scope : DEFAULT_TASK_CONTEXT.scope,
      notes: typeof parsed.notes === "string" ? parsed.notes : DEFAULT_TASK_CONTEXT.notes,
    };
  } catch (error) {
    console.warn("Failed to read agent task context:", error);
    return DEFAULT_TASK_CONTEXT;
  }
}

function readRiskDraft(): RiskDraft {
  if (typeof window === "undefined") {
    return DEFAULT_RISK_DRAFT;
  }

  try {
    const raw = window.localStorage.getItem(RISK_DRAFT_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_RISK_DRAFT;
    }

    const parsed = JSON.parse(raw) as Partial<RiskDraft>;
    return {
      operationType: typeof parsed.operationType === "string" ? parsed.operationType : DEFAULT_RISK_DRAFT.operationType,
      impactScope: typeof parsed.impactScope === "string" ? parsed.impactScope : DEFAULT_RISK_DRAFT.impactScope,
      riskAssessment: typeof parsed.riskAssessment === "string" ? parsed.riskAssessment : DEFAULT_RISK_DRAFT.riskAssessment,
    };
  } catch (error) {
    console.warn("Failed to read agent risk draft:", error);
    return DEFAULT_RISK_DRAFT;
  }
}

function readClosureGateState(): Record<string, boolean> {
  if (typeof window === "undefined") {
    return createDefaultClosureGateState();
  }

  try {
    const raw = window.localStorage.getItem(CLOSURE_GATE_STORAGE_KEY);
    if (!raw) {
      return createDefaultClosureGateState();
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nextState = createDefaultClosureGateState();
    CLOSURE_GATES.forEach((gate) => {
      const value = parsed[gate.id];
      if (typeof value === "boolean") {
        nextState[gate.id] = value;
      }
    });
    return nextState;
  } catch (error) {
    console.warn("Failed to read agent closure gates:", error);
    return createDefaultClosureGateState();
  }
}

function readEvidenceEntries(): EvidenceEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(EVIDENCE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry): EvidenceEntry[] => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const status = record.status;
      if (status !== "passed" && status !== "failed" && status !== "blocked") {
        return [];
      }
      return [{
        id: typeof record.id === "string" ? record.id : crypto.randomUUID(),
        label: typeof record.label === "string" ? record.label : "",
        command: typeof record.command === "string" ? record.command : "",
        result: typeof record.result === "string" ? record.result : "",
        status,
        importedKey: typeof record.importedKey === "string" ? record.importedKey : undefined,
        sourceKind: record.sourceKind === "coding-qa" ? "coding-qa" : undefined,
        sourceSessionId: typeof record.sourceSessionId === "string" ? record.sourceSessionId : undefined,
        sourceApprovalId: typeof record.sourceApprovalId === "string" ? record.sourceApprovalId : undefined,
      }];
    });
  } catch (error) {
    console.warn("Failed to read agent evidence entries:", error);
    return [];
  }
}

function readDecisionRecords(): DecisionRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(DECISION_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry): DecisionRecord[] => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const record = entry as Record<string, unknown>;
      return [{
        id: typeof record.id === "string" ? record.id : crypto.randomUUID(),
        title: typeof record.title === "string" ? record.title : "",
        basis: typeof record.basis === "string" ? record.basis : "",
        impact: typeof record.impact === "string" ? record.impact : "",
      }];
    });
  } catch (error) {
    console.warn("Failed to read agent decision records:", error);
    return [];
  }
}

function buildRiskConfirmationText(draft: RiskDraft): string {
  return [
    "⚠️ 危险操作检测！",
    `操作类型：${draft.operationType || "[具体操作]"}`,
    `影响范围：${draft.impactScope || "[详细说明]"}`,
    `风险评估：${draft.riskAssessment || "[潜在后果]"}`,
    "",
    "请确认是否继续？[需要明确的\"是\"、\"确认\"、\"继续\"]",
  ].join("\n");
}

function buildRunSnapshotText({
  taskContext,
  completedCount,
  completedCheckCount,
  totalCheckCount,
  completedClosureGateCount,
  evidenceCount,
  decisionCount,
  activeStageTitle,
  workbenchContextText,
  coworkInboxMarkdown,
  codingQaRunnerMarkdown,
  capturedAt,
  pagePath,
}: {
  taskContext: TaskContext;
  completedCount: number;
  completedCheckCount: number;
  totalCheckCount: number;
  completedClosureGateCount: number;
  evidenceCount: number;
  decisionCount: number;
  activeStageTitle: string;
  workbenchContextText: string;
  coworkInboxMarkdown: string;
  codingQaRunnerMarkdown: string;
  capturedAt: string;
  pagePath: string;
}): string {
  return [
    `快照时间：${capturedAt}`,
    `页面路径：${pagePath}`,
    `当前目标：${taskContext.goal || "未填写目标"}`,
    `影响范围：${taskContext.scope || "未填写范围"}`,
    `当前焦点：${activeStageTitle}`,
    `阶段完成：${completedCount} / ${PROTOCOL_STAGES.length}`,
    `检查项确认：${completedCheckCount} / ${totalCheckCount}`,
    `收尾门禁：${completedClosureGateCount} / ${CLOSURE_GATES.length}`,
    `验证证据：${evidenceCount} 条`,
    `决策记录：${decisionCount} 条`,
    "",
    "工作台上下文：",
    workbenchContextText,
    "",
    "Co-work Session Inbox:",
    coworkInboxMarkdown,
    "",
    "Coding QA Runner:",
    codingQaRunnerMarkdown,
  ].join("\n");
}

function evidenceMatchesGate(entry: EvidenceEntry, gate: ClosureGate): boolean {
  const haystack = `${entry.label} ${entry.command} ${entry.result}`.toLowerCase();
  return gate.evidenceKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function collectTabs(root: LayoutNode): TabState[] {
  if (root.type === "pane") {
    return root.tabs;
  }
  return root.children.flatMap((child) => collectTabs(child));
}

function getTabKindLabel(tab: TabState | null): string {
  if (!tab) {
    return "无";
  }
  return tab.kind === "web" ? "网页" : "文件";
}

function buildWorkbenchContextText(context: WorkbenchContextSnapshot): string {
  return [
    `工作区：${context.workspaceName}`,
    `根路径：${context.workspaceRootPath}`,
    `活动 Pane：${context.activePaneId}`,
    `Pane 数量：${context.paneCount}`,
    `打开标签：${context.openTabCount}`,
    `未保存标签：${context.dirtyTabCount}`,
    `活动标签：${context.activeTabName}`,
    `活动路径：${context.activeTabPath}`,
    `活动类型：${context.activeTabKind}`,
  ].join("\n");
}

function buildProtocolMarkdown(
  state: Record<string, ProtocolStatus>,
  checkState: Record<string, boolean>,
  taskContext: TaskContext,
  riskDraft: RiskDraft,
  closureGateState: Record<string, boolean>,
  evidenceEntries: EvidenceEntry[],
  decisionRecords: DecisionRecord[],
  handoffSummary: string,
  runSnapshot: string,
  workbenchContextText: string,
): string {
  const lines = [
    "# Lattice Agent Protocol",
    "",
    "## 任务上下文",
    "",
    `- 目标：${taskContext.goal || "未填写"}`,
    `- 范围：${taskContext.scope || "未填写"}`,
    `- 备注：${taskContext.notes || "无"}`,
    "",
    "## 运行快照",
    "",
    runSnapshot,
    "",
    "## 工作台上下文",
    "",
    workbenchContextText,
    "",
    "## 执行规则",
    "",
    "- 始终使用中文简体。",
    "- 使用 update_plan 管理 Todo 状态。",
    "- 每轮回复包含 Status Update、Todo、Next Steps。",
    "- 危险操作必须先获得明确确认。",
    "- 复杂问题使用 sequential-thinking。",
    "- 技术决策优先使用 context7 查询权威文档。",
    "- 代码变更遵循 KISS、YAGNI、DRY、SOLID。",
    "- 用户未主动要求时，不主动执行 Git 提交、推送、分支操作。",
    "",
    "## 当前执行状态",
    "",
  ];

  PROTOCOL_STAGES.forEach((stage, index) => {
    lines.push(`${index + 1}. ${stage.title} - ${DEFAULT_STATUS_LABELS[state[stage.id] ?? "pending"]}`);
    lines.push(`   - ${stage.description}`);
    stage.checks.forEach((check, checkIndex) => {
      const marker = checkState[getCheckId(stage.id, checkIndex)] ? "x" : " ";
      lines.push(`   - [${marker}] ${check}`);
    });
    lines.push("");
  });

  lines.push("## 危险操作确认草案");
  lines.push("");
  lines.push("```text");
  lines.push(buildRiskConfirmationText(riskDraft));
  lines.push("```");
  lines.push("");
  lines.push("## 收尾门禁");
  lines.push("");
  CLOSURE_GATES.forEach((gate) => {
    const marker = closureGateState[gate.id] ? "x" : " ";
    lines.push(`- [${marker}] ${gate.title}：${gate.description}`);
  });
  lines.push("");
  lines.push("## 验证证据");
  lines.push("");
  if (evidenceEntries.length === 0) {
    lines.push("- 暂无验证证据。");
  } else {
    evidenceEntries.forEach((entry) => {
      lines.push(`- ${entry.label || "未命名证据"}（${EVIDENCE_STATUS_LABELS[entry.status]}）`);
      lines.push(`  - 命令：${entry.command || "未填写"}`);
      lines.push(`  - 结果：${entry.result || "未填写"}`);
    });
  }
  lines.push("");
  lines.push("## 决策记录");
  lines.push("");
  if (decisionRecords.length === 0) {
    lines.push("- 暂无决策记录。");
  } else {
    decisionRecords.forEach((record) => {
      lines.push(`- ${record.title || "未命名决策"}`);
      lines.push(`  - 依据：${record.basis || "未填写"}`);
      lines.push(`  - 影响：${record.impact || "未填写"}`);
    });
  }
  lines.push("");
  lines.push("## 交接摘要");
  lines.push("");
  lines.push(handoffSummary);
  lines.push("");

  return lines.join("\n");
}

function getStatusClassName(status: ProtocolStatus): string {
  if (status === "completed") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "in_progress") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-border bg-background text-muted-foreground";
}

function getInboxItemClassName(kind: AgentCoworkInboxItemKind): string {
  switch (kind) {
    case "needs_approval":
      return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200";
    case "blocked":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "running":
      return "border-primary/30 bg-primary/10 text-primary";
    case "handoff":
      return "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function inboxKindLabel(kind: AgentCoworkInboxItemKind, translate: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  switch (kind) {
    case "needs_approval":
      return translate("agentProtocol.inbox.kind.needsApproval");
    case "blocked":
      return translate("agentProtocol.inbox.kind.blocked");
    case "running":
      return translate("agentProtocol.inbox.kind.running");
    case "handoff":
      return translate("agentProtocol.inbox.kind.handoff");
    case "completed":
      return translate("agentProtocol.inbox.kind.completed");
  }
}

function AgentCoworkInbox({
  summary,
  nextAction,
  items,
  pendingApprovalCount,
  blockedCount,
  runningCount,
  handoffCount,
  totalSessionCount,
  workspaceRisk,
  onFocusSession,
}: {
  summary: string;
  nextAction: string;
  items: AgentCoworkInboxItem[];
  pendingApprovalCount: number;
  blockedCount: number;
  runningCount: number;
  handoffCount: number;
  totalSessionCount: number;
  workspaceRisk: AgentCoworkInboxWorkspaceRisk;
  onFocusSession: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const hasWorkspaceRisk = workspaceRisk.level !== "clean";

  return (
    <section className="rounded-lg border border-border bg-card p-4" data-testid="agent-cowork-inbox">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="h-4 w-4" />
            {t("agentProtocol.inbox.title")}
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t("agentProtocol.inbox.description")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded-md border border-border bg-background px-2 py-1">{summary || "0 sessions"}</span>
            <span className="rounded-md border border-border bg-background px-2 py-1">
              {t("agentProtocol.inbox.next", { nextAction })}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-muted-foreground">{t("agentProtocol.inbox.approvals")}</div>
            <div className="mt-1 text-base font-semibold">{pendingApprovalCount}</div>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-muted-foreground">{t("agentProtocol.inbox.blocked")}</div>
            <div className="mt-1 text-base font-semibold">{blockedCount}</div>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-muted-foreground">{t("agentProtocol.inbox.running")}</div>
            <div className="mt-1 text-base font-semibold">{runningCount}</div>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-muted-foreground">{t("agentProtocol.inbox.handoff")}</div>
            <div className="mt-1 text-base font-semibold">{handoffCount}</div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mt-4 rounded-md border p-3 text-sm",
          hasWorkspaceRisk
            ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100"
            : "border-emerald-500/25 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
        )}
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-medium">{t("agentProtocol.inbox.workspaceRisk", { level: workspaceRisk.level })}</div>
          <div className="text-xs opacity-80">{workspaceRisk.summary}</div>
        </div>
        {workspaceRisk.detail ? (
          <div className="mt-1 text-xs opacity-85">{workspaceRisk.detail}</div>
        ) : null}
      </div>

      {items.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                "rounded-md border p-3",
                getInboxItemClassName(item.kind),
                item.isActiveSession && "ring-1 ring-primary/40",
              )}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-background/70 px-2 py-0.5 text-[10px] font-medium">
                      {inboxKindLabel(item.kind, t)}
                    </span>
                    {item.isActiveSession ? (
                      <span className="rounded bg-background/70 px-2 py-0.5 text-[10px]">active</span>
                    ) : null}
                    <span className="truncate font-medium text-foreground">{item.title}</span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{item.summary}</div>
                  {item.detail ? (
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground/90">{item.detail}</div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    <span>{item.status}</span>
                    <span>{item.pendingApprovalCount} approvals</span>
                    <span>{item.evidenceCount} evidence</span>
                    <span>{item.traceCount} trace events</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onFocusSession(item.sessionId)}
                  className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  {t("agentProtocol.inbox.viewTrace")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
          {t("agentProtocol.inbox.empty")}
        </p>
      )}
      {totalSessionCount > items.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("agentProtocol.inbox.limitNotice", { visible: items.length, total: totalSessionCount })}
        </p>
      ) : null}
    </section>
  );
}

function CodingQaRunnerPanel({
  view,
  evidenceCandidates,
  importedEvidenceKeys,
  onCopyPlan,
  onPrepareEvidenceDraft,
  onCreateApprovalRequest,
  onImportEvidence,
}: {
  view: CodingQaRunnerViewModel;
  evidenceCandidates: CodingQaEvidenceCandidate[];
  importedEvidenceKeys: Set<string>;
  onCopyPlan: () => void;
  onPrepareEvidenceDraft: () => void;
  onCreateApprovalRequest: () => void;
  onImportEvidence: (candidate: CodingQaEvidenceCandidate) => void;
}) {
  const { t } = useI18n();
  const sections = [
    { title: "Allowed", items: view.plan.allowed },
    { title: "Suggested", items: view.plan.suggested },
    { title: "Rejected", items: view.plan.rejected },
  ];
  const pendingImportCount = evidenceCandidates.filter((candidate) =>
    !importedEvidenceKeys.has(candidate.importedKey)
  ).length;

  return (
    <section className="rounded-lg border border-border bg-card p-4" data-testid="coding-qa-runner">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4" />
            Approval-gated QA Runner
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Reviewable validation plan only. Commands require explicit user approval and are not executed by this panel.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded-md border border-border bg-background px-2 py-1">
              {t("agentProtocol.qa.status", { status: view.status })}
            </span>
            <span className="rounded-md border border-border bg-background px-2 py-1">{view.summary}</span>
            <span className={cn(
              "rounded-md border px-2 py-1",
              pendingImportCount > 0
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-border bg-background",
            )}>
              {t("agentProtocol.qa.pendingImports", { count: pendingImportCount })}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onPrepareEvidenceDraft}
            className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent"
          >
            {t("agentProtocol.qa.fillEvidenceDraft")}
          </button>
          <button
            type="button"
            onClick={onCopyPlan}
            className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("agentProtocol.qa.copyPlan")}
          </button>
          <button
            type="button"
            onClick={onCreateApprovalRequest}
            className="inline-flex h-8 items-center justify-center rounded-md border border-primary bg-primary/10 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          >
            {t("agentProtocol.qa.createApprovalRequest")}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {sections.map((section) => (
          <div key={section.title} className="rounded-md border border-border bg-background p-3">
            <div className="text-xs font-semibold text-muted-foreground">{section.title}</div>
            {section.items.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {section.items.map((item) => (
                  <li key={`${section.title}-${item.command}`} className="rounded-md border border-border bg-card p-2">
                    <div className="break-words font-mono text-[11px] text-foreground">{item.command}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t("agentProtocol.qa.approvalLabel", { approval: item.approval })}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.reason}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-amber-700 dark:text-amber-300">{item.risk}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{t("agentProtocol.qa.noCommands")}</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
        {t("agentProtocol.qa.executionBoundary")}
      </div>

      <div id="qa-evidence" className="mt-4 scroll-mt-24 rounded-md border border-border bg-background p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-muted-foreground">{t("agentProtocol.qa.approvalEvidence")}</div>
          <div className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
            {t("agentProtocol.qa.pendingImports", { count: pendingImportCount })}
          </div>
        </div>
        {evidenceCandidates.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {evidenceCandidates.map((candidate) => {
              const imported = importedEvidenceKeys.has(candidate.importedKey);
              return (
                <li key={candidate.id} className="flex flex-col gap-2 rounded-md border border-border bg-card p-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground">{candidate.label}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{candidate.result}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t("agentProtocol.qa.status", { status: candidate.status })}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={imported}
                    onClick={() => onImportEvidence(candidate)}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {imported ? t("agentProtocol.qa.imported") : t("agentProtocol.qa.importEvidence")}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("agentProtocol.qa.emptyApprovals")}
          </p>
        )}
      </div>
    </section>
  );
}

export function AgentProtocolCenter() {
  const { t, formatDate } = useI18n();
  const [protocolState, setProtocolState] = useState<Record<string, ProtocolStatus>>(() => createDefaultState());
  const [checkState, setCheckState] = useState<Record<string, boolean>>(() => createDefaultCheckState());
  const [taskContext, setTaskContext] = useState<TaskContext>(() => DEFAULT_TASK_CONTEXT);
  const [riskDraft, setRiskDraft] = useState<RiskDraft>(() => DEFAULT_RISK_DRAFT);
  const [closureGateState, setClosureGateState] = useState<Record<string, boolean>>(() => createDefaultClosureGateState());
  const [evidenceEntries, setEvidenceEntries] = useState<EvidenceEntry[]>([]);
  const [evidenceDraft, setEvidenceDraft] = useState<EvidenceDraft>(() => DEFAULT_EVIDENCE_DRAFT);
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>("all");
  const [decisionRecords, setDecisionRecords] = useState<DecisionRecord[]>([]);
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft>(() => DEFAULT_DECISION_DRAFT);
  const [editingDecisionId, setEditingDecisionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("execution");
  const [runSnapshotMeta, setRunSnapshotMeta] = useState<RunSnapshotMeta>(() => DEFAULT_RUN_SNAPSHOT_META);
  const [mounted, setMounted] = useState(false);
  const rootHandleName = useWorkspaceStore((state) => state.rootHandle?.name ?? null);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const layout = useWorkspaceStore((state) => state.layout);
  const agentSessions = useAgentSessionStore((state) => state.sessions);
  const activeAgentSessionId = useAgentSessionStore((state) => state.activeSessionId);
  const focusSession = useAgentSessionStore((state) => state.focusSession);
  const createAgentSessionFromProtocol = useAgentSessionStore((state) => state.createSession);
  const appendAgentTraceFromProtocol = useAgentSessionStore((state) => state.appendTrace);
  const addAgentPendingApprovalFromProtocol = useAgentSessionStore((state) => state.addPendingApproval);
  const copy = useMemo(
    () => Object.fromEntries(AGENT_PROTOCOL_COPY_KEYS.map((key) => [key, t(key)])) as Record<AgentProtocolCopyKey, string>,
    [t],
  );
  const statusLabels = useMemo(
    () => Object.fromEntries(
      STATUS_ORDER.map((status) => [status, t(STATUS_LABEL_KEYS[status])]),
    ) as Record<ProtocolStatus, string>,
    [t],
  );
  const evidenceStatusLabels = useMemo(
    () => Object.fromEntries(
      (["passed", "failed", "blocked"] as EvidenceStatus[]).map((status) => [status, t(EVIDENCE_STATUS_LABEL_KEYS[status])]),
    ) as Record<EvidenceStatus, string>,
    [t],
  );
  const workspaceTabs = useMemo(
    () => WORKSPACE_TAB_IDS.map((id) => ({
      id,
      label: t(WORKSPACE_TAB_LABEL_KEYS[id].label),
      description: t(WORKSPACE_TAB_LABEL_KEYS[id].description),
    })),
    [t],
  );

  useEffect(() => {
    // Restore client-only persisted state after mount to avoid SSR hydration drift.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProtocolState(readProtocolState());
    setCheckState(readProtocolChecks());
    setTaskContext(readTaskContext());
    setRiskDraft(readRiskDraft());
    setClosureGateState(readClosureGateState());
    setEvidenceEntries(readEvidenceEntries());
    setDecisionRecords(readDecisionRecords());
    setRunSnapshotMeta({
      capturedAt: formatDate(new Date(), { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      pagePath: window.location.pathname,
    });
    setMounted(true);
  }, [formatDate]);

  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#qa-evidence") {
      return;
    }
    window.requestAnimationFrame(() => {
      document.getElementById("qa-evidence")?.scrollIntoView({ block: "start" });
    });
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(protocolState));
  }, [mounted, protocolState]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    window.localStorage.setItem(CHECK_STORAGE_KEY, JSON.stringify(checkState));
  }, [checkState, mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    window.localStorage.setItem(TASK_CONTEXT_STORAGE_KEY, JSON.stringify(taskContext));
  }, [mounted, taskContext]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    window.localStorage.setItem(RISK_DRAFT_STORAGE_KEY, JSON.stringify(riskDraft));
  }, [mounted, riskDraft]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    window.localStorage.setItem(CLOSURE_GATE_STORAGE_KEY, JSON.stringify(closureGateState));
  }, [closureGateState, mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    window.localStorage.setItem(EVIDENCE_STORAGE_KEY, JSON.stringify(evidenceEntries));
  }, [evidenceEntries, mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    window.localStorage.setItem(DECISION_STORAGE_KEY, JSON.stringify(decisionRecords));
  }, [decisionRecords, mounted]);

  const completedCount = useMemo(
    () => PROTOCOL_STAGES.filter((stage) => protocolState[stage.id] === "completed").length,
    [protocolState],
  );
  const activeStage = useMemo(
    () => PROTOCOL_STAGES.find((stage) => protocolState[stage.id] === "in_progress") ?? null,
    [protocolState],
  );
  const totalCheckCount = useMemo(
    () => PROTOCOL_STAGES.reduce((total, stage) => total + stage.checks.length, 0),
    [],
  );
  const completedCheckCount = useMemo(
    () => Object.values(checkState).filter(Boolean).length,
    [checkState],
  );
  const completedClosureGateCount = useMemo(
    () => CLOSURE_GATES.filter((gate) => closureGateState[gate.id]).length,
    [closureGateState],
  );
  const activePane = useMemo(
    () => findPane(layout.root, layout.activePaneId),
    [layout.activePaneId, layout.root],
  );
  const activeWorkbenchTab = activePane && activePane.activeTabIndex >= 0
    ? activePane.tabs[activePane.activeTabIndex] ?? null
    : null;
  const workbenchContext = useMemo<WorkbenchContextSnapshot>(() => {
    const tabs = collectTabs(layout.root);
    return {
      workspaceName: rootHandleName ?? "未打开工作区",
      workspaceRootPath: workspaceRootPath ?? "未设置",
      activePaneId: layout.activePaneId,
      paneCount: getAllPaneIds(layout.root).length,
      openTabCount: tabs.length,
      dirtyTabCount: tabs.filter((tab) => tab.isDirty).length,
      dirtyTabPaths: tabs.filter((tab) => tab.isDirty).map((tab) => tab.filePath),
      activeTabName: activeWorkbenchTab?.fileName ?? "无活动标签",
      activeTabPath: activeWorkbenchTab?.filePath ?? "无",
      activeTabKind: getTabKindLabel(activeWorkbenchTab),
    };
  }, [activeWorkbenchTab, layout.activePaneId, layout.root, rootHandleName, workspaceRootPath]);
  const workbenchContextText = useMemo(
    () => buildWorkbenchContextText(workbenchContext),
    [workbenchContext],
  );
  const coworkInbox = useMemo(
    () => buildAgentCoworkInboxViewModel(agentSessions, activeAgentSessionId, {
      limit: 6,
      workspace: {
        openTabCount: workbenchContext.openTabCount,
        dirtyTabCount: workbenchContext.dirtyTabCount,
        dirtyPaths: workbenchContext.dirtyTabPaths,
        activeTabName: workbenchContext.activeTabName,
        activeTabPath: workbenchContext.activeTabPath,
      },
    }),
    [activeAgentSessionId, agentSessions, workbenchContext],
  );

  const focusInboxSession = useCallback((sessionId: string) => {
    focusAgentSession({ focusSession }, sessionId, "trace");
  }, [focusSession]);

  const coworkInboxMarkdown = useMemo(
    () => formatAgentCoworkInboxMarkdown(coworkInbox),
    [coworkInbox],
  );
  const codingQaRunner = useMemo(
    () => buildCodingQaRunnerViewModel({
      activeTabPath: workbenchContext.activeTabPath,
      dirtyTabPaths: workbenchContext.dirtyTabPaths,
      agentSessions,
    }),
    [agentSessions, workbenchContext],
  );
  const codingQaEvidenceCandidates = useMemo(
    () => buildCodingQaEvidenceCandidates(agentSessions),
    [agentSessions],
  );
  const importedEvidenceKeys = useMemo(
    () => new Set(evidenceEntries.map((entry) => entry.importedKey).filter((key): key is string => Boolean(key))),
    [evidenceEntries],
  );
  const filteredEvidenceEntries = useMemo(
    () => evidenceFilter === "all"
      ? evidenceEntries
      : evidenceEntries.filter((entry) => entry.status === evidenceFilter),
    [evidenceEntries, evidenceFilter],
  );
  const progressPercent = Math.round((completedCount / PROTOCOL_STAGES.length) * 100);
  const checkProgressPercent = totalCheckCount === 0
    ? 0
    : Math.round((completedCheckCount / totalCheckCount) * 100);
  const nextOpenCheck = (() => {
    for (const stage of PROTOCOL_STAGES) {
      const openCheckIndex = stage.checks.findIndex((_, checkIndex) => !checkState[getCheckId(stage.id, checkIndex)]);
      if (openCheckIndex >= 0) {
        return {
          stageTitle: stage.title,
          check: stage.checks[openCheckIndex],
        };
      }
    }
    return null;
  })();
  const closureReady = completedClosureGateCount === CLOSURE_GATES.length;
  const passedEvidenceEntries = useMemo(
    () => evidenceEntries.filter((entry) => entry.status === "passed"),
    [evidenceEntries],
  );
  const gateEvidenceState = useMemo(
    () => Object.fromEntries(
      CLOSURE_GATES.map((gate) => [
        gate.id,
        passedEvidenceEntries.some((entry) => evidenceMatchesGate(entry, gate)),
      ]),
    ) as Record<string, boolean>,
    [passedEvidenceEntries],
  );
  const riskConfirmationText = useMemo(() => buildRiskConfirmationText(riskDraft), [riskDraft]);
  const runSnapshot = useMemo(
    () => buildRunSnapshotText({
      taskContext,
      completedCount,
      completedCheckCount,
      totalCheckCount,
      completedClosureGateCount,
      evidenceCount: evidenceEntries.length,
      decisionCount: decisionRecords.length,
      activeStageTitle: activeStage?.title ?? "暂无进行中阶段",
      workbenchContextText,
      coworkInboxMarkdown,
      codingQaRunnerMarkdown: codingQaRunner.markdown,
      capturedAt: runSnapshotMeta.capturedAt,
      pagePath: runSnapshotMeta.pagePath,
    }),
    [
      activeStage?.title,
      codingQaRunner.markdown,
      completedCheckCount,
      completedClosureGateCount,
      completedCount,
      coworkInboxMarkdown,
      decisionRecords.length,
      evidenceEntries.length,
      runSnapshotMeta.capturedAt,
      runSnapshotMeta.pagePath,
      taskContext,
      totalCheckCount,
      workbenchContextText,
    ],
  );
  const handoffSummary = useMemo(() => {
    const goal = taskContext.goal || "未填写目标";
    const nextAction = nextOpenCheck
      ? `${nextOpenCheck.stageTitle}：${nextOpenCheck.check}`
      : "协议检查项已全部确认。";
    return [
      `当前目标：${goal}`,
      `范围：${taskContext.scope || "未填写范围"}`,
      `阶段完成：${completedCount} / ${PROTOCOL_STAGES.length}`,
      `检查项确认：${completedCheckCount} / ${totalCheckCount}`,
      `收尾门禁：${completedClosureGateCount} / ${CLOSURE_GATES.length}`,
      `验证证据：${evidenceEntries.length} 条`,
      `决策记录：${decisionRecords.length} 条`,
      `下一步：${nextAction}`,
      taskContext.notes ? `备注：${taskContext.notes}` : "备注：无",
      "",
      "运行快照：",
      runSnapshot,
    ].join("\n");
  }, [
    completedCheckCount,
    completedClosureGateCount,
    completedCount,
    decisionRecords.length,
    evidenceEntries.length,
    nextOpenCheck,
    runSnapshot,
    taskContext.goal,
    taskContext.notes,
    taskContext.scope,
    totalCheckCount,
  ]);
  const protocolMarkdown = useMemo(
    () => buildProtocolMarkdown(
      protocolState,
      checkState,
      taskContext,
      riskDraft,
      closureGateState,
      evidenceEntries,
      decisionRecords,
      handoffSummary,
      runSnapshot,
      workbenchContextText,
    ),
    [checkState, closureGateState, decisionRecords, evidenceEntries, handoffSummary, protocolState, riskDraft, runSnapshot, taskContext, workbenchContextText],
  );

  const setStageStatus = useCallback((stageId: string, status: ProtocolStatus) => {
    setProtocolState((current) => {
      const next = { ...current };
      if (status === "in_progress") {
        PROTOCOL_STAGES.forEach((stage) => {
          if (next[stage.id] === "in_progress") {
            next[stage.id] = "pending";
          }
        });
      }
      next[stageId] = status;
      return next;
    });
  }, []);

  const toggleCheck = useCallback((stageId: string, checkIndex: number) => {
    const checkId = getCheckId(stageId, checkIndex);
    setCheckState((current) => ({
      ...current,
      [checkId]: !current[checkId],
    }));
  }, []);

  const toggleClosureGate = useCallback((gateId: string) => {
    setClosureGateState((current) => ({
      ...current,
      [gateId]: !current[gateId],
    }));
  }, []);

  const updateTaskContext = useCallback((key: keyof TaskContext, value: string) => {
    setTaskContext((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const updateRiskDraft = useCallback((key: keyof RiskDraft, value: string) => {
    setRiskDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const updateEvidenceDraft = useCallback((key: keyof EvidenceDraft, value: string) => {
    setEvidenceDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const updateEvidenceStatus = useCallback((status: EvidenceStatus) => {
    setEvidenceDraft((current) => ({
      ...current,
      status,
    }));
  }, []);

  const updateDecisionDraft = useCallback((key: keyof DecisionDraft, value: string) => {
    setDecisionDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const applyEvidenceTemplate = useCallback((template: EvidenceTemplate) => {
    setEvidenceDraft({
      label: template.title,
      command: template.command,
      result: template.result,
      status: template.status,
    });
    setEditingEvidenceId(null);
    setEvidenceFilter("all");
    setActiveTab("evidence");
    toast.success(t("agentProtocol.toast.templateFilled"));
  }, [t]);

  const copyCodingQaPlan = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codingQaRunner.markdown);
      toast.success(t("agentProtocol.toast.qaPlanCopied"));
    } catch (error) {
      console.error("Failed to copy coding QA plan:", error);
      toast.error(t("agentProtocol.toast.copyFailed"));
    }
  }, [codingQaRunner.markdown, t]);

  const prepareCodingQaEvidenceDraft = useCallback(() => {
    const commands = [...codingQaRunner.plan.allowed, ...codingQaRunner.plan.suggested]
      .map((item) => item.command)
      .join("\n");
    setEvidenceDraft({
      label: "Coding QA Runner plan",
      command: commands || "No approval-gated QA commands inferred.",
      result: codingQaRunner.summary,
      status: codingQaRunner.status === "blocked" ? "blocked" : "passed",
    });
    setEditingEvidenceId(null);
    setEvidenceFilter("all");
    setActiveTab("evidence");
    toast.success(t("agentProtocol.toast.qaDraftFilled"));
  }, [codingQaRunner, t]);

  const createCodingQaApprovalRequest = useCallback(() => {
    const request = buildCodingQaRunnerApprovalRequest(codingQaRunner);
    const sessionId = createAgentSessionFromProtocol({
      profile: "research",
      title: request.sessionTitle,
      task: request.sessionTask,
    });
    appendAgentTraceFromProtocol(sessionId, request.trace);
    addAgentPendingApprovalFromProtocol(sessionId, request.approval);
    focusAgentSession({ focusSession }, sessionId, "trace");
    toast.success(t("agentProtocol.toast.qaApprovalCreated"));
  }, [
    addAgentPendingApprovalFromProtocol,
    appendAgentTraceFromProtocol,
    codingQaRunner,
    createAgentSessionFromProtocol,
    focusSession,
    t,
  ]);

  const importCodingQaEvidence = useCallback((candidate: CodingQaEvidenceCandidate) => {
    setEvidenceEntries((current) => {
      if (current.some((entry) => entry.importedKey === candidate.importedKey)) {
        return current;
      }
      return [...current, {
        id: `evidence-${candidate.importedKey}`,
        label: candidate.label,
        command: candidate.command,
        result: candidate.result,
        status: candidate.status,
        importedKey: candidate.importedKey,
        sourceKind: "coding-qa",
        sourceSessionId: candidate.sessionId,
        sourceApprovalId: candidate.approvalId,
      }];
    });
    setEvidenceFilter("all");
    setActiveTab("evidence");
    toast.success(t("agentProtocol.toast.qaEvidenceImported"));
  }, [t]);

  const focusEvidenceSourceTrace = useCallback((entry: EvidenceEntry) => {
    if (!entry.sourceSessionId) {
      return;
    }
    focusAgentSession({ focusSession }, entry.sourceSessionId, "trace");
    toast.success(t("agentProtocol.toast.focusedTrace"));
  }, [focusSession, t]);

  const addEvidenceEntry = useCallback(() => {
    if (!evidenceDraft.label.trim() && !evidenceDraft.command.trim() && !evidenceDraft.result.trim()) {
      toast.error(t("agentProtocol.toast.fillEvidence"));
      return;
    }
    const nextEntry = {
      id: editingEvidenceId ?? crypto.randomUUID(),
      label: evidenceDraft.label.trim() || t("agentProtocol.evidence.name"),
      command: evidenceDraft.command.trim(),
      result: evidenceDraft.result.trim(),
      status: evidenceDraft.status,
    };
    setEvidenceEntries((current) => editingEvidenceId
      ? current.map((entry) => entry.id === editingEvidenceId ? nextEntry : entry)
      : [...current, nextEntry],
    );
    setEvidenceDraft(DEFAULT_EVIDENCE_DRAFT);
    setEditingEvidenceId(null);
    toast.success(editingEvidenceId ? t("agentProtocol.toast.evidenceUpdated") : t("agentProtocol.toast.evidenceRecorded"));
  }, [editingEvidenceId, evidenceDraft, t]);

  const editEvidenceEntry = useCallback((entry: EvidenceEntry) => {
    setEvidenceDraft({
      label: entry.label,
      command: entry.command,
      result: entry.result,
      status: entry.status,
    });
    setEditingEvidenceId(entry.id);
    setActiveTab("evidence");
  }, []);

  const cancelEvidenceEdit = useCallback(() => {
    setEvidenceDraft(DEFAULT_EVIDENCE_DRAFT);
    setEditingEvidenceId(null);
  }, []);

  const removeEvidenceEntry = useCallback((entryId: string) => {
    setEvidenceEntries((current) => current.filter((entry) => entry.id !== entryId));
    setEditingEvidenceId((current) => current === entryId ? null : current);
  }, []);

  const addDecisionRecord = useCallback(() => {
    if (!decisionDraft.title.trim() && !decisionDraft.basis.trim() && !decisionDraft.impact.trim()) {
      toast.error(t("agentProtocol.toast.fillDecision"));
      return;
    }
    const nextRecord = {
      id: editingDecisionId ?? crypto.randomUUID(),
      title: decisionDraft.title.trim() || t("agentProtocol.decision.title"),
      basis: decisionDraft.basis.trim(),
      impact: decisionDraft.impact.trim(),
    };
    setDecisionRecords((current) => editingDecisionId
      ? current.map((record) => record.id === editingDecisionId ? nextRecord : record)
      : [...current, nextRecord],
    );
    setDecisionDraft(DEFAULT_DECISION_DRAFT);
    setEditingDecisionId(null);
    toast.success(editingDecisionId ? t("agentProtocol.toast.decisionUpdated") : t("agentProtocol.toast.decisionSaved"));
  }, [decisionDraft, editingDecisionId, t]);

  const editDecisionRecord = useCallback((record: DecisionRecord) => {
    setDecisionDraft({
      title: record.title,
      basis: record.basis,
      impact: record.impact,
    });
    setEditingDecisionId(record.id);
    setActiveTab("decisions");
  }, []);

  const cancelDecisionEdit = useCallback(() => {
    setDecisionDraft(DEFAULT_DECISION_DRAFT);
    setEditingDecisionId(null);
  }, []);

  const removeDecisionRecord = useCallback((recordId: string) => {
    setDecisionRecords((current) => current.filter((record) => record.id !== recordId));
    setEditingDecisionId((current) => current === recordId ? null : current);
  }, []);

  const recordCurrentValidation = useCallback((options?: { silent?: boolean }) => {
    setProtocolState(
      Object.fromEntries(PROTOCOL_STAGES.map((stage) => [stage.id, "completed"])) as Record<string, ProtocolStatus>,
    );
    setCheckState(
      Object.fromEntries(
        PROTOCOL_STAGES.flatMap((stage) =>
          stage.checks.map((_, checkIndex) => [getCheckId(stage.id, checkIndex), true]),
        ),
      ) as Record<string, boolean>,
    );
    setTaskContext(CURRENT_VALIDATION_TASK_CONTEXT);
    setClosureGateState({
      tests: true,
      typecheck: true,
      build: true,
      "local-page-health": true,
      "desktop-package": true,
      handoff: true,
    });
    setEvidenceEntries((current) => {
      const recordedEntries: EvidenceEntry[] = [
        {
          id: "ev-agent-vitest-20260603",
          label: "Agent 协议中心组件与命令入口测试",
          command: "npm exec vitest run src/components/agent/__tests__/agent-protocol-center.test.tsx src/components/ui/__tests__/plugin-command-dialog.test.tsx -- --maxWorkers=2",
          result: "2 个测试文件通过，18 个测试用例通过；覆盖 Agent Protocol Center、新增本地页面健康门禁、Dev / Build 产物隔离回归模板和命令面板入口。",
          status: "passed",
        },
        {
          id: "ev-typecheck-20260603",
          label: "类型检查",
          command: "npm run typecheck",
          result: "通过；ensure-next-type-shims 与 tsc --noEmit 均完成。",
          status: "passed",
        },
        {
          id: "ev-build-20260603",
          label: "生产构建",
          command: "npm run build",
          result: "通过；Next 静态路由清单包含 /agent-protocol。",
          status: "passed",
        },
        {
          id: "ev-local-page-health-20260603",
          label: "本地页面健康",
          command: "Browser reload http://localhost:3000/agent-protocol and inspect console",
          result: "页面返回 200；浏览器控制台 errorCount = 0；无 Internal Server Error 文本；无 hydration error；页面可见 Agent 协议中心和本地页面健康门禁。",
          status: "passed",
        },
        {
          id: "ev-dev-build-isolation-20260603",
          label: "Dev / Build 产物隔离回归",
          command: "npm run build && Invoke-WebRequest http://localhost:3000/agent-protocol",
          result: "生产构建完成后，正在运行的 dev 页面仍返回 200；next dev 默认使用 web-dist-dev，next build 继续输出 web-dist，避免开发产物被生产构建覆盖。",
          status: "passed",
        },
        {
          id: "ev-desktop-package-20260603",
          label: "桌面产品打包更新",
          command: "npm run tauri:build",
          result: "通过；Tauri release 构建完成，生成 src-tauri/target/release/lattice.exe、bundle/msi/Lattice_2.2.0_x64_en-US.msi、bundle/nsis/Lattice_2.2.0_x64-setup.exe。",
          status: "passed",
        },
      ];
      const recordedIds = new Set(recordedEntries.map((entry) => entry.id));
      return [...current.filter((entry) => !recordedIds.has(entry.id)), ...recordedEntries];
    });
    setDecisionRecords((current) => {
      const recordedDecisions: DecisionRecord[] = [
        {
          id: "decision-client-snapshot-meta-20260603",
          title: "运行快照时间改为客户端挂载后写入",
          basis: "React/Next hydration 要求服务端 HTML 与客户端首屏渲染一致；渲染期间调用 new Date().toLocaleString 会导致文本不一致。",
          impact: "消除 /agent-protocol hydration mismatch，同时保留复制运行快照和交接摘要能力。",
        },
        {
          id: "decision-dev-build-dist-isolation-20260603",
          title: "隔离 next dev 与 next build 的产物目录",
          basis: "500 根因是 next build 重写 web-dist 后，运行中的 next dev 缺少 Turbopack runtime/manifest。Next 官方支持按 phase 配置 next.config。",
          impact: "next dev 默认使用 web-dist-dev，next build 继续输出 web-dist；构建后 dev 页面仍保持 200。",
        },
        {
          id: "decision-protocol-health-gates-20260603",
          title: "把真实 500 故障沉淀为协议门禁与证据模板",
          basis: "页面状态必须能反映真实工程验证，而不是只展示空白 Todo。",
          impact: "新增本地页面健康收尾门禁和 Dev / Build 产物隔离回归模板，后续交付能复用该检查。",
        },
      ];
      const recordedIds = new Set(recordedDecisions.map((record) => record.id));
      return [...current.filter((record) => !recordedIds.has(record.id)), ...recordedDecisions];
    });
    setEvidenceDraft(DEFAULT_EVIDENCE_DRAFT);
    setDecisionDraft(DEFAULT_DECISION_DRAFT);
    setEditingEvidenceId(null);
    setEditingDecisionId(null);
    setEvidenceFilter("all");
    setActiveTab("execution");
    window.localStorage.setItem(CURRENT_VALIDATION_STORAGE_KEY, CURRENT_VALIDATION_RECORD_ID);
    if (!options?.silent) {
      toast.success(t("agentProtocol.toast.validationRecorded"));
    }
  }, [t]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    if (window.localStorage.getItem(CURRENT_VALIDATION_STORAGE_KEY) === CURRENT_VALIDATION_RECORD_ID) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        recordCurrentValidation({ silent: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mounted, recordCurrentValidation]);

  const copyProtocol = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(protocolMarkdown);
      toast.success(t("agentProtocol.toast.protocolCopied"));
    } catch (error) {
      console.error("Failed to copy agent protocol:", error);
      toast.error(t("agentProtocol.toast.copyFailed"));
    }
  }, [protocolMarkdown, t]);

  const downloadProtocol = useCallback(() => {
    const blob = new Blob([protocolMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lattice-agent-protocol.md";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success(t("agentProtocol.toast.protocolExported"));
  }, [protocolMarkdown, t]);

  const copyRiskConfirmation = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(riskConfirmationText);
      toast.success(t("agentProtocol.toast.riskCopied"));
    } catch (error) {
      console.error("Failed to copy risk confirmation:", error);
      toast.error(t("agentProtocol.toast.copyFailed"));
    }
  }, [riskConfirmationText, t]);

  const copyHandoffSummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(handoffSummary);
      toast.success(t("agentProtocol.toast.handoffCopied"));
    } catch (error) {
      console.error("Failed to copy handoff summary:", error);
      toast.error(t("agentProtocol.toast.copyFailed"));
    }
  }, [handoffSummary, t]);

  const copyRunSnapshot = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(runSnapshot);
      toast.success(t("agentProtocol.toast.snapshotCopied"));
    } catch (error) {
      console.error("Failed to copy run snapshot:", error);
      toast.error(t("agentProtocol.toast.copyFailed"));
    }
  }, [runSnapshot, t]);

  const copyWorkbenchContext = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(workbenchContextText);
      toast.success(t("agentProtocol.toast.workbenchCopied"));
    } catch (error) {
      console.error("Failed to copy workbench context:", error);
      toast.error(t("agentProtocol.toast.copyFailed"));
    }
  }, [workbenchContextText, t]);

  const resetProtocol = useCallback(() => {
    setProtocolState(createDefaultState());
    setCheckState(createDefaultCheckState());
    setTaskContext(DEFAULT_TASK_CONTEXT);
    setRiskDraft(DEFAULT_RISK_DRAFT);
    setClosureGateState(createDefaultClosureGateState());
    setEvidenceEntries([]);
    setEvidenceDraft(DEFAULT_EVIDENCE_DRAFT);
    setEditingEvidenceId(null);
    setEvidenceFilter("all");
    setDecisionRecords([]);
    setDecisionDraft(DEFAULT_DECISION_DRAFT);
    setEditingDecisionId(null);
    setActiveTab("execution");
    window.localStorage.setItem(CURRENT_VALIDATION_STORAGE_KEY, CURRENT_VALIDATION_RECORD_ID);
    toast.success(t("agentProtocol.toast.reset"));
  }, [t]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <ClipboardCheck className="h-4 w-4" />
              {copy["agentProtocol.main.eyebrow"]}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-foreground">
              {copy["agentProtocol.main.title"]}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {copy["agentProtocol.main.description"]}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => recordCurrentValidation()}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <ClipboardCheck className="h-4 w-4" />
              {copy["agentProtocol.main.recordValidation"]}
            </button>
            <button
              type="button"
              onClick={() => void copyProtocol()}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Copy className="h-4 w-4" />
              {copy["agentProtocol.main.copyProtocol"]}
            </button>
            <button
              type="button"
              onClick={downloadProtocol}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Download className="h-4 w-4" />
              {copy["agentProtocol.main.exportMarkdown"]}
            </button>
            <button
              type="button"
              onClick={resetProtocol}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
              {copy["agentProtocol.main.reset"]}
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-5 py-3" role="tablist" aria-label={copy["agentProtocol.tabs.aria"]}>
          {workspaceTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex min-w-36 flex-col items-start rounded-md border px-3 py-2 text-left transition-colors",
                activeTab === tab.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className="text-sm font-semibold">{tab.label}</span>
              <span className="mt-1 text-xs leading-4">{tab.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <section className={cn("min-w-0 space-y-4", activeTab === "handoff" && "hidden")}>
          <div className={cn("space-y-4", activeTab !== "execution" && "hidden")}>
          <AgentCoworkInbox
            summary={coworkInbox.summary}
            nextAction={coworkInbox.nextAction}
            items={coworkInbox.items}
            pendingApprovalCount={coworkInbox.pendingApprovalCount}
            blockedCount={coworkInbox.blockedCount}
            runningCount={coworkInbox.runningCount}
            handoffCount={coworkInbox.handoffCount}
            totalSessionCount={coworkInbox.totalSessionCount}
            workspaceRisk={coworkInbox.workspaceRisk}
            onFocusSession={focusInboxSession}
          />

          <CodingQaRunnerPanel
            view={codingQaRunner}
            evidenceCandidates={codingQaEvidenceCandidates}
            importedEvidenceKeys={importedEvidenceKeys}
            onCopyPlan={() => void copyCodingQaPlan()}
            onPrepareEvidenceDraft={prepareCodingQaEvidenceDraft}
            onCreateApprovalRequest={createCodingQaApprovalRequest}
            onImportEvidence={importCodingQaEvidence}
          />

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4" />
              {copy["agentProtocol.task.title"]}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{copy["agentProtocol.task.goal"]}</span>
                <input
                  type="text"
                  value={taskContext.goal}
                  onChange={(event) => updateTaskContext("goal", event.target.value)}
                  placeholder={copy["agentProtocol.task.goalPlaceholder"]}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{copy["agentProtocol.task.scope"]}</span>
                <input
                  type="text"
                  value={taskContext.scope}
                  onChange={(event) => updateTaskContext("scope", event.target.value)}
                  placeholder={copy["agentProtocol.task.scopePlaceholder"]}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </label>
              <label className="space-y-1.5 lg:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">{copy["agentProtocol.task.notes"]}</span>
                <textarea
                  value={taskContext.notes}
                  onChange={(event) => updateTaskContext("notes", event.target.value)}
                  placeholder={copy["agentProtocol.task.notesPlaceholder"]}
                  rows={3}
                  className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </label>
            </div>
          </section>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ListChecks className="h-4 w-4" />
                {copy["agentProtocol.progress.stageProgress"]}
              </div>
              <div className="mt-3 text-3xl font-semibold">{progressPercent}%</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
                {copy["agentProtocol.progress.completedStages"]}
              </div>
              <div className="mt-3 text-3xl font-semibold">
                {completedCount}
                <span className="text-base text-muted-foreground"> / {PROTOCOL_STAGES.length}</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{copy["agentProtocol.progress.completedHint"]}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ClipboardCheck className="h-4 w-4" />
                {copy["agentProtocol.progress.checkProgress"]}
              </div>
              <div className="mt-3 text-3xl font-semibold">{checkProgressPercent}%</div>
              <div className="mt-3 text-sm text-muted-foreground">
                {t("agentProtocol.progress.confirmedItems", { completed: completedCheckCount, total: totalCheckCount })}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                {copy["agentProtocol.progress.currentFocus"]}
              </div>
              <div className="mt-3 truncate text-lg font-semibold">
                {activeStage?.title ?? copy["agentProtocol.progress.noActiveStage"]}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{copy["agentProtocol.progress.focusHint"]}</p>
            </div>
          </div>

          <div className="space-y-3">
            {PROTOCOL_STAGES.map((stage, index) => {
              const status = protocolState[stage.id] ?? "pending";
              return (
                <article key={stage.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold text-muted-foreground">
                          {index + 1}
                        </span>
                        <h2 className="text-base font-semibold">{stage.title}</h2>
                        <span className={cn("inline-flex rounded-md border px-2 py-1 text-xs font-medium", getStatusClassName(status))}>
                          {statusLabels[status]}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{stage.description}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      {STATUS_ORDER.map((nextStatus) => (
                        <button
                          key={nextStatus}
                          type="button"
                          onClick={() => setStageStatus(stage.id, nextStatus)}
                          aria-pressed={status === nextStatus}
                          className={cn(
                            "inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors",
                            status === nextStatus
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          {statusLabels[nextStatus]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ul className="mt-4 grid gap-2 md:grid-cols-3">
                    {stage.checks.map((check, checkIndex) => {
                      const checkId = getCheckId(stage.id, checkIndex);
                      const checked = Boolean(checkState[checkId]);
                      return (
                        <li key={checkId}>
                          <label className={cn(
                            "flex h-full cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                            checked
                              ? "border-emerald-500/35 bg-emerald-500/10 text-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-accent/60",
                          )}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCheck(stage.id, checkIndex)}
                              aria-label={`${stage.title}: ${check}`}
                              className="mt-1 h-4 w-4 shrink-0 rounded border-border"
                            />
                            <span className={cn(checked && "line-through decoration-emerald-500/70")}>{check}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              );
            })}
          </div>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4" />
                  {copy["agentProtocol.closure.title"]}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {copy["agentProtocol.closure.description"]}
                </p>
              </div>
              <span className={cn(
                "inline-flex w-fit rounded-md border px-2 py-1 text-xs font-medium",
                closureReady
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-border bg-background text-muted-foreground",
              )}>
                {t("agentProtocol.closure.confirmed", { completed: completedClosureGateCount, total: CLOSURE_GATES.length })}
              </span>
            </div>
            <ul className="mt-4 grid gap-2 lg:grid-cols-2">
              {CLOSURE_GATES.map((gate) => {
                const checked = Boolean(closureGateState[gate.id]);
                return (
                  <li key={gate.id}>
                    <label className={cn(
                      "flex h-full cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm transition-colors",
                      checked
                        ? "border-emerald-500/35 bg-emerald-500/10"
                        : "border-border bg-background hover:bg-accent/60",
                    )}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleClosureGate(gate.id)}
                        aria-label={t("agentProtocol.closure.aria", { title: gate.title })}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-border"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">{gate.title}</span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{gate.description}</span>
                        <span className={cn(
                          "mt-2 inline-flex rounded-md border px-2 py-1 text-[11px] font-medium",
                          gateEvidenceState[gate.id]
                            ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-border bg-background text-muted-foreground",
                        )}>
                          {gateEvidenceState[gate.id] ? copy["agentProtocol.closure.hasEvidence"] : copy["agentProtocol.closure.needsEvidence"]}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
          </div>

          <section className={cn("rounded-lg border border-border bg-card p-4", activeTab !== "evidence" && "hidden")}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ClipboardCheck className="h-4 w-4" />
                  {copy["agentProtocol.evidence.title"]}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {copy["agentProtocol.evidence.description"]}
                </p>
              </div>
              <span className="inline-flex w-fit rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
                {t("agentProtocol.evidence.count", { count: evidenceEntries.length })}
              </span>
            </div>
            <div className="mt-4 rounded-md border border-border bg-background p-3">
              <div className="text-xs font-medium text-muted-foreground">{copy["agentProtocol.evidence.templates"]}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {EVIDENCE_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => applyEvidenceTemplate(template)}
                    className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:bg-accent"
                  >
                    {template.title}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {(["all", "passed", "failed", "blocked"] as EvidenceFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setEvidenceFilter(filter)}
                  aria-pressed={evidenceFilter === filter}
                  className={cn(
                    "inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors",
                    evidenceFilter === filter
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {filter === "all" ? copy["agentProtocol.evidence.filter.all"] : evidenceStatusLabels[filter]}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem]">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{copy["agentProtocol.evidence.name"]}</span>
                <input
                  type="text"
                  value={evidenceDraft.label}
                  onChange={(event) => updateEvidenceDraft("label", event.target.value)}
                  placeholder={copy["agentProtocol.evidence.namePlaceholder"]}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{copy["agentProtocol.evidence.status"]}</span>
                <select
                  value={evidenceDraft.status}
                  onChange={(event) => updateEvidenceStatus(event.target.value as EvidenceStatus)}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary"
                >
                  <option value="passed">{evidenceStatusLabels.passed}</option>
                  <option value="failed">{evidenceStatusLabels.failed}</option>
                  <option value="blocked">{evidenceStatusLabels.blocked}</option>
                </select>
              </label>
              <label className="space-y-1.5 lg:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">{copy["agentProtocol.evidence.command"]}</span>
                <input
                  type="text"
                  value={evidenceDraft.command}
                  onChange={(event) => updateEvidenceDraft("command", event.target.value)}
                  placeholder={copy["agentProtocol.evidence.commandPlaceholder"]}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </label>
              <label className="space-y-1.5 lg:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">{copy["agentProtocol.evidence.result"]}</span>
                <textarea
                  value={evidenceDraft.result}
                  onChange={(event) => updateEvidenceDraft("result", event.target.value)}
                  placeholder={copy["agentProtocol.evidence.resultPlaceholder"]}
                  rows={2}
                  className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {editingEvidenceId ? (
                <button
                  type="button"
                  onClick={cancelEvidenceEdit}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                  {copy["agentProtocol.evidence.cancelEdit"]}
                </button>
              ) : null}
              <button
                type="button"
                onClick={addEvidenceEntry}
                className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent"
              >
                {editingEvidenceId ? copy["agentProtocol.evidence.update"] : copy["agentProtocol.evidence.record"]}
              </button>
            </div>
            {filteredEvidenceEntries.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {filteredEvidenceEntries.map((entry) => (
                  <li key={entry.id} className="rounded-md border border-border bg-background p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{entry.label}</span>
                          <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            {evidenceStatusLabels[entry.status]}
                          </span>
                        </div>
                        <div className="mt-1 break-words font-mono text-xs text-muted-foreground">{entry.command || copy["agentProtocol.evidence.emptyCommand"]}</div>
                        <p className="mt-1 text-sm text-muted-foreground">{entry.result || copy["agentProtocol.evidence.emptyResult"]}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {entry.sourceSessionId ? (
                          <button
                            type="button"
                            onClick={() => focusEvidenceSourceTrace(entry)}
                            aria-label={t("agentProtocol.evidence.viewSourceTrace", { label: entry.label })}
                            title={copy["agentProtocol.evidence.viewSourceTraceTitle"]}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => editEvidenceEntry(entry)}
                          aria-label={t("agentProtocol.evidence.edit", { label: entry.label })}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeEvidenceEntry(entry.id)}
                          aria-label={t("agentProtocol.evidence.delete", { label: entry.label })}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : evidenceEntries.length > 0 ? (
              <p className="mt-4 rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
                {copy["agentProtocol.evidence.emptyFilter"]}
              </p>
            ) : null}
          </section>

          <section className={cn("rounded-lg border border-border bg-card p-4", activeTab !== "decisions" && "hidden")}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4" />
                  {copy["agentProtocol.decision.title"]}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {copy["agentProtocol.decision.description"]}
                </p>
              </div>
              <span className="inline-flex w-fit rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
                {t("agentProtocol.evidence.count", { count: decisionRecords.length })}
              </span>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{copy["agentProtocol.decision.titleField"]}</span>
                <input
                  type="text"
                  value={decisionDraft.title}
                  onChange={(event) => updateDecisionDraft("title", event.target.value)}
                  placeholder={copy["agentProtocol.decision.titlePlaceholder"]}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{copy["agentProtocol.decision.basis"]}</span>
                <textarea
                  value={decisionDraft.basis}
                  onChange={(event) => updateDecisionDraft("basis", event.target.value)}
                  placeholder={copy["agentProtocol.decision.basisPlaceholder"]}
                  rows={2}
                  className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{copy["agentProtocol.decision.impact"]}</span>
                <textarea
                  value={decisionDraft.impact}
                  onChange={(event) => updateDecisionDraft("impact", event.target.value)}
                  placeholder={copy["agentProtocol.decision.impactPlaceholder"]}
                  rows={2}
                  className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {editingDecisionId ? (
                <button
                  type="button"
                  onClick={cancelDecisionEdit}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                  {copy["agentProtocol.decision.cancelEdit"]}
                </button>
              ) : null}
              <button
                type="button"
                onClick={addDecisionRecord}
                className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent"
              >
                {editingDecisionId ? copy["agentProtocol.decision.update"] : copy["agentProtocol.decision.save"]}
              </button>
            </div>
            {decisionRecords.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {decisionRecords.map((record) => (
                  <li key={record.id} className="rounded-md border border-border bg-background p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{record.title}</div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t("agentProtocol.decision.basisLine", { value: record.basis || copy["agentProtocol.decision.empty"] })}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t("agentProtocol.decision.impactLine", { value: record.impact || copy["agentProtocol.decision.empty"] })}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => editDecisionRecord(record)}
                          aria-label={t("agentProtocol.decision.edit", { title: record.title })}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeDecisionRecord(record.id)}
                          aria-label={t("agentProtocol.decision.delete", { title: record.title })}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </section>

        <aside className={cn("space-y-4", activeTab !== "handoff" && "hidden")}>
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardCheck className="h-4 w-4" />
              {copy["agentProtocol.report.title"]}
            </div>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{copy["agentProtocol.report.completedStages"]}</dt>
                <dd className="font-medium">{completedCount} / {PROTOCOL_STAGES.length}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{copy["agentProtocol.report.confirmedChecks"]}</dt>
                <dd className="font-medium">{completedCheckCount} / {totalCheckCount}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{copy["agentProtocol.report.nextStep"]}</dt>
                <dd className="text-right font-medium">
                  {nextOpenCheck
                    ? `${nextOpenCheck.stageTitle}：${nextOpenCheck.check}`
                    : copy["agentProtocol.report.allChecksDone"]}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{copy["agentProtocol.closure.title"]}</dt>
                <dd className={cn("font-medium", closureReady ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300")}>
                  {closureReady ? copy["agentProtocol.report.closureReady"] : `${completedClosureGateCount} / ${CLOSURE_GATES.length}`}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4" />
                {copy["agentProtocol.handoff.title"]}
              </div>
              <button
                type="button"
                onClick={() => void copyHandoffSummary()}
                aria-label={copy["agentProtocol.handoff.copyAria"]}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Copy className="h-3.5 w-3.5" />
                {copy["agentProtocol.common.copy"]}
              </button>
            </div>
            <pre className="mt-3 max-h-72 overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
              {handoffSummary}
            </pre>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ListChecks className="h-4 w-4" />
                {copy["agentProtocol.runSnapshot.title"]}
              </div>
              <button
                type="button"
                onClick={() => void copyRunSnapshot()}
                aria-label={copy["agentProtocol.runSnapshot.copyAria"]}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Copy className="h-3.5 w-3.5" />
                {copy["agentProtocol.common.copy"]}
              </button>
            </div>
            <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
              {runSnapshot}
            </pre>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ClipboardCheck className="h-4 w-4" />
                {copy["agentProtocol.workbench.title"]}
              </div>
              <button
                type="button"
                onClick={() => void copyWorkbenchContext()}
                aria-label={copy["agentProtocol.workbench.copyAria"]}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Copy className="h-3.5 w-3.5" />
                {copy["agentProtocol.common.copy"]}
              </button>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="text-xs text-muted-foreground">{copy["agentProtocol.workbench.workspace"]}</dt>
                <dd className="mt-1 break-words font-medium">{workbenchContext.workspaceName}</dd>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="text-xs text-muted-foreground">{copy["agentProtocol.workbench.rootPath"]}</dt>
                <dd className="mt-1 break-words font-medium">{workbenchContext.workspaceRootPath}</dd>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="text-xs text-muted-foreground">{copy["agentProtocol.workbench.activePane"]}</dt>
                <dd className="mt-1 break-words font-medium">{workbenchContext.activePaneId}</dd>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="text-xs text-muted-foreground">{copy["agentProtocol.workbench.activeTab"]}</dt>
                <dd className="mt-1 break-words font-medium">{workbenchContext.activeTabName}</dd>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="text-xs text-muted-foreground">{copy["agentProtocol.workbench.openTabs"]}</dt>
                <dd className="mt-1 font-medium">{workbenchContext.openTabCount}</dd>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="text-xs text-muted-foreground">{copy["agentProtocol.workbench.dirtyTabs"]}</dt>
                <dd className="mt-1 font-medium">{workbenchContext.dirtyTabCount}</dd>
              </div>
            </dl>
            <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
              {workbenchContextText}
            </pre>
          </section>

          <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                {copy["agentProtocol.risk.title"]}
              </div>
              <button
                type="button"
                onClick={() => void copyRiskConfirmation()}
                aria-label={copy["agentProtocol.risk.copyAria"]}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-amber-500/30 bg-background/70 px-2 text-xs font-medium transition-colors hover:bg-background"
              >
                <Copy className="h-3.5 w-3.5" />
                {copy["agentProtocol.common.copy"]}
              </button>
            </div>
            <div className="mt-3 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium">{copy["agentProtocol.risk.operationType"]}</span>
                <input
                  type="text"
                  value={riskDraft.operationType}
                  onChange={(event) => updateRiskDraft("operationType", event.target.value)}
                  className="h-9 w-full rounded-md border border-amber-500/30 bg-background px-3 text-sm text-foreground outline-none focus:border-amber-500"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium">{copy["agentProtocol.risk.impactScope"]}</span>
                <textarea
                  value={riskDraft.impactScope}
                  onChange={(event) => updateRiskDraft("impactScope", event.target.value)}
                  rows={2}
                  className="w-full resize-y rounded-md border border-amber-500/30 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-amber-500"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium">{copy["agentProtocol.risk.riskAssessment"]}</span>
                <textarea
                  value={riskDraft.riskAssessment}
                  onChange={(event) => updateRiskDraft("riskAssessment", event.target.value)}
                  rows={3}
                  className="w-full resize-y rounded-md border border-amber-500/30 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-amber-500"
                />
              </label>
              <pre className="max-h-56 overflow-auto rounded-md border border-amber-500/30 bg-background/80 p-3 text-xs leading-5 text-foreground">
                {riskConfirmationText}
              </pre>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4" />
              {copy["agentProtocol.protocolPreview.title"]}
            </div>
            <pre className="mt-3 max-h-[28rem] overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
              {protocolMarkdown}
            </pre>
          </section>

          <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              {copy["agentProtocol.dangerGate.title"]}
            </div>
            <p className="mt-2 leading-6">
              {copy["agentProtocol.dangerGate.description"]}
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
