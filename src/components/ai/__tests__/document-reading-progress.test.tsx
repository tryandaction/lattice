/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { setLocale } from '@/lib/i18n';
import type { AgentSession } from '@/lib/ai/agent-session';
import type { DocumentCoverageEntry } from '@/lib/ai/document-research';
import type { DirectoryResearchCheckpoint, DirectoryResearchFile } from '@/lib/ai/directory-research';

const stores = vi.hoisted(() => ({
  sessions: [] as AgentSession[],
  isGenerating: false,
  setComposerDraft: vi.fn(),
}));

vi.mock('@/stores/agent-session-store', () => ({
  useAgentSessionStore: (selector: (state: typeof stores) => unknown) => selector(stores),
}));
vi.mock('@/stores/ai-chat-store', () => ({
  useAiChatStore: (selector: (state: typeof stores) => unknown) => selector(stores),
}));

import { DocumentReadingProgress } from '../document-reading-progress';

function coverage(overrides: Partial<DocumentCoverageEntry> = {}): DocumentCoverageEntry {
  return {
    path: 'papers/study.pdf', kind: 'pdf', unitLabel: 'page', totalUnits: 5,
    readUnits: [1, 2], pendingUnits: [3, 4, 5], emptyUnits: [], unreadableUnits: [],
    ...overrides,
  };
}

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'reading-1', profile: 'research', title: 'Read paper', task: '全文阅读并批注',
    status: 'cancelled', createdAt: 1, updatedAt: 1, trace: [], evidenceRefs: [],
    approvalRequestIds: [], pendingApprovals: [], compactions: [],
    documentResearch: {
      status: 'paused', checkpoint: {
        version: 1, queryKey: '["task","question"]', sources: [], summaries: [], findings: [],
        coverage: [coverage()], completedBatches: 2,
      },
    },
    ...overrides,
  };
}

function directory(files: DirectoryResearchFile[], overrides: Partial<DirectoryResearchCheckpoint> = {}): DirectoryResearchCheckpoint {
  return { version: 2, workspaceKey: 'A', selections: [{ kind: 'folder', path: 'papers' }], task: '阅读所有论文', query: '说明内容',
    files, reductions: [], removedPaths: [], calls: 1, phase: 'paused', manifest: { version: 1, workspaceKey: 'A', selections: [{ kind: 'folder', path: 'papers' }], roots: [{ kind: 'folder', path: 'papers' }],
      files: files.map(file => ({ path: file.path, size: file.size, lastModified: file.lastModified, supported: true })), directories: [], pendingDirectories: [], complete: true,
      revision: 1, changedPaths: [], removedPaths: [] }, ...overrides };
}
const directoryFile = (path: string, status: DirectoryResearchFile['status']): DirectoryResearchFile => ({ path, status, size: 10, lastModified: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  setLocale('zh-CN');
  stores.sessions = [session()];
  stores.isGenerating = false;
});

