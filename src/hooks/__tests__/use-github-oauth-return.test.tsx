import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitHubOAuthReturn } from '../use-github-oauth-return';
import { GITHUB_OAUTH_ATTEMPT_KEY } from '@/lib/shared-library/github-oauth-return';
import type { CloudLibraryWorkspaceController } from '@/lib/shared-library/cloud-workspace';

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), claim: vi.fn(), status: vi.fn(), state: { controller: null as unknown, setError: vi.fn(), setManagementOpen: vi.fn(), selectLibrary: vi.fn(async () => {}) } }));
vi.mock('@/lib/shared-library/github', () => ({ GitHubIntegrationClient: class { exchange = mocks.exchange; status = mocks.status; claim = mocks.claim; } }));
vi.mock('@/stores/cloud-workbench-store', () => ({ useCloudWorkbenchStore: { getState: () => mocks.state } }));
function callback() {
  const redirectUri = window.location.origin + '/';
  sessionStorage.setItem(GITHUB_OAUTH_ATTEMPT_KEY, JSON.stringify({ connectionId: 'cloud', userId: 'alice', libraryId: 'library', redirectUri, state: 'safe-state', expiresAt: new Date(Date.now() + 60000).toISOString() }));
  window.history.replaceState({}, '', '/?code=one-time-code&state=safe-state&keep=1');
}
function controller(userId = 'alice') {
  return { connection: { id: 'cloud' }, userId, transport: {}, refreshLibraries: vi.fn(async () => {}), getSnapshot: () => ({ libraries: [{ id: 'library' }] }) } as unknown as CloudLibraryWorkspaceController;
}
beforeEach(() => { mocks.exchange.mockReset().mockResolvedValue({ connected: true }); mocks.claim.mockReset().mockResolvedValue({ connected: true }); mocks.status.mockReset().mockResolvedValue({ connected: false }); mocks.state.controller = null; mocks.state.setError.mockClear(); mocks.state.setManagementOpen.mockClear(); sessionStorage.clear(); window.history.replaceState({}, '', '/'); });
afterEach(cleanup);
describe('GitHub OAuth return lifetime', () => {
  it('claims a server callback in the original logged-in desktop window without a local code', async () => {
    sessionStorage.setItem(GITHUB_OAUTH_ATTEMPT_KEY, JSON.stringify({ connectionId: 'cloud', userId: 'alice', libraryId: '', redirectUri: 'https://api.lattice.test/v1/integrations/github/callback', flow: 'server', returnTo: null, state: 'safe-state', expiresAt: new Date(Date.now() + 60000).toISOString() }));
    const matching = controller(); mocks.state.controller = matching;
    renderHook(() => useGitHubOAuthReturn(matching));
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledWith({ state: 'safe-state', connectionId: 'cloud' }));
    await waitFor(() => expect(matching.refreshLibraries).toHaveBeenCalledOnce());
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it('resumes a scrubbed callback after reloading before the matching cloud login exists', async () => {
    callback();
    const initial = renderHook(() => useGitHubOAuthReturn(null));
    expect(window.location.search).toBe('?keep=1'); initial.unmount();
    const matching = controller(); mocks.state.controller = matching;
    renderHook(() => useGitHubOAuthReturn(matching));
    await waitFor(() => expect(mocks.exchange).toHaveBeenCalledOnce());
    expect(mocks.exchange).toHaveBeenCalledWith({ code: 'one-time-code', state: 'safe-state', redirectUri: window.location.origin + '/' });
  });
  it('does not exchange or discard the pending callback for another account', async () => {
    callback(); const wrong = controller('bob'); mocks.state.controller = wrong;
    const initial = renderHook(() => useGitHubOAuthReturn(wrong));
    expect(mocks.exchange).not.toHaveBeenCalled(); initial.unmount();
    const matching = controller(); mocks.state.controller = matching;
    renderHook(() => useGitHubOAuthReturn(matching));
    await waitFor(() => expect(mocks.exchange).toHaveBeenCalledOnce());
  });
  it('keeps a retryable callback when the exchange fails before success', async () => {
    callback(); mocks.exchange.mockRejectedValueOnce(new Error('offline'));
    const matching = controller(); mocks.state.controller = matching;
    const initial = renderHook(() => useGitHubOAuthReturn(matching));
    await waitFor(() => expect(mocks.state.setError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' })));
    initial.unmount(); renderHook(() => useGitHubOAuthReturn(matching));
    await waitFor(() => expect(mocks.exchange).toHaveBeenCalledTimes(2));
  });
  it('checks identity status before replaying an exchange with a lost successful response', async () => {
    callback(); mocks.exchange.mockRejectedValueOnce(new Error('response lost'));
    const matching = controller(); mocks.state.controller = matching;
    const initial = renderHook(() => useGitHubOAuthReturn(matching));
    await waitFor(() => expect(mocks.state.setError).toHaveBeenCalled()); initial.unmount();
    mocks.status.mockResolvedValueOnce({ connected: true, requiresReauth: false });
    renderHook(() => useGitHubOAuthReturn(matching));
    await waitFor(() => expect(mocks.status).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.state.selectLibrary).toHaveBeenCalledWith('library'));
    expect(mocks.exchange).toHaveBeenCalledOnce();
  });
  it('clears a terminal exchange failure instead of replaying it after refresh', async () => {
    callback(); mocks.exchange.mockRejectedValueOnce(Object.assign(new Error('expired code'), { status: 400 }));
    const matching = controller(); mocks.state.controller = matching;
    const initial = renderHook(() => useGitHubOAuthReturn(matching));
    await waitFor(() => expect(mocks.state.setError).toHaveBeenCalled()); initial.unmount();
    renderHook(() => useGitHubOAuthReturn(matching));
    expect(mocks.exchange).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(GITHUB_OAUTH_ATTEMPT_KEY)).toBeNull();
  });
});
