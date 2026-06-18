import type { AgentToolName } from '../agent-tool-broker';
import type { AgentToolCapability } from '../agent-policy';
import type { ResearchAgentWorkflowId } from '../research-agent-workflows';
import type { LatticeOperationContractId } from './operation-contract';

export type LatticeSkillId =
  | 'path-identity'
  | 'note-taking'
  | 'notebook-analysis'
  | 'coding-change-review'
  | 'knowledge-organization'
  | 'pdf-item-workspace'
  | 'pdf-annotation';

export type LatticeSkillOwner = 'ai-agent-thread' | 'pdf-thread';
export type LatticeSkillStatus = 'ready' | 'foundation' | 'reserved' | 'blocked';
export type LatticeSkillScope = 'workspace' | 'note' | 'notebook' | 'pdf';
export type LatticeSkillApprovalMode = 'read-only' | 'approval-gated' | 'reserved';

export interface LatticeSkillDescriptor {
  id: LatticeSkillId;
  title: string;
  owner: LatticeSkillOwner;
  status: LatticeSkillStatus;
  scope: LatticeSkillScope;
  approvalMode: LatticeSkillApprovalMode;
  workflows: ResearchAgentWorkflowId[];
  allowedTools: AgentToolName[];
  requiredCapabilities: AgentToolCapability[];
  operationContractIds: LatticeOperationContractId[];
  writesWorkspace: boolean;
  pdfScoped: boolean;
  notes: string[];
}

export interface LatticeSkillReadiness {
  availableInCurrentThread: LatticeSkillDescriptor[];
  reservedForPdfThread: LatticeSkillDescriptor[];
  approvalGated: LatticeSkillDescriptor[];
  readOnly: LatticeSkillDescriptor[];
  summary: string;
}

export const LATTICE_SKILL_REGISTRY: LatticeSkillDescriptor[] = [
  {
    id: 'path-identity',
    title: 'Path Identity',
    owner: 'ai-agent-thread',
    status: 'ready',
    scope: 'workspace',
    approvalMode: 'read-only',
    workflows: [
      'markdown-research',
      'reading-note',
      'notebook-analysis',
      'literature-matrix',
      'knowledge-organization',
      'code-change-plan',
      'paper-reading',
      'pdf-annotation',
      'notebook-from-paper',
    ],
    allowedTools: ['lattice.resolvePathIdentity'],
    requiredCapabilities: ['lattice_read_identity'],
    operationContractIds: ['path-identity'],
    writesWorkspace: false,
    pdfScoped: false,
    notes: [
      'Read-only Tool Broker tool resolves canonical Lattice paths, file ids, annotation sidecars, and PDF item candidate paths.',
      'Use before any draft, proposal, annotation, or future write-capable Lattice skill.',
    ],
  },
  {
    id: 'note-taking',
    title: 'Configurable Note Taking',
    owner: 'ai-agent-thread',
    status: 'foundation',
    scope: 'note',
    approvalMode: 'approval-gated',
    workflows: ['reading-note', 'literature-matrix', 'markdown-research'],
    allowedTools: ['workspace.search', 'workspace.readIndexedContext', 'evidence.resolve', 'workbench.createDraft'],
    requiredCapabilities: [
      'search_workspace',
      'read_workspace',
      'resolve_evidence',
      'create_draft',
      'lattice_create_note',
    ],
    operationContractIds: ['path-identity', 'workbench-draft-handoff'],
    writesWorkspace: true,
    pdfScoped: false,
    notes: [
      'Use NoteTakingSkillConfig and Workbench draft handoff.',
      'No silent file writes; draft creation remains user-triggered or approval-gated.',
    ],
  },
  {
    id: 'notebook-analysis',
    title: 'Notebook Analysis',
    owner: 'ai-agent-thread',
    status: 'foundation',
    scope: 'notebook',
    approvalMode: 'approval-gated',
    workflows: ['notebook-analysis'],
    allowedTools: ['workspace.search', 'workspace.readIndexedContext', 'evidence.resolve', 'runner.runCode', 'workbench.createProposal'],
    requiredCapabilities: [
      'search_workspace',
      'read_workspace',
      'resolve_evidence',
      'run_code',
      'propose_write',
      'lattice_create_notebook',
    ],
    operationContractIds: ['path-identity', 'notebook-workflow-boundary'],
    writesWorkspace: true,
    pdfScoped: false,
    notes: [
      'Runner execution remains approval-gated.',
      'Prefer proposals for next experiments over silent notebook mutation.',
    ],
  },
  {
    id: 'coding-change-review',
    title: 'Coding Change Review',
    owner: 'ai-agent-thread',
    status: 'foundation',
    scope: 'workspace',
    approvalMode: 'approval-gated',
    workflows: ['code-change-plan'],
    allowedTools: ['workspace.search', 'workspace.readIndexedContext', 'lattice.resolvePathIdentity', 'evidence.resolve', 'workbench.createProposal'],
    requiredCapabilities: [
      'search_workspace',
      'read_workspace',
      'lattice_read_identity',
      'resolve_evidence',
      'propose_write',
    ],
    operationContractIds: ['path-identity', 'coding-change-review'],
    writesWorkspace: true,
    pdfScoped: false,
    notes: [
      'Produces reviewable code-change proposals with target files, risks, patch previews, and test plans.',
      'No direct source edits, shell commands, network calls, package manager actions, or git operations are enabled in this slice.',
    ],
  },
  {
    id: 'knowledge-organization',
    title: 'Knowledge Organization',
    owner: 'ai-agent-thread',
    status: 'foundation',
    scope: 'workspace',
    approvalMode: 'approval-gated',
    workflows: ['knowledge-organization'],
    allowedTools: ['workspace.search', 'workspace.readIndexedContext', 'evidence.resolve', 'workbench.createProposal'],
    requiredCapabilities: [
      'search_workspace',
      'read_workspace',
      'resolve_evidence',
      'propose_write',
      'lattice_update_note',
    ],
    operationContractIds: ['path-identity', 'knowledge-organization-proposal'],
    writesWorkspace: true,
    pdfScoped: false,
    notes: [
      'Organization actions should be proposals first.',
      'Direct note/link mutation requires future Tool Broker approval tools.',
    ],
  },
  {
    id: 'pdf-item-workspace',
    title: 'PDF Item Workspace',
    owner: 'pdf-thread',
    status: 'reserved',
    scope: 'pdf',
    approvalMode: 'reserved',
    workflows: ['paper-reading', 'notebook-from-paper'],
    allowedTools: ['workspace.search', 'workspace.readIndexedContext', 'evidence.resolve'],
    requiredCapabilities: [
      'search_workspace',
      'read_workspace',
      'resolve_evidence',
      'lattice_create_pdf_item',
    ],
    operationContractIds: ['path-identity', 'pdf-item-workspace'],
    writesWorkspace: true,
    pdfScoped: true,
    notes: [
      'Reserved for the PDF implementation window.',
      'Must reuse PDF item workspace services and avoid overwriting existing notes/notebooks.',
    ],
  },
  {
    id: 'pdf-annotation',
    title: 'PDF Annotation',
    owner: 'ai-agent-thread',
    status: 'foundation',
    scope: 'pdf',
    approvalMode: 'approval-gated',
    workflows: ['pdf-annotation', 'paper-reading'],
    allowedTools: ['lattice.resolvePathIdentity', 'workspace.search', 'workspace.readIndexedContext', 'evidence.resolve', 'workbench.createProposal'],
    requiredCapabilities: [
      'lattice_read_identity',
      'search_workspace',
      'read_workspace',
      'resolve_evidence',
      'propose_write',
      'lattice_write_pdf_annotation',
    ],
    operationContractIds: ['path-identity', 'pdf-annotation-sidecar'],
    writesWorkspace: true,
    pdfScoped: true,
    notes: [
      'AI highlights/underlines are approval-gated exact-quote drafts in _annotations.md; Lattice resolves them into canonical sidecar rects/quads when the PDF opens.',
      'Unresolved quotes must remain drafts or proposals with trace provenance; never fabricate PDF coordinates.',
      'AI-originated drafts keep AI and AI批注 tags by default so users can filter or audit them.',
    ],
  },
];

