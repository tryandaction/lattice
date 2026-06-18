import type { AgentToolCapability } from '../agent-policy';
import type { AgentToolName } from '../agent-tool-broker';

export type LatticeOperationContractId =
  | 'path-identity'
  | 'workbench-draft-handoff'
  | 'coding-change-review'
  | 'pdf-item-workspace'
  | 'pdf-annotation-sidecar'
  | 'notebook-workflow-boundary'
  | 'knowledge-organization-proposal';

export type LatticeOperationContractOwner = 'ai-agent-thread' | 'pdf-thread';
export type LatticeOperationContractStatus = 'ready' | 'approval-gated' | 'reserved';

export interface LatticeOperationContract {
  id: LatticeOperationContractId;
  title: string;
  owner: LatticeOperationContractOwner;
  status: LatticeOperationContractStatus;
  requiredTools: AgentToolName[];
  requiredCapabilities: AgentToolCapability[];
  summary: string;
  rules: string[];
  prohibitions: string[];
}

export const LATTICE_OPERATION_CONTRACTS: Record<LatticeOperationContractId, LatticeOperationContract> = {
  'path-identity': {
    id: 'path-identity',
    title: 'Lattice Path Identity',
    owner: 'ai-agent-thread',
    status: 'ready',
    requiredTools: ['lattice.resolvePathIdentity'],
    requiredCapabilities: ['lattice_read_identity'],
    summary: 'Resolve canonical Lattice paths, file ids, annotation sidecars, and PDF item candidate paths before artifact planning.',
    rules: [
      'Use lattice.resolvePathIdentity before any draft, proposal, PDF item, annotation, or notebook plan that depends on a concrete workspace file.',
      'Treat latticePath, fileIdentity.relativePathFromRoot, fileIdCandidates, annotationPath, itemFolderPath, itemManifestPath, and annotationIndexPath as planning facts, not as write permission.',
      'Preserve workspace-relative paths; desktop display prefixes are stripped only through the shared path identity resolver.',
    ],
    prohibitions: [
      'Do not invent file ids, annotation sidecar paths, or PDF item folder paths from prompt text when the resolver is available.',
      'Do not mutate the workspace from path identity results; this contract is read-only.',
    ],
  },
  'workbench-draft-handoff': {
    id: 'workbench-draft-handoff',
    title: 'Workbench Draft Handoff',
    owner: 'ai-agent-thread',
    status: 'approval-gated',
    requiredTools: ['workbench.createDraft'],
    requiredCapabilities: ['create_draft', 'lattice_create_note'],
    summary: 'Create reviewable AiDraftArtifact payloads and let Workbench writeback enforce Lattice file safety rules.',
    rules: [
      'Use AiDraftArtifact or AiDraftSuggestion with title, content, sourceRefs, targetPath, and writeMode for note-taking outputs.',
      'Default draft paths should stay under AI Drafts unless a workflow has a specific approved target.',
      'Explicit create-mode writeback must not overwrite an existing file; use append mode or a different target when the target exists.',
      'Append writeback requires an explicit Markdown target path and appends formatted draft content with evidence metadata.',
      'Update-style proposal writes become append-mode drafts for review instead of direct mutation.',
    ],
    prohibitions: [
      'Do not write markdown files directly from Agent code outside Workbench draft/proposal writeback.',
      'Do not silently overwrite an existing note, child document, or notebook.',
    ],
  },
  'coding-change-review': {
    id: 'coding-change-review',
    title: 'Coding Change Review',
    owner: 'ai-agent-thread',
    status: 'approval-gated',
    requiredTools: ['workspace.search', 'workspace.readIndexedContext', 'lattice.resolvePathIdentity', 'evidence.resolve', 'workbench.createProposal'],
    requiredCapabilities: ['search_workspace', 'read_workspace', 'lattice_read_identity', 'resolve_evidence', 'propose_write'],
    summary: 'Plan code reviews and code changes as reviewable Workbench proposals with target files, patch previews, risks, and tests.',
    rules: [
      'Use workspace.search and workspace.readIndexedContext to inspect code context before proposing a change.',
      'Resolve Lattice path identity for concrete target files before planning file-specific edits.',
      'A coding proposal must name target files, summarize intended diffs, include a patch or pseudo-diff preview, list risks, and include a focused test plan.',
      'QA commands may be listed only as approval-gated command plans with command, reason, risk, and approval status.',
      'Workbench proposals are the handoff boundary for code changes; generated target drafts may be reviewed before any workspace writeback.',
      'Test commands are suggestions until an approval-gated runner or future command plan executes them.',
    ],
    prohibitions: [
      'Do not write source files directly from the Research Agent coding workflow.',
      'Do not run shell, git, package manager, network, or production API commands from this workflow.',
      'Do not mark QA command plans as executed or passed unless a separate approved execution result is present in Trace.',
      'Do not present uncited code changes as applied; clearly label them as proposals or patch previews.',
      'Do not include absolute paths, parent traversal, secrets, or environment-specific machine paths in planned writes.',
    ],
  },
  'pdf-item-workspace': {
    id: 'pdf-item-workspace',
    title: 'PDF Item Workspace',
    owner: 'pdf-thread',
    status: 'reserved',
    requiredTools: ['lattice.resolvePathIdentity'],
    requiredCapabilities: ['lattice_read_identity', 'lattice_create_pdf_item'],
    summary: 'PDF item workspaces are manifest-managed child workspaces under .lattice/items and remain reserved for the PDF implementation thread.',
    rules: [
      'Current PDF item manifests are version 4 manifest.json files under .lattice/items/<generated-file-id>/ with itemId, pdfPath, itemFolderPath, annotationIndexPath, knownPdfPaths, fileFingerprint, and versionFingerprint.',
      'Annotation indexes for PDF items use _annotations.md inside the item folder, and notebooks store latticePdfItem metadata plus a relative Source PDF link.',
      'Future PDF item creation must reuse pdf-item.ts services such as ensurePdfItemWorkspace and manifest index helpers.',
      'Reading notes, notebooks, and annotation indexes inside a PDF item workspace must preserve existing files and generate unique child document names when needed.',
    ],
    prohibitions: [
      'Do not manually create .lattice/items folders or manifest.json files from a prompt-only plan.',
      'Do not migrate or delete legacy PDF item folders outside the dedicated PDF service path.',
      'Do not expose PDF item write tools in the current AI Agent thread.',
    ],
  },
  'pdf-annotation-sidecar': {
    id: 'pdf-annotation-sidecar',
    title: 'PDF Annotation Sidecar',
    owner: 'ai-agent-thread',
    status: 'approval-gated',
    requiredTools: ['lattice.resolvePathIdentity', 'evidence.resolve', 'workbench.createProposal'],
    requiredCapabilities: ['lattice_read_identity', 'resolve_evidence', 'propose_write', 'lattice_write_pdf_annotation'],
    summary: 'PDF annotations live in versioned .lattice/annotations sidecars; AI text-markup drafts are written in PDF item _annotations.md and resolved by the PDF text model.',
    rules: [
      'Universal annotation sidecars live at .lattice/annotations/<fileId>.json and currently normalize to version 3.',
      'PDF item annotation indexes live at .lattice/items/<itemId>/_annotations.md and contain a preserved lattice-pdf-annotation-drafts block for AI/human exact-quote annotation intents.',
      'For AI highlights/underlines, propose a lattice-pdf-annotation draft with page, exact Quote, type, color, optional comment, and optional tags; Lattice resolves it through the PDF text model into sidecar rects/quads when the PDF opens.',
      'AI-originated PDF annotation drafts must keep the default AI tags unless the user explicitly asks to remove them.',
      'Annotation loading may resolve candidate file ids and mirror older sidecars to the current file id; Agents should preserve candidate provenance in plans.',
      'Any future annotation write must read and merge the existing sidecar instead of replacing the annotations array blindly.',
      'Precise PDF text highlights require either canonical exact-quote draft resolution or a trusted text kernel anchor; unresolved exact quotes must remain drafts with the reason recorded in Trace.',
    ],
    prohibitions: [
      'Do not fabricate PDF quads, character anchors, or highlight locations from copied text alone.',
      'Do not overwrite .lattice/annotations/<fileId>.json without merging existing annotations.',
      'Do not remove the lattice-pdf-annotation-drafts block when regenerating _annotations.md.',
      'Do not write coordinates into _annotations.md drafts; exact Quote text is the trusted anchor.',
    ],
  },
  'notebook-workflow-boundary': {
    id: 'notebook-workflow-boundary',
    title: 'Notebook Workflow Boundary',
    owner: 'ai-agent-thread',
    status: 'approval-gated',
    requiredTools: ['workspace.search', 'workspace.readIndexedContext', 'evidence.resolve', 'runner.runCode', 'workbench.createProposal'],
    requiredCapabilities: ['search_workspace', 'read_workspace', 'resolve_evidence', 'run_code', 'propose_write', 'lattice_create_notebook'],
    summary: 'Notebook analysis may inspect notebooks and propose experiments, while execution and mutations remain approval-gated.',
    rules: [
      'Use indexed notebook context and evidence resolution before proposing notebook changes.',
      'Runner execution remains approval-gated and should return evidence-backed observations before any draft/proposal handoff.',
      'Prefer Workbench proposals for new notebooks, experiment cells, or PDF-derived extraction notebooks.',
    ],
    prohibitions: [
      'Do not mutate notebook JSON directly from the Agent surface.',
      'Do not run code silently or hide runner output from Trace.',
    ],
  },
  'knowledge-organization-proposal': {
    id: 'knowledge-organization-proposal',
    title: 'Knowledge Organization Proposal',
    owner: 'ai-agent-thread',
    status: 'approval-gated',
    requiredTools: ['workspace.search', 'workspace.readIndexedContext', 'evidence.resolve', 'workbench.createProposal'],
    requiredCapabilities: ['search_workspace', 'read_workspace', 'resolve_evidence', 'propose_write', 'lattice_update_note'],
    summary: 'Knowledge organization starts as reviewable proposals for links, moves, indexes, or note updates.',
    rules: [
      'Use proposals for organization plans that affect multiple notes, folders, backlinks, or knowledge indexes.',
      'Planned writes must include target paths, modes, and content previews so the user can approve individual writes.',
      'Generate target drafts from approved proposal writes before applying workspace writeback.',
    ],
    prohibitions: [
      'Do not reorganize files, links, tags, or note structure silently.',
      'Do not infer destructive moves or deletes from a broad organization request.',
    ],
  },
};

export function getLatticeOperationContract(id: LatticeOperationContractId): LatticeOperationContract {
  return LATTICE_OPERATION_CONTRACTS[id];
}

export function listLatticeOperationContracts(ids: LatticeOperationContractId[]): LatticeOperationContract[] {
  return Array.from(new Set(ids)).map(getLatticeOperationContract);
}

export function listLatticeOperationCapabilities(
  contracts: LatticeOperationContract[],
): AgentToolCapability[] {
  return [...new Set(contracts.flatMap((contract) => contract.requiredCapabilities))];
}

export function formatLatticeOperationContractHint(contract: LatticeOperationContract): string {
  const rules = contract.rules.map((rule) => `rule: ${rule}`).join(' ');
  const prohibitions = contract.prohibitions.map((rule) => `do not: ${rule}`).join(' ');
  return `Lattice operation contract: ${contract.title} [${contract.status}/${contract.owner}]. ${contract.summary} ${rules} ${prohibitions}`;
}
