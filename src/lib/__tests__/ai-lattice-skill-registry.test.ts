import { describe, expect, it } from 'vitest';
import {
  buildLatticeSkillReadiness,
  getLatticeSkill,
  listLatticeSkillCapabilities,
  listLatticeSkills,
  listLatticeSkillsForWorkflow,
} from '@/lib/ai/lattice-skills/skill-registry';
import {
  getLatticeOperationContract,
  listLatticeOperationContracts,
} from '@/lib/ai/lattice-skills/operation-contract';

describe('lattice skill registry', () => {
  it('lists current-thread skills without exposing PDF-reserved skills by default', () => {
    const skills = listLatticeSkills();

    expect(skills.map((skill) => skill.id)).toEqual([
      'path-identity',
      'note-taking',
      'notebook-analysis',
      'knowledge-organization',
      'pdf-annotation',
    ]);
    expect(skills.filter((skill) => skill.pdfScoped).map((skill) => skill.id)).toEqual(['pdf-annotation']);
  });

  it('maps workflows to the relevant Lattice skills and owners', () => {
    expect(listLatticeSkillsForWorkflow('reading-note').map((skill) => skill.id)).toEqual([
      'path-identity',
      'note-taking',
    ]);
    expect(listLatticeSkillsForWorkflow('pdf-annotation').map((skill) => skill.id)).toEqual([
      'path-identity',
      'pdf-annotation',
    ]);
    expect(listLatticeSkillsForWorkflow('pdf-annotation', { includePdfScoped: true }).map((skill) => skill.id)).toEqual([
      'path-identity',
      'pdf-annotation',
    ]);
    expect(getLatticeSkill('path-identity')).toMatchObject({
      status: 'ready',
      approvalMode: 'read-only',
      allowedTools: ['lattice.resolvePathIdentity'],
      requiredCapabilities: ['lattice_read_identity'],
      operationContractIds: ['path-identity'],
      writesWorkspace: false,
    });
    expect(getLatticeSkill('note-taking').requiredCapabilities).toEqual([
      'search_workspace',
      'read_workspace',
      'resolve_evidence',
      'create_draft',
      'lattice_create_note',
    ]);
    expect(getLatticeSkill('note-taking').operationContractIds).toEqual([
      'path-identity',
      'workbench-draft-handoff',
    ]);
    expect(getLatticeSkill('pdf-item-workspace')).toMatchObject({
      owner: 'pdf-thread',
      status: 'reserved',
      pdfScoped: true,
      requiredCapabilities: expect.arrayContaining(['lattice_create_pdf_item']),
      operationContractIds: ['path-identity', 'pdf-item-workspace'],
    });
  });

  it('keeps Lattice operation contracts explicit about project-specific safety rules', () => {
    expect(getLatticeOperationContract('workbench-draft-handoff')).toMatchObject({
      owner: 'ai-agent-thread',
      status: 'approval-gated',
      requiredTools: ['workbench.createDraft'],
      requiredCapabilities: ['create_draft', 'lattice_create_note'],
    });
    expect(getLatticeOperationContract('workbench-draft-handoff').rules.join('\n')).toContain(
      'Explicit create-mode writeback must not overwrite an existing file',
    );
    expect(getLatticeOperationContract('pdf-item-workspace')).toMatchObject({
      owner: 'pdf-thread',
      status: 'reserved',
      requiredCapabilities: expect.arrayContaining(['lattice_create_pdf_item']),
    });
    expect(getLatticeOperationContract('pdf-item-workspace').rules.join('\n')).toContain(
      '.lattice/items/<generated-file-id>/',
    );
    expect(getLatticeOperationContract('pdf-annotation-sidecar').prohibitions.join('\n')).toContain(
      'Do not fabricate PDF quads',
    );
    expect(getLatticeOperationContract('pdf-annotation-sidecar')).toMatchObject({
      owner: 'ai-agent-thread',
      status: 'approval-gated',
      requiredTools: ['lattice.resolvePathIdentity', 'evidence.resolve', 'workbench.createProposal'],
      requiredCapabilities: expect.arrayContaining(['propose_write', 'lattice_write_pdf_annotation']),
    });

    expect(listLatticeOperationContracts([
      'path-identity',
      'path-identity',
      'workbench-draft-handoff',
    ]).map((contract) => contract.id)).toEqual([
      'path-identity',
      'workbench-draft-handoff',
    ]);
  });

  it('summarizes readiness for P6 planning without enabling silent writes', () => {
    const readiness = buildLatticeSkillReadiness();

    expect(readiness.summary).toBe('5 current-thread skills / 1 PDF-reserved skills / 4 approval-gated skills');
    expect(readiness.approvalGated.map((skill) => skill.id)).toEqual([
      'note-taking',
      'notebook-analysis',
      'knowledge-organization',
      'pdf-annotation',
    ]);
    expect(readiness.readOnly.map((skill) => skill.id)).toEqual(['path-identity']);
    expect(readiness.reservedForPdfThread.every((skill) => skill.approvalMode === 'reserved')).toBe(true);
  });

  it('summarizes required Lattice skill capabilities without duplicating shared tools', () => {
    const skills = listLatticeSkillsForWorkflow('reading-note');

    expect(listLatticeSkillCapabilities(skills)).toEqual([
      'lattice_read_identity',
      'search_workspace',
      'read_workspace',
      'resolve_evidence',
      'create_draft',
      'lattice_create_note',
    ]);
  });
});
