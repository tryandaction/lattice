"use client";

import { useEffect, useRef, useState } from 'react';
import { GitHubIntegrationClient } from '@/lib/shared-library/github';
import { GITHUB_OAUTH_ATTEMPT_KEY, GITHUB_OAUTH_RETURN_KEY, GITHUB_OAUTH_STARTED_EVENT, parseGitHubOAuthReturn, readGitHubOAuthAttempt, readGitHubOAuthPendingReturn, type GitHubOAuthPendingReturn } from '@/lib/shared-library/github-oauth-return';
import type { CloudLibraryWorkspaceController } from '@/lib/shared-library/cloud-workspace';
import { useCloudWorkbenchStore } from '@/stores/cloud-workbench-store';

export function useGitHubOAuthReturn(controller: CloudLibraryWorkspaceController | null) {
  const pending = useRef<GitHubOAuthPendingReturn | null>(null);
  const processing = useRef(false);
  const [identityRevision, setIdentityRevision] = useState(0);
  useEffect(() => {
    function receive() {
    try {
      let callback = readGitHubOAuthPendingReturn(sessionStorage.getItem(GITHUB_OAUTH_RETURN_KEY));
      if (callback && callback.attempt.flow !== 'server' && new URL(callback.attempt.redirectUri).origin !== window.location.origin) callback = null;
      if (!callback) sessionStorage.removeItem(GITHUB_OAUTH_RETURN_KEY);
      const attempt = readGitHubOAuthAttempt(sessionStorage.getItem(GITHUB_OAUTH_ATTEMPT_KEY));
      if (attempt) {
        const result = parseGitHubOAuthReturn(window.location.href, attempt);
        if (result.callback) {
          callback = { attempt, ...result.callback, exchangeStarted: false };
          // Persist before URL cleanup, so reloading while login recovers cannot lose the code.
          sessionStorage.setItem(GITHUB_OAUTH_RETURN_KEY, JSON.stringify(callback));
        }
        if (result.cleanUrl !== window.location.href) history.replaceState(history.state, '', result.cleanUrl);
        if (result.error) { sessionStorage.removeItem(GITHUB_OAUTH_ATTEMPT_KEY); sessionStorage.removeItem(GITHUB_OAUTH_RETURN_KEY); callback = null; useCloudWorkbenchStore.getState().setError(result.error); useCloudWorkbenchStore.getState().setManagementOpen(true, 'github'); }
        if (!callback && !result.error && attempt.flow === 'server') callback = { attempt, state: attempt.state, exchangeStarted: false };
      }
      if (callback) { pending.current = callback; useCloudWorkbenchStore.getState().setManagementOpen(true, 'github'); }
      setIdentityRevision(value => value + 1);
    } catch { useCloudWorkbenchStore.getState().setError('GitHub 授权返回无效，请重新连接。'); }
    }
    receive();
    const start = () => { receive(); setIdentityRevision(value => value + 1); };
    window.addEventListener(GITHUB_OAUTH_STARTED_EVENT, start);
    return () => window.removeEventListener(GITHUB_OAUTH_STARTED_EVENT, start);
  }, []);
  useEffect(() => {
    const callback = pending.current;
    if (!controller || !callback || processing.current) return;
    const activeController = controller;
    if (activeController.connection.id !== callback.attempt.connectionId || activeController.userId !== callback.attempt.userId) { useCloudWorkbenchStore.getState().setError('请登录发起 GitHub 授权的云库账号后继续。'); return; }
    function clear() {
      if (pending.current?.state === callback!.state) pending.current = null;
      if (readGitHubOAuthPendingReturn(sessionStorage.getItem(GITHUB_OAUTH_RETURN_KEY))?.state === callback!.state) sessionStorage.removeItem(GITHUB_OAUTH_RETURN_KEY);
      if (readGitHubOAuthAttempt(sessionStorage.getItem(GITHUB_OAUTH_ATTEMPT_KEY))?.state === callback!.state) sessionStorage.removeItem(GITHUB_OAUTH_ATTEMPT_KEY);
    }
    const client = new GitHubIntegrationClient(activeController.transport);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    async function complete() {
      const resume = callback!.exchangeStarted;
      processing.current = true; callback!.exchangeStarted = true;
      sessionStorage.setItem(GITHUB_OAUTH_RETURN_KEY, JSON.stringify(callback));
      try {
      // A lost successful response must not replay a consumed authorization code.
      const alreadyConnected = resume ? await client.status() : null;
      if (!alreadyConnected?.connected || alreadyConnected.requiresReauth) {
        if (callback!.attempt.flow === 'server') {
          const result = await client.claim({ state: callback!.state, connectionId: callback!.attempt.connectionId });
          if ('pending' in result) {
            callback!.exchangeStarted = false;
            sessionStorage.setItem(GITHUB_OAUTH_RETURN_KEY, JSON.stringify(callback));
            if (Date.parse(callback!.attempt.expiresAt) <= Date.now()) throw Object.assign(new Error('GitHub 授权等待已过期，请重新连接。'), { status: 400 });
            if (active) timer = setTimeout(() => void complete(), 2000);
            return;
          }
        } else await client.exchange({ code: callback!.code!, state: callback!.state, redirectUri: callback!.attempt.redirectUri });
      }
      clear();
      if (useCloudWorkbenchStore.getState().controller !== activeController) return;
      await activeController.refreshLibraries();
      const libraryId = callback!.attempt.libraryId || activeController.getSnapshot().libraries[0]?.id;
      if (useCloudWorkbenchStore.getState().controller !== activeController) return;
      if (libraryId) await useCloudWorkbenchStore.getState().selectLibrary(libraryId);
      if (useCloudWorkbenchStore.getState().controller === activeController) useCloudWorkbenchStore.getState().setManagementOpen(true, 'github');
      } catch (cause) {
      const status = (cause as { status?: number }).status;
      if (typeof status === 'number' && status >= 400 && status < 500) clear();
      if (useCloudWorkbenchStore.getState().controller === activeController) useCloudWorkbenchStore.getState().setError(cause);
      if (active && pending.current && callback!.attempt.flow === 'server') timer = setTimeout(() => void complete(), 3000);
      } finally { processing.current = false; if (pending.current && useCloudWorkbenchStore.getState().controller !== activeController) setIdentityRevision(value => value + 1); }
    }
    void complete();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [controller, identityRevision]);
}
