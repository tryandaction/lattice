'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { ChatMessage } from '@/stores/ai-chat-store';
import { buildAnswerMarkdown } from '@/lib/ai/answer-markdown';

export function CopyAnswerButton({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const handleCopy = useCallback(async () => {
    setError(null);
    setCopied(false);
    try {
      const { markdown, sourceNote } = buildAnswerMarkdown(message);
      if (!navigator.clipboard?.writeText) throw new Error('当前环境无法访问剪贴板');
      await navigator.clipboard.writeText(sourceNote ? `${markdown}\n\n> ${sourceNote}` : markdown);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch (cause) {
      const detail = cause instanceof Error && cause.name !== 'NotAllowedError' ? cause.message : '剪贴板权限被拒绝';
      setError(`复制失败：${detail}。请允许剪贴板访问后再次点击复制。`);
    }
  }, [message]);
  const label = copied ? '已复制 Markdown' : message.isStreaming || message.isInterrupted || message.error ? '复制当前已生成的 Markdown（部分回答）' : '复制 Markdown';
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
      <button type="button" onClick={handleCopy} title={label} aria-label={label} data-testid="ai-chat-copy-message"
        className="inline-flex min-h-7 items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary">
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
        <span>{copied ? '已复制' : 'Markdown'}</span>
      </button>
      {error ? <span role="alert" className="basis-full break-words text-[11px] text-destructive">{error}</span> : null}
    </span>
  );
}
