export type AgentSafetyProfile =
  | 'chat'
  | 'research'
  | 'writeback'
  | 'automation';

export type AgentPermissionLevel = 'auto' | 'ask' | 'deny';

export type AgentToolCapability =
  | 'read_workspace'
  | 'search_workspace'
  | 'resolve_evidence'
  | 'create_draft'
  | 'propose_write'
  | 'write_workspace'
  | 'run_code'
  | 'run_shell'
  | 'use_network'
  | 'schedule_task'
  | 'memory_read'
  | 'memory_write'
  | 'lattice_read_identity'
  | 'lattice_create_note'
  | 'lattice_create_notebook'
  | 'lattice_update_note'
  | 'lattice_create_pdf_item'
  | 'lattice_write_pdf_annotation';

export interface AgentCapabilityPolicy {
  profile: AgentSafetyProfile;
  permissions: Record<AgentToolCapability, AgentPermissionLevel>;
  maxSteps: number;
  maxContextTokens: number;
  requiresEvidence: boolean;
  allowBackgroundRuns: boolean;
}

export interface AgentCapabilityDecision {
  capability: AgentToolCapability;
  permission: AgentPermissionLevel;
  requiresApproval: boolean;
  allowed: boolean;
}

const CAPABILITIES: AgentToolCapability[] = [
  'read_workspace',
  'search_workspace',
  'resolve_evidence',
  'create_draft',
  'propose_write',
  'write_workspace',
  'run_code',
  'run_shell',
  'use_network',
  'schedule_task',
  'memory_read',
  'memory_write',
  'lattice_read_identity',
  'lattice_create_note',
  'lattice_create_notebook',
  'lattice_update_note',
  'lattice_create_pdf_item',
  'lattice_write_pdf_annotation',
];

function denyAll(): Record<AgentToolCapability, AgentPermissionLevel> {
  return Object.fromEntries(
    CAPABILITIES.map((capability) => [capability, 'deny']),
  ) as Record<AgentToolCapability, AgentPermissionLevel>;
}

function policy(
  profile: AgentSafetyProfile,
  overrides: Partial<Record<AgentToolCapability, AgentPermissionLevel>>,
  options: Omit<AgentCapabilityPolicy, 'profile' | 'permissions'>,
): AgentCapabilityPolicy {
  return {
    profile,
    permissions: {
      ...denyAll(),
      ...overrides,
    },
    ...options,
  };
}

export function buildAgentCapabilityPolicy(profile: AgentSafetyProfile): AgentCapabilityPolicy {
  switch (profile) {
    case 'chat':
      return policy(
        profile,
        {
          resolve_evidence: 'auto',
          memory_read: 'auto',
        },
        {
          maxSteps: 1,
          maxContextTokens: 12000,
          requiresEvidence: false,
          allowBackgroundRuns: false,
        },
      );
    case 'research':
      return policy(
        profile,
        {
          read_workspace: 'auto',
          search_workspace: 'auto',
          resolve_evidence: 'auto',
          lattice_read_identity: 'auto',
          create_draft: 'ask',
          propose_write: 'ask',
          lattice_create_note: 'ask',
          lattice_create_notebook: 'ask',
          lattice_update_note: 'ask',
          run_code: 'ask',
          memory_read: 'auto',
          memory_write: 'ask',
        },
        {
          maxSteps: 8,
          maxContextTokens: 24000,
          requiresEvidence: true,
          allowBackgroundRuns: false,
        },
      );
    case 'writeback':
      return policy(
        profile,
        {
          read_workspace: 'auto',
          search_workspace: 'auto',
          resolve_evidence: 'auto',
          lattice_read_identity: 'auto',
          create_draft: 'auto',
          propose_write: 'auto',
          write_workspace: 'ask',
          lattice_create_note: 'ask',
          lattice_create_notebook: 'ask',
          lattice_update_note: 'ask',
          lattice_create_pdf_item: 'ask',
          lattice_write_pdf_annotation: 'ask',
          run_code: 'ask',
          memory_read: 'auto',
          memory_write: 'ask',
        },
        {
          maxSteps: 12,
          maxContextTokens: 32000,
          requiresEvidence: true,
          allowBackgroundRuns: false,
        },
      );
    case 'automation':
      return policy(
        profile,
        {
          read_workspace: 'auto',
          search_workspace: 'auto',
          resolve_evidence: 'auto',
          lattice_read_identity: 'auto',
          create_draft: 'ask',
          propose_write: 'ask',
          write_workspace: 'ask',
          lattice_create_note: 'ask',
          lattice_create_notebook: 'ask',
          lattice_update_note: 'ask',
          lattice_create_pdf_item: 'ask',
          lattice_write_pdf_annotation: 'ask',
          run_code: 'ask',
          schedule_task: 'ask',
          memory_read: 'auto',
          memory_write: 'ask',
        },
        {
          maxSteps: 20,
          maxContextTokens: 32000,
          requiresEvidence: true,
          allowBackgroundRuns: true,
        },
      );
  }
}

export function getAgentCapabilityDecision(
  policy: AgentCapabilityPolicy,
  capability: AgentToolCapability,
): AgentCapabilityDecision {
  const permission = policy.permissions[capability];
  return {
    capability,
    permission,
    requiresApproval: permission === 'ask',
    allowed: permission !== 'deny',
  };
}

export function listAgentCapabilityDecisions(
  policy: AgentCapabilityPolicy,
): AgentCapabilityDecision[] {
  return CAPABILITIES.map((capability) => getAgentCapabilityDecision(policy, capability));
}

export function assertAgentCapabilityAllowed(
  policy: AgentCapabilityPolicy,
  capability: AgentToolCapability,
): AgentCapabilityDecision {
  const decision = getAgentCapabilityDecision(policy, capability);
  if (!decision.allowed) {
    throw new Error(`Agent capability denied by ${policy.profile} policy: ${capability}`);
  }
  return decision;
}
