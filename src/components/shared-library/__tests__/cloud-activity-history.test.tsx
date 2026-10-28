import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CloudActivityHistory } from '../cloud-activity-history';
import type { CloudAuditEvent, CloudAuditPage } from '@/lib/shared-library/collaboration-audit';
vi.mock('@/hooks/use-i18n', () => ({ useI18n: () => ({ locale: 'zh-CN', formatDate: (value: string) => value }) }));
const entry = (id: string): CloudAuditEvent => ({ id, sequence: id, libraryId: 'library', actorId: 'actor', actorDisplayName: 'Alice', entityType: 'version', entityId: 'version', itemId: 'item', versionId: 'version', annotationId: null, action: 'created', targetLabel: 'paper.pdf', before: null, after: { version_number: 2 }, createdAt: '2026-10-27T00:00:00Z' });
describe('CloudActivityHistory', () => {
  it('shows actor, target, time, page controls and opens existing version history', async () => {
    const loadPage = vi.fn().mockResolvedValueOnce({ events: [entry('3')], nextCursor: '3', hasMore: true }).mockResolvedValueOnce({ events: [entry('2')], nextCursor: null, hasMore: false });
    const onOpenVersionHistory = vi.fn();
    render(<CloudActivityHistory libraryId="library" loadPage={loadPage} onOpenVersionHistory={onOpenVersionHistory} onClose={vi.fn()} />);
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.getByText('paper.pdf')).toBeTruthy();
    expect(screen.getByText('2026-10-27T00:00:00Z')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看内容版本' }));
    expect(onOpenVersionHistory).toHaveBeenCalledWith('item', 'version');
    fireEvent.click(screen.getByRole('button', { name: '加载更早记录' }));
    await waitFor(() => expect(screen.getAllByTestId('cloud-activity-event')).toHaveLength(2));
    expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: '3', limit: 30 }));
  });
  it('exposes load errors and retries', async () => {
    const loadPage = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ events: [], nextCursor: null, hasMore: false });
    render(<CloudActivityHistory libraryId="library" loadPage={loadPage} onClose={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('offline');
    fireEvent.click(screen.getByRole('button', { name: '刷新活动记录' }));
    expect(await screen.findByText('还没有活动记录')).toBeTruthy();
  });
  it('cancels the current request on unmount', async () => {
    let signal: AbortSignal | undefined;
    const loadPage = vi.fn((options: { signal?: AbortSignal }) => { signal = options.signal; return new Promise<CloudAuditPage>(() => {}); });
    const view = render(<CloudActivityHistory libraryId="library" loadPage={loadPage} onClose={vi.fn()} />);
    await waitFor(() => expect(loadPage).toHaveBeenCalledOnce());
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it('hides the previous library and ignores its late response after switching', async () => {
    let resolveOld!: (page: CloudAuditPage) => void;
    const oldPage = new Promise<CloudAuditPage>(resolve => { resolveOld = resolve; });
    const loadOld = vi.fn(() => oldPage);
    const loadNew = vi.fn(async () => ({ events: [], nextCursor: null, hasMore: false }));
    const view = render(<CloudActivityHistory libraryId="old" loadPage={loadOld} onClose={vi.fn()} />);
    view.rerender(<CloudActivityHistory libraryId="new" loadPage={loadNew} onClose={vi.fn()} />);
    expect(await screen.findByText('还没有活动记录')).toBeTruthy();
    resolveOld({ events: [entry('99')], nextCursor: null, hasMore: false });
    await waitFor(() => expect(screen.queryByText('Alice')).toBeNull());
  });
});
