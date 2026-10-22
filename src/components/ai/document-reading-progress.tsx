"use client";

import { useI18n } from '@/hooks/use-i18n';
import { useState } from 'react';
import type { TranslationKey } from '@/lib/i18n';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useAiChatStore } from '@/stores/ai-chat-store';

export function DocumentReadingProgress({ sessionId, requestMode = 'agent', reportedError }: { sessionId: string; requestMode?: 'chat' | 'agent'; reportedError?: string }) {
  const { t, locale } = useI18n();
  const session = useAgentSessionStore(state => state.sessions.find(item => item.id === sessionId));
  const generating = useAiChatStore(state => state.isGenerating);
  const setDraft = useAiChatStore(state => state.setComposerDraft);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const state = session?.documentResearch;
  if (!session || !state) return null;
  const directory = state.directory;
  const coverage = state.checkpoint.coverage;
  const total = coverage.reduce((sum, item) => sum + item.totalUnits, 0);
  const read = coverage.reduce((sum, item) => sum + item.readUnits.length, 0);
  const pending = coverage.reduce((sum, item) => sum + item.pendingUnits.length, 0);
  const unreadable = coverage.reduce((sum, item) => sum + item.unreadableUnits.length, 0);
  const noText = coverage.reduce((sum, item) => sum + item.emptyUnits.length, 0);
  const evidenceIssues = state.checkpoint.evidenceIssues ?? [];
  const evidenceGapLabel = locale === 'zh-CN' ? '证据存在缺口' : 'Evidence gaps remain';
  const evidenceGapMessage = locale === 'zh-CN'
    ? `${evidenceIssues.length} 条发现未通过原文校验，已排除；已读页数不代表所有证据均已核实。`
    : `${evidenceIssues.length} finding(s) failed source verification and were excluded; reading coverage does not mean all evidence was verified.`;
  const remaining = pending + unreadable;
  const directoryCounts = directory?.files.reduce((counts, file) => {
    counts[file.status]++;
    return counts;
  }, { pending: 0, reading: 0, complete: 0, failed: 0, no_text: 0 });
  const discoveryComplete = Boolean(directory?.manifest?.complete);
  const directoryUnread = directoryCounts ? directoryCounts.pending + directoryCounts.reading : 0;
  const directoryRetryable = directoryCounts ? directoryCounts.failed + directoryCounts.no_text : 0;
  const directoryHasWork = Boolean(directory && (!discoveryComplete || directoryUnread || directoryRetryable || directory.phase !== 'ready'));
  const directoryComplete = Boolean(directory && discoveryComplete && directory.files.length > 0 && !directoryHasWork && !evidenceIssues.length);
  const failed = state.status === 'failed' || session.status === 'failed';
  const awaitingApproval = session.status === 'waiting_approval'
    || session.pendingApprovals.some(item => item.status === 'pending' || item.status === 'executing');
  const running = generating && session.status === 'running' && !failed && !awaitingApproval;
  const reading = running && state.status === 'reading';
  const canResume = !generating && !awaitingApproval
    && (remaining > 0 || directoryHasWork || failed || session.status === 'cancelled');
  let statusKey: TranslationKey;
  if (awaitingApproval) statusKey = 'chat.agentTrace.status.waitingApproval';
  else if (failed) statusKey = remaining > 0 || directory && (!discoveryComplete || directoryUnread || directoryRetryable) ? 'chat.documentReading.readFailed' : 'chat.documentReading.synthesisFailed';
  else if (running && directory?.phase === 'discovering') statusKey = 'chat.documentReading.directory.discovering';
  else if (running && directory?.phase === 'reducing') statusKey = 'chat.documentReading.directory.reducing';
  else if (running && state.status === 'ready') statusKey = 'chat.documentReading.synthesizing';
  else if (reading) statusKey = 'chat.documentReading.reading';
  else if (state.status === 'paused' || session.status === 'cancelled') statusKey = 'chat.documentReading.paused';
  else statusKey = directory ? directoryComplete ? 'chat.documentReading.directory.complete' : 'chat.documentReading.partial'
    : total > 0 && read === total ? 'chat.documentReading.complete' : 'chat.documentReading.partial';
  const error = failed ? state.error || session.error : undefined;
  const resumeKey: TranslationKey = directory && directoryRetryable ? 'chat.documentReading.directory.retry'
    : directory && directoryHasWork ? 'chat.documentReading.directory.resume' : remaining ? 'chat.documentReading.resume' : 'chat.documentReading.regenerate';
  const coverageByPath = new Map(coverage.map(item => [item.path, item]));
  const fileEntries = directory ? detailsOpen ? directory.files.map(file => ({ ...file, coveragePath: file.snapshot?.path ?? file.path })) : []
    : coverage.map(item => ({ path: item.path, coveragePath: item.path, status: undefined }));

  return <section className="my-2 rounded border border-border/60 px-2 py-1.5 text-[11px]" data-testid="document-reading-progress">
    <div role="status">{t(statusKey)}{evidenceIssues.length > 0 ? ` · ${evidenceGapLabel}` : ''} · {t(directory ? 'chat.documentReading.directory.unitSummary' : 'chat.documentReading.summary', { read, total, files: coverage.length, batches: state.checkpoint.completedBatches })}</div>
    {directory && directoryCounts && <p data-testid="directory-reading-counts" className="text-muted-foreground">
      {t('chat.documentReading.directory.counts', { discovered: directory.files.length, read: directoryCounts.complete, pending: directoryUnread, failed: directoryCounts.failed, noText: directoryCounts.no_text })}
      {' · '}{t(discoveryComplete ? 'chat.documentReading.directory.discoveryComplete' : 'chat.documentReading.directory.discoveryPending')}
    </p>}
    <progress className={`my-1 h-1 w-full${directory && !directoryComplete ? ' accent-amber-600' : ''}`} value={directory ? discoveryComplete ? directoryCounts!.complete : undefined : read}
      max={Math.max(1, directory ? directory.files.length : total)} aria-label={t(directory ? 'chat.documentReading.directory.coverageLabel' : 'chat.documentReading.coverageLabel')} />
    {error && error !== reportedError && <p role="alert" className="break-words text-destructive">{error}</p>}
    {evidenceIssues.length > 0 && <p className="text-amber-700 dark:text-amber-400">{evidenceGapMessage}</p>}
    {noText > 0 && <p className="text-muted-foreground">{t('chat.documentReading.noText', { count: noText })}</p>}
    <details className="text-muted-foreground" onToggle={event => setDetailsOpen(event.currentTarget.open)}><summary className="cursor-pointer">{t('chat.documentReading.details')}</summary>
      {fileEntries.map(file => {
        const item = coverageByPath.get(file.coveragePath);
        return <div key={file.path} className="mt-1 break-words" style={{ contentVisibility: 'auto' }}>
          <p>{file.path}{file.status && <> · {t(`chat.documentReading.directory.file.${file.status}`)}</>}
            {item && <> · {item.readUnits.length}/{item.totalUnits} {t(item.unitLabel === 'page' ? 'chat.documentReading.pages' : 'chat.documentReading.sections')}</>}</p>
          {item && <>
            {item.pendingUnits.length > 0 && <p>{t('chat.documentReading.pending', { count: item.pendingUnits.length })}</p>}
            {reading && item.currentUnit && <p>{t('chat.documentReading.currentUnit', { unit: item.currentUnit })}</p>}
            {item.emptyUnits.length > 0 && <p>{t('chat.documentReading.emptyUnits', { units: item.emptyUnits.join(', ') })}</p>}
            {item.unreadableUnits.length > 0 && <p>{t('chat.documentReading.unreadableUnits', { units: item.unreadableUnits.map(value => value.unit).join(', ') })}</p>}
          </>}
        </div>;
      })}
    </details>
    {canResume && <div className="mt-2 flex gap-3">
      <button type="button" className="text-primary underline" data-testid="document-reading-resume" onClick={() => setDraft({ text: session.task, mode: requestMode, continuation: { sourceSessionId: session.id, documentResume: true }, submit: true })}>{t(resumeKey)}</button>
      <button type="button" className="text-muted-foreground underline" data-testid="document-reading-restart" onClick={() => setDraft({ text: session.task, mode: requestMode, continuation: { sourceSessionId: session.id, documentRestart: true }, submit: true })}>{t('chat.documentReading.restart')}</button>
    </div>}
  </section>;
}