export function listLatticeSkills(options: {
  includePdfScoped?: boolean;
  owner?: LatticeSkillOwner;
  status?: LatticeSkillStatus;
} = {}): LatticeSkillDescriptor[] {
  return LATTICE_SKILL_REGISTRY.filter((skill) =>
    (options.includePdfScoped || !skill.pdfScoped || skill.owner === 'ai-agent-thread') &&
    (!options.owner || skill.owner === options.owner) &&
    (!options.status || skill.status === options.status),
  );
}

export function getLatticeSkill(id: LatticeSkillId): LatticeSkillDescriptor {
  const skill = LATTICE_SKILL_REGISTRY.find((candidate) => candidate.id === id);
  if (!skill) {
    throw new Error(`Unknown Lattice skill: ${id}`);
  }
  return skill;
}

export function listLatticeSkillsForWorkflow(
  workflowId: ResearchAgentWorkflowId,
  options: { includePdfScoped?: boolean } = {},
): LatticeSkillDescriptor[] {
  return listLatticeSkills(options).filter((skill) => skill.workflows.includes(workflowId));
}

export function buildLatticeSkillReadiness(): LatticeSkillReadiness {
  const availableInCurrentThread = listLatticeSkills({ owner: 'ai-agent-thread' });
  const reservedForPdfThread = listLatticeSkills({ includePdfScoped: true, owner: 'pdf-thread' });
  const approvalGated = listLatticeSkills({ includePdfScoped: true })
    .filter((skill) => skill.approvalMode === 'approval-gated');
  const readOnly = listLatticeSkills({ includePdfScoped: true })
    .filter((skill) => skill.approvalMode === 'read-only');

  return {
    availableInCurrentThread,
    reservedForPdfThread,
    approvalGated,
    readOnly,
    summary: [
      `${availableInCurrentThread.length} current-thread skills`,
      `${reservedForPdfThread.length} PDF-reserved skills`,
      `${approvalGated.length} approval-gated skills`,
    ].join(' / '),
  };
}

export function listLatticeSkillCapabilities(
  skills: LatticeSkillDescriptor[],
): AgentToolCapability[] {
  return [...new Set(skills.flatMap((skill) => skill.requiredCapabilities))];
}
