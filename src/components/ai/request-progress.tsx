"use client";

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAiChatStore } from '@/stores/ai-chat-store';
import { useI18n } from '@/hooks/use-i18n';
import type { TranslationKey } from '@/lib/i18n';

export function RequestProgress() {
  const { t } = useI18n();
  const progress = useAiChatStore(state => state.requestProgress);
  const active = useAiChatStore(state => state.isGenerating && state.conversations.find(item => item.id === state.activeConversationId)?.messages.some(message => message.id === state.activeAssistantMessageId));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!active || !progress) return null;
  const seconds = Math.max(0, Math.floor((now - progress.startedAt) / 1000));
  const elapsed = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  return <div role="status" data-testid="ai-request-progress" className="mb-2 flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
    <span>{t(('chat.requestProgress.' + progress.phase) as TranslationKey)}</span>
    <span className="ml-auto tabular-nums">{elapsed}</span>
    {progress.attempt > 1 && <span>{t('chat.requestProgress.attempt', { count: progress.attempt })}</span>}
  </div>;
}
