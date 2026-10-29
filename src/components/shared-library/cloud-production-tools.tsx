"use client";

import { useCallback, useMemo } from 'react';
import { Github, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/hooks/use-i18n';
import type { CloudLibraryWorkspaceController } from '@/lib/shared-library/cloud-workspace';
import type { GitHubRepository } from '@/lib/shared-library/github';
import { cloudTeamAiClient } from '@/lib/shared-library/cloud-team-ai';
import { useCloudWorkbenchStore } from '@/stores/cloud-workbench-store';
import { listCloudActivity } from '@/lib/shared-library/collaboration-audit';
import { can } from '@/lib/shared-library/permissions';
import { CloudActivityHistory } from './cloud-activity-history';
import { CloudTeamAiPanel } from './cloud-team-ai-panel';
import { CloudGitHubPanel } from './cloud-github-panel';

export function CloudProductionTools({ controller, libraryId, onRequestCreateLibrary, onRequestJoinLibrary, onCreateLibrary, onLibraryConnected, onOpenUpload }: {
  controller: CloudLibraryWorkspaceController;
  libraryId: string;
  onRequestCreateLibrary?: () => void;
  onRequestJoinLibrary?: () => void;
  onCreateLibrary?: (repository: GitHubRepository) => Promise<string>;
  onLibraryConnected?: (libraryId: string) => void | Promise<void>;
  onOpenUpload?: () => void;
}) {
  const { t } = useI18n();
  const section = useCloudWorkbenchStore(state => state.managementSection);
  const source = useCloudWorkbenchStore(state => state.teamAiSource);
  const role = useCloudWorkbenchStore(state => state.role);
  const ai = useMemo(() => cloudTeamAiClient(controller.transport, libraryId), [controller, libraryId]);
  const loadActivity = useCallback((options: { cursor?: string; limit?: number; signal?: AbortSignal }) => listCloudActivity(controller.transport, libraryId, options), [controller, libraryId]);
  async function openHistory(itemId: string, versionId?: string) {
    try {
      const current = useCloudWorkbenchStore.getState();
      if (current.controller !== controller || current.libraryId !== libraryId) return;
      const opened = await current.openItem(itemId, { libraryId });
      const latest = useCloudWorkbenchStore.getState();
      if (!opened || latest.controller !== controller || latest.libraryId !== libraryId) return;
      latest.requestVersionHistory(libraryId, itemId, versionId); latest.setManagementOpen(false);
    } catch (cause) { if (useCloudWorkbenchStore.getState().controller === controller) useCloudWorkbenchStore.getState().setError(cause); }
  }
  return <div className="border-t border-border">
    {!libraryId ? <section className="space-y-2 px-3 py-3" aria-labelledby="cloud-first-library-title">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('cloud.onboarding.firstUseStep')}</p>
      <h3 id="cloud-first-library-title" className="text-sm font-medium">{t('cloud.onboarding.emptyTitle')}</h3>
      <p className="text-xs text-muted-foreground">{t('cloud.onboarding.emptyDescription')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!onRequestCreateLibrary} onClick={onRequestCreateLibrary}>{t('cloud.onboarding.createLibrary')}</Button>
        <Button size="sm" variant="outline" disabled={!onRequestJoinLibrary} onClick={onRequestJoinLibrary}>{t('cloud.onboarding.joinInvitation')}</Button>
        <Button size="sm" variant="outline" onClick={() => useCloudWorkbenchStore.getState().setManagementOpen(true, 'github')}><Github className="size-3.5" />{t('cloud.onboarding.connectGitHub')}</Button>
      </div>
    </section> : <div className="flex justify-end px-3 pt-2">
      <Button size="sm" variant="outline" disabled={!role || !can(role, 'item.create') || !onOpenUpload} onClick={onOpenUpload}><Upload className="size-3.5" />{t('cloud.upload.title')}</Button>
    </div>}
    <nav aria-label={t('cloud.tools.navigation')} className="flex flex-wrap gap-1 px-3 py-2">
      {(['members', 'ai', 'github', 'activity'] as const).map((id, index) => <button key={id} type="button" disabled={!libraryId && id !== 'github'} aria-pressed={section === id} className={`rounded px-2 py-1 text-xs disabled:opacity-40 ${section === id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'}`} onClick={() => useCloudWorkbenchStore.getState().setManagementOpen(true, id)}>{[t('cloud.tools.members'), t('cloud.tools.ai'), t('cloud.tools.github'), t('cloud.tools.activity')][index]}</button>)}
    </nav>
    {section === 'ai' && libraryId ? <CloudTeamAiPanel key={`${controller.connection.id}:${controller.userId}:${libraryId}:${role}`} loadProviders={ai.loadProviders} send={ai.send} source={source} canManage={role === 'owner' || role === 'admin'} loadConfig={ai.loadConfig} saveConfig={ai.saveConfig} deleteProvider={ai.deleteProvider} /> : null}
    {section === 'github' ? <CloudGitHubPanel key={`${controller.connection.id}:${controller.userId}:${libraryId}`} controller={controller} libraryId={libraryId || undefined} role={role ?? undefined} onCreateLibrary={!libraryId ? onCreateLibrary : undefined} onLibraryConnected={onLibraryConnected} /> : null}
    {section === 'activity' && libraryId ? <CloudActivityHistory key={libraryId} inline libraryId={libraryId} loadPage={loadActivity} onOpenVersionHistory={(itemId, versionId) => { void openHistory(itemId, versionId); }} onClose={() => useCloudWorkbenchStore.getState().setManagementOpen(true, 'connection')} /> : null}
  </div>;
}
