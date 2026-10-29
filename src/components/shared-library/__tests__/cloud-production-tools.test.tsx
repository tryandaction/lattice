import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudProductionTools } from '../cloud-production-tools';
import { useCloudWorkbenchStore } from '@/stores/cloud-workbench-store';
import type { CloudLibraryWorkspaceController } from '@/lib/shared-library/cloud-workspace';
import { setLocale } from '@/lib/i18n';
vi.mock('../cloud-activity-history', () => ({ CloudActivityHistory: ({ inline, onOpenVersionHistory }: { inline?: boolean; onOpenVersionHistory: (itemId: string, versionId: string) => void }) => <button data-inline={String(inline)} onClick={() => onOpenVersionHistory('file', 'historical-v1')}>查看审计版本</button> }));
vi.mock('../cloud-github-panel', () => ({ CloudGitHubPanel: ({ onCreateLibrary, onLibraryConnected }: { onCreateLibrary?: (repository: { id: number; name: string; fullName: string; private: boolean; installationId: number; branch: string; permissions: { push: boolean; maintain: boolean; admin: boolean } }) => Promise<string>; onLibraryConnected?: (libraryId: string) => void | Promise<void> }) => <button type="button" onClick={async () => { const id = await onCreateLibrary?.({ id: 88, name: 'papers', fullName: 'lab/papers', private: true, installationId: 5, branch: 'main', permissions: { push: true, maintain: false, admin: false } }); if (id) await onLibraryConnected?.(id); }}>模拟从 GitHub 建库</button> }));
vi.mock('../cloud-team-ai-panel', () => ({ CloudTeamAiPanel: () => null }));
beforeEach(() => setLocale('zh-CN'));
afterEach(() => { cleanup(); setLocale('zh-CN'); });
function fixture(openItem = vi.fn(async () => true)) {
  const controller = { connection: { id: 'cloud' }, userId: 'alice', transport: {} } as unknown as CloudLibraryWorkspaceController;
  useCloudWorkbenchStore.setState({ controller, scope: 'account-a', libraryId: 'library', managementOpen: true, managementSection: 'activity', requestedVersionHistory: null, error: null, openItem });
  render(<CloudProductionTools controller={controller} libraryId="library" />);
  return { controller, openItem };
}
describe('production activity integration', () => {
  it('opens the requested file and exact historical version in an inline panel', async () => {
    const { openItem } = fixture();
    expect(screen.getByRole('button', { name: '查看审计版本' }).getAttribute('data-inline')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '查看审计版本' }));
    await waitFor(() => expect(useCloudWorkbenchStore.getState().managementOpen).toBe(false));
    expect(openItem).toHaveBeenCalledWith('file', { libraryId: 'library' });
    expect(useCloudWorkbenchStore.getState().requestedVersionHistory).toMatchObject({ scope: 'account-a', libraryId: 'library', itemId: 'file', versionId: 'historical-v1' });
  });
  it('does not open history or close the new account management after an old read resolves', async () => {
    let finish!: (opened: boolean) => void;
    fixture(vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })));
    fireEvent.click(screen.getByRole('button', { name: '查看审计版本' }));
    useCloudWorkbenchStore.setState({ controller: null, scope: null, requestedVersionHistory: null });
    finish(true);
    await waitFor(() => expect(useCloudWorkbenchStore.getState().requestedVersionHistory).toBeNull());
    expect(useCloudWorkbenchStore.getState().managementOpen).toBe(true);
  });
  it('keeps the activity panel open and reports inaccessible file history', async () => {
    fixture(vi.fn(async () => { throw new Error('历史文件已不可访问'); }));
    fireEvent.click(screen.getByRole('button', { name: '查看审计版本' }));
    await waitFor(() => expect(useCloudWorkbenchStore.getState().error).toBe('历史文件已不可访问'));
    expect(useCloudWorkbenchStore.getState().managementOpen).toBe(true);
    expect(useCloudWorkbenchStore.getState().requestedVersionHistory).toBeNull();
  });
});

describe('cloud library first-use actions', () => {
  it('localizes cloud tool navigation when the application language changes', () => {
    const controller = { connection: { id: 'cloud' }, userId: 'alice', transport: {} } as unknown as CloudLibraryWorkspaceController;
    useCloudWorkbenchStore.setState({ controller, scope: 'account-a', libraryId: 'library', managementOpen: true, managementSection: 'connection', role: 'owner' as never, error: null });
    render(<CloudProductionTools controller={controller} libraryId="library" />);
    const navigation = screen.getByRole('navigation', { name: '云库协作工具' });
    for (const name of ['成员与共享', '团队 AI', 'GitHub 仓库', '协作记录']) {
      expect(within(navigation).getByRole('button', { name })).toBeTruthy();
    }
    act(() => setLocale('en-US'));
    expect(screen.getByRole('navigation', { name: 'Cloud collaboration tools' })).toBe(navigation);
    for (const name of ['Members and sharing', 'Team AI', 'GitHub repository', 'Activity']) {
      expect(within(navigation).getByRole('button', { name })).toBeTruthy();
    }
    fireEvent.click(within(navigation).getByRole('button', { name: 'Activity' }));
    expect(useCloudWorkbenchStore.getState().managementSection).toBe('activity');

    act(() => setLocale('zh-CN'));
    expect(screen.getByRole('navigation', { name: '云库协作工具' })).toBe(navigation);
    expect(within(navigation).getByRole('button', { name: '协作记录' }).getAttribute('aria-pressed')).toBe('true');
    expect(useCloudWorkbenchStore.getState().managementSection).toBe('activity');
  });

  it('offers empty-library and GitHub creation paths and selects a linked repository library', async () => {
    const controller = { connection: { id: 'cloud' }, userId: 'alice', transport: {} } as unknown as CloudLibraryWorkspaceController;
    const onRequestCreateLibrary = vi.fn();
    const onCreateLibrary = vi.fn(async () => 'repo-library');
    const onLibraryConnected = vi.fn();
    useCloudWorkbenchStore.setState({ controller, scope: 'account-a', libraryId: '', managementOpen: true, managementSection: 'connection', role: 'owner' as never, error: null });
    render(<CloudProductionTools controller={controller} libraryId="" onRequestCreateLibrary={onRequestCreateLibrary} onCreateLibrary={onCreateLibrary} onLibraryConnected={onLibraryConnected} />);

    expect(screen.getByText('还没有云端库')).toBeTruthy();
    expect(screen.getByText('下一步 · 开始协作')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新建空库' }));
    expect(onRequestCreateLibrary).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '从 GitHub 创建云库' }));
    fireEvent.click(await screen.findByRole('button', { name: '模拟从 GitHub 建库' }));
    await waitFor(() => expect(onCreateLibrary).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'lab/papers' })));
    expect(onLibraryConnected).toHaveBeenCalledWith('repo-library');
  });

  it('exposes upload for an editable cloud library and sends users to the upload flow', () => {
    const controller = { connection: { id: 'cloud' }, userId: 'alice', transport: {} } as unknown as CloudLibraryWorkspaceController;
    const onOpenUpload = vi.fn();
    useCloudWorkbenchStore.setState({ controller, scope: 'account-a', libraryId: 'library', managementOpen: true, managementSection: 'connection', role: 'editor' as never, error: null });
    render(<CloudProductionTools controller={controller} libraryId="library" onOpenUpload={onOpenUpload} />);
    fireEvent.click(screen.getByRole('button', { name: '上传到云端库' }));
    expect(onOpenUpload).toHaveBeenCalledTimes(1);
  });
});