describe('DocumentReadingProgress', () => {
  it('keeps unopened directory files in progress and offers continuation when opened coverage is complete', () => {
    stores.sessions[0].documentResearch!.checkpoint.coverage = [coverage({ readUnits: [1, 2, 3, 4, 5], pendingUnits: [] })];
    stores.sessions[0].documentResearch!.directory = directory([directoryFile('papers/first.pdf', 'complete'), directoryFile('papers/unopened.pdf', 'pending')]);
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).not.toContain('全部正文已分析');
    expect(screen.getByTestId('directory-reading-counts').textContent).toContain('已发现 2 个可读文件');
    expect(screen.getByTestId('directory-reading-counts').textContent).toContain('待处理 1');
    const progress = screen.getByRole('progressbar') as HTMLProgressElement;
    expect(progress.value).toBe(1); expect(progress.max).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: '继续目录阅读与汇总' }));
    expect(stores.setComposerDraft).toHaveBeenCalledWith(expect.objectContaining({ continuation: { sourceSessionId: 'reading-1', documentResume: true } }));
    const details = screen.getByText('覆盖范围与剩余材料').closest('details')!;
    details.open = true; fireEvent(details, new Event('toggle'));
    expect(screen.getByText(/papers\/unopened.pdf/).textContent).toContain('待处理');
  });

  it.each(['zh-CN', 'en-US'] as const)('does not call two failed files all complete and offers retry (%s)', locale => {
    setLocale(locale);
    stores.sessions[0].status = 'completed'; stores.sessions[0].documentResearch!.status = 'ready';
    stores.sessions[0].documentResearch!.checkpoint.coverage = [coverage({ readUnits: [1, 2, 3, 4, 5], pendingUnits: [] })];
    stores.sessions[0].documentResearch!.directory = directory([directoryFile('good.pdf', 'complete'), directoryFile('broken1.pdf', 'failed'), directoryFile('broken2.pdf', 'failed')], { phase: 'ready' });
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).not.toMatch(/全部正文已分析|All text analyzed/);
    expect(screen.getByTestId('directory-reading-counts').textContent).toMatch(locale === 'zh-CN' ? /失败 2/ : /failed 2/);
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(1);
    expect((screen.getByRole('progressbar') as HTMLProgressElement).max).toBe(3);
    expect(screen.getByRole('button', { name: locale === 'zh-CN' ? '重试未读文件并继续汇总' : 'Retry unread files and continue summary' })).toBeTruthy();
  });

  it('keeps no-text files separate and retryable without classifying them as read', () => {
    stores.sessions[0].status = 'completed'; stores.sessions[0].documentResearch!.status = 'ready';
    stores.sessions[0].documentResearch!.checkpoint.coverage = [];
    stores.sessions[0].documentResearch!.directory = directory([directoryFile('scan.pdf', 'no_text')], { phase: 'ready' });
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByTestId('directory-reading-counts').textContent).toContain('无文本 1');
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(0);
    expect(screen.getByRole('button', { name: '重试未读文件并继续汇总' })).toBeTruthy();
  });

  it('distinguishes discovery, reduction, evidence gaps and final completion', () => {
    stores.isGenerating = true; stores.sessions[0].status = 'running'; stores.sessions[0].documentResearch!.status = 'reading';
    const state = directory([directoryFile('read.pdf', 'complete')], { phase: 'discovering' });
    state.manifest!.complete = false;
    stores.sessions[0].documentResearch!.directory = state;
    const view = render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('正在发现目录文件');
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBeLessThan((screen.getByRole('progressbar') as HTMLProgressElement).max);
    state.phase = 'reducing'; state.manifest!.complete = true;
    view.rerender(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('正在汇总目录笔记');
    expect(screen.queryByRole('button')).toBeNull();
    stores.isGenerating = false; stores.sessions[0].status = 'completed'; stores.sessions[0].documentResearch!.status = 'ready'; state.phase = 'ready';
    stores.sessions[0].documentResearch!.checkpoint.evidenceIssues = [{ batch: 1, finding: 1, code: 'unverified_quote' }];
    view.rerender(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('证据存在缺口');
    expect(screen.getByRole('status').textContent).not.toContain('目录阅读与汇总已完成');
    stores.sessions[0].documentResearch!.checkpoint.evidenceIssues = [];
    view.rerender(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('目录阅读与汇总已完成');
  });

  it('continues pending reduction even after all directory file content was read', () => {
    stores.sessions[0].documentResearch!.checkpoint.coverage = [coverage({ readUnits: [1, 2, 3, 4, 5], pendingUnits: [] })];
    stores.sessions[0].documentResearch!.directory = directory([directoryFile('read.pdf', 'complete')], { phase: 'paused' });
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('button', { name: '继续目录阅读与汇总' })).toBeTruthy();
  });

  it('does not mount thousands of hidden file rows before the directory details are expanded', () => {
    stores.sessions[0].documentResearch!.directory = directory(Array.from({ length: 2000 }, (_, index) => directoryFile(`papers/${index}.pdf`, 'pending')));
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.queryByText(/papers\/1999.pdf/)).toBeNull();
    const details = screen.getByText('覆盖范围与剩余材料').closest('details')!;
    details.open = true; fireEvent(details, new Event('toggle'));
    expect(screen.getByText(/papers\/1999.pdf/)).toBeTruthy();
    details.open = false; fireEvent(details, new Event('toggle'));
    expect(screen.queryByText(/papers\/1999.pdf/)).toBeNull();
  });

  it('shows a paused checkpoint, omits stale processing state, and resumes the same task', () => {
    stores.sessions[0].documentResearch!.checkpoint.coverage[0].currentUnit = 3;
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('已暂停');
    expect(screen.queryByText(/正在处理/)).toBeNull();
    const progress = screen.getByRole('progressbar') as HTMLProgressElement;
    expect(progress.value).toBe(2);
    expect(progress.max).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: '继续剩余阅读' }));
    expect(stores.setComposerDraft).toHaveBeenCalledWith({
      text: '全文阅读并批注', mode: 'agent', submit: true,
      continuation: { sourceSessionId: 'reading-1', documentResume: true },
    });
  });

  it('restarts the original task sources without reusing its checkpoint', () => {
    render(<DocumentReadingProgress sessionId="reading-1" />);
    fireEvent.click(screen.getByRole('button', { name: '从头重新读取' }));
    expect(stores.setComposerDraft).toHaveBeenCalledWith({
      text: '全文阅读并批注', mode: 'agent', submit: true,
      continuation: { sourceSessionId: 'reading-1', documentRestart: true },
    });
  });

  it('does not mark an older paused task as reading when another chat is generating', () => {
    stores.isGenerating = true;
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('已暂停');
    expect(screen.getByRole('status').textContent).not.toContain('正在阅读');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('distinguishes reading from synthesis and does not allow a competing run', () => {
    stores.isGenerating = true;
    stores.sessions[0].status = 'running';
    stores.sessions[0].documentResearch!.status = 'reading';
    stores.sessions[0].documentResearch!.checkpoint.coverage[0].currentUnit = 3;
    const view = render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('正在阅读');
    expect(screen.getByText(/正在处理.*3/)).toBeTruthy();
    stores.sessions[0].documentResearch!.status = 'ready';
    view.rerender(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('正在汇总');
    expect(screen.queryByText(/正在处理/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows read failures and empty pages separately without counting either as analyzed', () => {
    stores.sessions[0].documentResearch!.checkpoint.coverage = [coverage({
      pendingUnits: [5], emptyUnits: [3], unreadableUnits: [{ unit: 4, reason: 'Extract failed' }],
    })];
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('2/5');
    expect(screen.getByText(/1 页\/节没有可提取正文/)).toBeTruthy();
    expect(screen.getByText(/待阅读.*1/)).toBeTruthy();
    expect(screen.getByText(/读取失败.*4/)).toBeTruthy();
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(2);
  });

  it('keeps synthesis failures recoverable after all pages were read and displays the actual error', () => {
    stores.sessions[0].status = 'failed';
    stores.sessions[0].error = 'Provider returned invalid annotation JSON';
    stores.sessions[0].documentResearch!.status = 'ready';
    stores.sessions[0].documentResearch!.checkpoint.coverage = [coverage({
      readUnits: [1, 2, 3, 4, 5], pendingUnits: [],
    })];
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('生成结果失败');
    expect(screen.getByRole('alert').textContent).toContain('Provider returned invalid annotation JSON');
    expect(screen.getByRole('button', { name: '重新生成结果' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '继续剩余阅读' })).toBeNull();
  });

  it('offers continued reading for unreadable units even when the pending queue is empty', () => {
    stores.sessions[0].status = 'failed';
    stores.sessions[0].documentResearch!.status = 'failed';
    stores.sessions[0].documentResearch!.error = 'PDF extraction failed';
    stores.sessions[0].documentResearch!.checkpoint.coverage = [coverage({
      readUnits: [1, 2, 3, 4], pendingUnits: [], unreadableUnits: [{ unit: 5 }],
    })];
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('阅读中断');
    expect(screen.getByRole('alert').textContent).toBe('PDF extraction failed');
    expect(screen.getByRole('button', { name: '继续剩余阅读' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重新生成结果' })).toBeNull();
  });

  it('does not bypass pending approvals with a resume action', () => {
    stores.sessions[0].status = 'waiting_approval';
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('等待审批');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not claim full coverage when no extractable text remains', () => {
    stores.sessions[0].status = 'completed';
    stores.sessions[0].documentResearch!.status = 'ready';
    stores.sessions[0].documentResearch!.checkpoint.coverage = [coverage({
      readUnits: [], pendingUnits: [], emptyUnits: [1, 2, 3, 4, 5],
    })];
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('正文覆盖不完整');
    expect(screen.getByRole('status').textContent).not.toContain('全部正文已分析');
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(0);
  });

  it('reports complete coverage only after all text units are analyzed', () => {
    stores.sessions[0].status = 'completed';
    stores.sessions[0].documentResearch!.status = 'ready';
    stores.sessions[0].documentResearch!.checkpoint.coverage = [coverage({
      readUnits: [1, 2, 3, 4, 5], pendingUnits: [],
    })];
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('全部正文已分析');
    expect(screen.queryByRole('button')).toBeNull();
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(5);
  });

  it.each(['zh-CN', 'en-US'] as const)('discloses evidence gaps when every page was read (%s)', (locale) => {
    setLocale(locale);
    stores.sessions[0].status = 'completed';
    stores.sessions[0].documentResearch!.status = 'ready';
    stores.sessions[0].documentResearch!.checkpoint.coverage = [coverage({ readUnits: [1, 2, 3, 4, 5], pendingUnits: [] })];
    stores.sessions[0].documentResearch!.checkpoint.evidenceIssues = [{ batch: 2, finding: 1, code: 'unverified_quote', sourcePath: 'papers/study.pdf', unit: 3 }];
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toMatch(locale === 'zh-CN' ? /证据.*缺口/ : /evidence.*gap/i);
    expect(screen.getByText(locale === 'zh-CN' ? /1 条.*未通过原文校验.*已排除/ : /1 finding.*failed source verification.*excluded/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(5);
  });

  it('localizes mixed PDF and Markdown coverage without concealing full source paths', () => {
    setLocale('en-US');
    stores.sessions[0].documentResearch!.checkpoint.coverage.push(coverage({
      path: 'notes/study.md', kind: 'markdown', unitLabel: 'section', totalUnits: 2,
      readUnits: [1], pendingUnits: [2],
    }));
    render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(screen.getByRole('status').textContent).toContain('Paused');
    expect(screen.getByRole('status').textContent).toContain('3/7');
    expect(screen.getByText(/notes\/study.md/).textContent).toContain('sections');
    expect(screen.getByRole('button', { name: 'Continue remaining reading' })).toBeTruthy();
  });

  it('renders nothing without a document checkpoint', () => {
    stores.sessions = [session({ documentResearch: undefined })];
    const { container } = render(<DocumentReadingProgress sessionId="reading-1" />);
    expect(container.textContent).toBe('');
  });
});
