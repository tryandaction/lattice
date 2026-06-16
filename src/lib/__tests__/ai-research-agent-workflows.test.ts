import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTE_TAKING_SKILL_CONFIG,
  buildResearchAgentWorkflowExecutionProfile,
  buildResearchAgentWorkflowPlannerHints,
  getResearchAgentWorkflow,
  inferResearchAgentWorkflow,
  listResearchAgentWorkflows,
  resolveNoteTakingSkillConfig,
} from '../ai/research-agent-workflows';

describe('research-agent-workflows', () => {
  it('lists non-PDF workflows by default and keeps PDF-scoped workflows opt-in', () => {
    const visible = listResearchAgentWorkflows();
    const all = listResearchAgentWorkflows({ includePdfScoped: true });

    expect(visible.map((workflow) => workflow.id)).toEqual([
      'markdown-research',
      'reading-note',
      'notebook-analysis',
      'literature-matrix',
      'knowledge-organization',
      'teaching-explain',
    ]);
    expect(all.map((workflow) => workflow.id)).toEqual(
      expect.arrayContaining(['paper-reading', 'pdf-annotation', 'notebook-from-paper']),
    );
  });

  it('resolves workflow-specific note config with explicit overrides winning', () => {
    const workflow = getResearchAgentWorkflow('reading-note');
    const config = resolveNoteTakingSkillConfig(workflow, {
      language: 'en-US',
      noteStyle: 'custom',
      sections: ['Summary', 'Evidence', 'Actions'],
    });

    expect(config).toMatchObject({
      language: 'en-US',
      noteStyle: 'custom',
      quotePolicy: 'evidence-table',
      annotationPolicy: 'key-claims',
      approvalMode: DEFAULT_NOTE_TAKING_SKILL_CONFIG.approvalMode,
    });
    expect(config.sections).toEqual(['Summary', 'Evidence', 'Actions']);
  });

  it('builds planner hints from workflow policy, tools, and note config', () => {
    const workflow = getResearchAgentWorkflow('notebook-analysis');
    const hints = buildResearchAgentWorkflowPlannerHints(workflow);

    expect(workflow.contextProfile.contextBudgetProfileId).toBe('notebook');
    expect(hints).toContain('Workflow: Notebook Analysis (notebook-analysis)');
    expect(hints).toContain('Allowed tools: workspace.search, workspace.readIndexedContext, lattice.resolvePathIdentity, evidence.resolve, runner.runCode, workbench.createProposal');
    expect(hints).toContain('Tool schemas: workspace.search { query: string, limit?: number } -> Indexed file matches with paths and summaries.');
    expect(hints).toContain('lattice.resolvePathIdentity { filePathOrAbsolutePath: string, fileName?: string, kind?: "generic" | "pdf" } -> Lattice path, file id candidates, annotation sidecar path, and optional PDF item paths.');
    expect(hints).toContain('runner.runCode { language: string, code: string } -> Runner output text.');
    expect(hints).toContain('Output artifact policy: notebook-plan');
    expect(hints).toContain('Approval policy: draft=ask, proposal=ask, runCode=ask, memory=ask');
    expect(hints).toContain('Lattice workflow profile: Notebook Analysis uses 2 current-thread skills and 0 PDF-reserved skills.');
    expect(hints).toContain('Current-thread Lattice skills: Path Identity [ready/read-only], Notebook Analysis [foundation/approval-gated].');
    expect(hints).toContain('Required Lattice capabilities: lattice_read_identity, search_workspace, read_workspace, resolve_evidence, run_code, propose_write, lattice_create_notebook.');
    expect(hints).toContain('Lattice skill tools available through this profile: lattice.resolvePathIdentity, workspace.search, workspace.readIndexedContext, evidence.resolve, runner.runCode, workbench.createProposal.');
    expect(hints).toContain('Note-taking contract: language=zh-CN, style=academic, naming=title, approval=draft-first.');
    expect(hints).toContain('Lattice operation contract: Notebook Workflow Boundary [approval-gated/ai-agent-thread].');
    expect(hints).toContain('Do not mutate notebook JSON directly from the Agent surface.');
    expect(hints).toContain('Hint: Runner/code execution remains approval-gated.');
  });

  it('injects Workbench draft handoff rules into note-taking planner hints', () => {
    const workflow = getResearchAgentWorkflow('reading-note');
    const profile = buildResearchAgentWorkflowExecutionProfile(workflow);
    const hints = buildResearchAgentWorkflowPlannerHints(workflow);

    expect(profile.operationContracts.map((contract) => contract.id)).toEqual([
      'path-identity',
      'workbench-draft-handoff',
    ]);
    expect(hints).toContain('Lattice operation contract: Workbench Draft Handoff [approval-gated/ai-agent-thread].');
    expect(hints).toContain('Default draft paths should stay under AI Drafts unless a workflow has a specific approved target.');
    expect(hints).toContain('Explicit create-mode writeback must not overwrite an existing file; use append mode or a different target when the target exists.');
    expect(hints).toContain('Do not write markdown files directly from Agent code outside Workbench draft/proposal writeback.');
  });

  it('builds a Lattice execution profile without exposing PDF writes by default', () => {
    const workflow = getResearchAgentWorkflow('paper-reading');
    const profile = buildResearchAgentWorkflowExecutionProfile(workflow);
    const hints = buildResearchAgentWorkflowPlannerHints(workflow);

    expect(profile.workflowId).toBe('paper-reading');
    expect(profile.currentThreadSkills.map((skill) => skill.id)).toEqual(['path-identity', 'pdf-annotation']);
    expect(profile.readOnlySkills.map((skill) => skill.id)).toEqual(['path-identity']);
    expect(profile.approvalGatedSkills.map((skill) => skill.id)).toEqual(['pdf-annotation']);
    expect(profile.workspaceWriteSkills.map((skill) => skill.id)).toEqual(['pdf-annotation']);
    expect(profile.requiredCapabilities).toEqual([
      'lattice_read_identity',
      'search_workspace',
      'read_workspace',
      'resolve_evidence',
      'propose_write',
      'lattice_write_pdf_annotation',
    ]);
    expect(profile.reservedPdfSkills.map((skill) => skill.id)).toEqual(['pdf-item-workspace']);
    expect(profile.operationContracts.map((contract) => contract.id)).toEqual([
      'path-identity',
      'pdf-item-workspace',
      'pdf-annotation-sidecar',
    ]);
    expect(profile.noteConfig.fileNaming).toBe('pdf-title');
    expect(profile.plannerHints.join('\n')).toContain(
      'For AI highlights/underlines, propose a lattice-pdf-annotation draft with page, exact Quote, type, color, optional comment, and optional tags',
    );
    expect(hints).toContain('Current PDF item manifests are version 4 manifest.json files under .lattice/items/<generated-file-id>/');
    expect(hints).toContain('Universal annotation sidecars live at .lattice/annotations/<fileId>.json and currently normalize to version 3.');
    expect(hints).toContain('Do not write coordinates into _annotations.md drafts; exact Quote text is the trusted anchor.');
  });

  it('throws for unknown workflow ids', () => {
    expect(() => getResearchAgentWorkflow('unknown' as never)).toThrow('Unknown Research Agent workflow');
  });

  it('maps workflow families to restrained internal context budget profiles', () => {
    expect(getResearchAgentWorkflow('markdown-research').contextProfile.contextBudgetProfileId).toBe('research');
    expect(getResearchAgentWorkflow('reading-note').contextProfile.contextBudgetProfileId).toBe('research');
    expect(getResearchAgentWorkflow('literature-matrix').contextProfile.contextBudgetProfileId).toBe('knowledge-organization');
    expect(getResearchAgentWorkflow('knowledge-organization').contextProfile.contextBudgetProfileId).toBe('knowledge-organization');
    expect(getResearchAgentWorkflow('teaching-explain').contextProfile.contextBudgetProfileId).toBe('chat');
    expect(getResearchAgentWorkflow('notebook-from-paper').contextProfile.contextBudgetProfileId).toBe('notebook');
  });

  it('infers workflow presets from task, file, selection, and content cues', () => {
    expect(inferResearchAgentWorkflow({
      filePath: 'analysis/run.ipynb',
      task: 'Explain this output cell',
    })).toBe('notebook-analysis');
    expect(inferResearchAgentWorkflow({
      task: '解释这个笔记本里的代码单元输出和结果图',
    })).toBe('notebook-analysis');
    expect(inferResearchAgentWorkflow({
      task: 'Build a literature comparison matrix for these notes',
    })).toBe('literature-matrix');
    expect(inferResearchAgentWorkflow({
      task: '做一个文献综述表格，对比这些论文的实验方法',
    })).toBe('literature-matrix');
    expect(inferResearchAgentWorkflow({
      task: '整理这些笔记并建立链接',
    })).toBe('knowledge-organization');
    expect(inferResearchAgentWorkflow({
      task: '把这些材料组织成知识库结构并找出关联',
    })).toBe('knowledge-organization');
    expect(inferResearchAgentWorkflow({
      task: 'Teach this concept with examples and a quiz',
    })).toBe('teaching-explain');
    expect(inferResearchAgentWorkflow({
      task: '用通俗方式讲解这个概念，给出示例和常见误区',
    })).toBe('teaching-explain');
    expect(inferResearchAgentWorkflow({
      task: 'Create a reading note draft from this source',
    })).toBe('reading-note');
    expect(inferResearchAgentWorkflow({
      task: '根据这篇文章生成阅读笔记草稿并摘录关键证据',
    })).toBe('reading-note');
    expect(inferResearchAgentWorkflow({
      task: 'Summarize the selected markdown research context',
    })).toBe('markdown-research');
  });
});
