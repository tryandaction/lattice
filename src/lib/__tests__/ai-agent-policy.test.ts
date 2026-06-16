import { describe, expect, it } from 'vitest';

import {
  assertAgentCapabilityAllowed,
  buildAgentCapabilityPolicy,
  getAgentCapabilityDecision,
  listAgentCapabilityDecisions,
} from '../ai/agent-policy';

describe('agent-policy', () => {
  it('keeps plain chat non-mutating and single-step', () => {
    const policy = buildAgentCapabilityPolicy('chat');

    expect(policy.maxSteps).toBe(1);
    expect(policy.allowBackgroundRuns).toBe(false);
    expect(getAgentCapabilityDecision(policy, 'resolve_evidence')).toMatchObject({
      allowed: true,
      requiresApproval: false,
    });
    expect(getAgentCapabilityDecision(policy, 'lattice_read_identity')).toMatchObject({
      allowed: false,
      requiresApproval: false,
    });
    expect(getAgentCapabilityDecision(policy, 'write_workspace')).toMatchObject({
      allowed: false,
      requiresApproval: false,
    });
    expect(() => assertAgentCapabilityAllowed(policy, 'run_shell')).toThrow(
      'Agent capability denied by chat policy: run_shell',
    );
  });

  it('allows research context gathering while gating drafts and execution', () => {
    const policy = buildAgentCapabilityPolicy('research');

    expect(policy.requiresEvidence).toBe(true);
    expect(getAgentCapabilityDecision(policy, 'read_workspace')).toMatchObject({
      allowed: true,
      requiresApproval: false,
    });
    expect(getAgentCapabilityDecision(policy, 'lattice_read_identity')).toMatchObject({
      allowed: true,
      requiresApproval: false,
    });
    expect(getAgentCapabilityDecision(policy, 'create_draft')).toMatchObject({
      allowed: true,
      requiresApproval: true,
    });
    expect(getAgentCapabilityDecision(policy, 'lattice_create_note')).toMatchObject({
      allowed: true,
      requiresApproval: true,
    });
    expect(getAgentCapabilityDecision(policy, 'run_code')).toMatchObject({
      allowed: true,
      requiresApproval: true,
    });
    expect(getAgentCapabilityDecision(policy, 'run_shell')).toMatchObject({
      allowed: false,
    });
  });

  it('requires approval for direct writeback and automation scheduling', () => {
    const writeback = buildAgentCapabilityPolicy('writeback');
    const automation = buildAgentCapabilityPolicy('automation');

    expect(getAgentCapabilityDecision(writeback, 'write_workspace')).toMatchObject({
      allowed: true,
      requiresApproval: true,
    });
    expect(getAgentCapabilityDecision(writeback, 'lattice_create_pdf_item')).toMatchObject({
      allowed: true,
      requiresApproval: true,
    });
    expect(automation.allowBackgroundRuns).toBe(true);
    expect(getAgentCapabilityDecision(automation, 'schedule_task')).toMatchObject({
      allowed: true,
      requiresApproval: true,
    });
    expect(getAgentCapabilityDecision(automation, 'use_network')).toMatchObject({
      allowed: false,
    });
  });

  it('lists one decision per capability for UI review surfaces', () => {
    const decisions = listAgentCapabilityDecisions(buildAgentCapabilityPolicy('research'));

    expect(decisions.length).toBeGreaterThan(8);
    expect(decisions.map((decision) => decision.capability)).toContain('memory_write');
    expect(decisions.map((decision) => decision.capability)).toContain('lattice_read_identity');
    expect(decisions.map((decision) => decision.capability)).toContain('lattice_write_pdf_annotation');
    expect(decisions.every((decision) => ['auto', 'ask', 'deny'].includes(decision.permission))).toBe(true);
  });
});
