'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { FileText, Loader2, Paperclip, X } from 'lucide-react';
import { useAiAttachmentStore } from '@/stores/ai-attachment-store';
import { useAiChatStore } from '@/stores/ai-chat-store';
import { getChatAttachmentFiles, type ChatAttachmentRef } from '@/lib/ai/chat-attachments';
import { cn } from '@/lib/utils';

const EMPTY_ATTACHMENTS: ChatAttachmentRef[] = [];

/** Bind these handlers to the composer container, so drops/pastes work over the textarea. */
export function useChatAttachmentInput(conversationId: string | null, disabled = false) {
  const scope = useRef({ conversationId, disabled });
  useLayoutEffect(() => { scope.current = { conversationId, disabled }; }, [conversationId, disabled]);
  const aborts = useRef(new Set<AbortController>());
  useEffect(() => () => {
    for (const controller of aborts.current) controller.abort();
    aborts.current.clear();
  }, [conversationId, disabled]);

  const addFiles = useCallback(async (files: readonly File[]) => {
    if (disabled || !conversationId || !files.length) return;
    const controller = new AbortController();
    aborts.current.add(controller);
    try {
      await useAiAttachmentStore.getState().addFiles(conversationId, files, {
        signal: controller.signal,
        isCurrent: () => scope.current.conversationId === conversationId && !scope.current.disabled,
      });
    } finally { aborts.current.delete(controller); }
  }, [conversationId, disabled]);

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    if (disabled || !conversationId) return;
    void addFiles(Array.from(event.dataTransfer.files)).catch(() => { /* The store shows a scoped error. */ });
  }, [addFiles, conversationId, disabled]);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
  }, []);

  const onPaste = useCallback((event: ClipboardEvent<HTMLElement>) => {
    if (disabled || !conversationId) return;
    const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file').flatMap(item => {
      const file = item.getAsFile();
      return file ? [file] : [];
    });
    if (!files.length) return;
    // Preserve accompanying clipboard text so mixed pastes still populate the prompt.
    if (!event.clipboardData.getData('text/plain')) event.preventDefault();
    void addFiles(files).catch(() => { /* The store shows a scoped error. */ });
  }, [addFiles, conversationId, disabled]);

  return { addFiles, onDrop, onDragOver, onPaste };
}

function AttachmentThumbnail({ attachment }: { attachment: ChatAttachmentRef }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (attachment.kind !== 'image') return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void getChatAttachmentFiles(attachment.conversationId, [attachment.id], { signal: controller.signal }).then(([result]) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(result.file);
      setUrl(objectUrl);
    }).catch(() => { /* Missing attachments are reported when sending. */ });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.conversationId, attachment.id, attachment.kind]);
  // Only validated raster file headers reach this branch; HTML/SVG never receive image URLs.
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="h-7 w-7 shrink-0 rounded object-cover" /> : <FileText className="h-3.5 w-3.5 shrink-0" />;
}

export function ChatAttachments({ conversationId, disabled = false, className }: { conversationId: string | null; disabled?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const scope = useRef(conversationId);
  useLayoutEffect(() => { scope.current = conversationId; }, [conversationId]);
  const attachments = useAiAttachmentStore(state => conversationId ? state.attachmentsByConversation[conversationId] ?? EMPTY_ATTACHMENTS : EMPTY_ATTACHMENTS);
  const busy = useAiAttachmentStore(state => Boolean(conversationId && state.busyByConversation[conversationId]));
  const error = useAiAttachmentStore(state => conversationId ? state.errorsByConversation[conversationId] : undefined);
  const { addFiles } = useChatAttachmentInput(conversationId, disabled);
  useEffect(() => {
    if (!conversationId || typeof indexedDB === 'undefined') return;
    const controller = new AbortController();
    void useAiAttachmentStore.getState().hydrateConversation(conversationId, {
      signal: controller.signal, isCurrent: () => scope.current === conversationId,
    }).catch(() => { /* The store shows a scoped storage error. */ });
    return () => controller.abort();
  }, [conversationId]);
  const pending = attachments.filter(ref => ref.status === 'pending');
  return <div className={cn('flex min-w-0 flex-wrap items-center gap-1', className)} data-testid="ai-chat-attachments">
    <input ref={input} type="file" multiple className="hidden" tabIndex={-1} aria-label="上传附件" disabled={disabled || busy}
      onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        void addFiles(files).catch(() => { /* The store shows a scoped error. */ });
      }} />
    <button type="button" onClick={() => { if (!conversationId) useAiChatStore.getState().newConversation(); input.current?.click(); }} disabled={disabled || busy}
      title="上传文件或图片（可拖放、粘贴）" aria-label="上传文件或图片" data-testid="ai-chat-attach-button"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
    </button>
    {pending.map(attachment => <span key={attachment.id} title={`${attachment.name} · ${(attachment.size / 1024).toFixed(1)} KB${attachment.reason ? ` · ${attachment.reason}` : ''}`}
      className={cn('inline-flex max-w-48 items-center gap-1 rounded border border-border bg-muted/20 px-1.5 py-0.5 text-[10px]', attachment.kind === 'unreadable' && 'border-amber-500/40')}>
      <AttachmentThumbnail attachment={attachment} />
      <span className="min-w-0 truncate">{attachment.name}{attachment.kind === 'unreadable' ? ' · 无法读取' : ''}</span>
      <button type="button" disabled={disabled || busy} aria-label={`移除附件 ${attachment.name}`} className="shrink-0 rounded p-0.5 hover:bg-accent disabled:opacity-50"
        onClick={() => {
          if (!conversationId) return;
          void useAiAttachmentStore.getState().removeAttachment(conversationId, attachment.id, { isCurrent: () => scope.current === conversationId }).catch(() => {});
        }}><X className="h-3 w-3" /></button>
    </span>)}
    {error ? <span role="alert" className="w-full px-1 text-[11px] text-destructive">{error}</span> : null}
  </div>;
}
