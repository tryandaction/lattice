"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { getDefaultProvider, getProvider } from "@/lib/ai/providers";
import { X, Send, Square, Plus, Trash2, MessageSquare, Copy, Check, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/renderers/markdown-renderer";
import { useI18n } from "@/hooks/use-i18n";
import type { AiProviderId } from "@/lib/ai/types";
import { MentionAutocomplete } from "./mention-autocomplete";
import { DiffPreview } from "./diff-preview";
import { buildMentionContext, parseMentions } from "@/lib/ai/mention-resolver";
import { extractCodeBlocks } from "@/lib/ai/diff-utils";

export function AiChatPanel() {
  const isOpen = useAiChatStore((s) => s.isOpen);
  const setOpen = useAiChatStore((s) => s.setOpen);
  const loadConversations = useAiChatStore((s) => s.loadConversations);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-background">
      <ChatHeader onClose={() => setOpen(false)} />
      <ChatMessages />
      <ChatInput />
    </div>
  );
}

function ChatHeader({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const newConversation = useAiChatStore((s) => s.newConversation);
  const activeId = useAiChatStore((s) => s.activeConversationId);
  const deleteConv = useAiChatStore((s) => s.deleteConversation);

  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('chat.title')}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => newConversation()}
          className="p-1 rounded hover:bg-accent transition-colors"
          title={t('chat.newChat')}
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        {activeId && (
          <button
            onClick={() => deleteConv(activeId)}
            className="p-1 rounded hover:bg-accent transition-colors"
            title={t('chat.deleteChat')}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent transition-colors"
          title={t('common.close')}
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

/* CHAT_PANEL_CONTINUE */

function CopyMessageButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-1 right-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-accent transition-all"
      title={copied ? t('chat.copied') : t('chat.copy')}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  );
}

function ChatMessages() {
  const { t } = useI18n();
  const conv = useAiChatStore((s) => s.getActiveConversation());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [diffState, setDiffState] = useState<{ msgId: string; code: string } | null>(null);
  const activeTab = useWorkspaceStore((s) => s.getActiveTab());
  const activeContent = useContentCacheStore((s) => {
    if (!activeTab) return null;
    const cached = s.getContent(activeTab.id);
    return typeof cached?.content === 'string' ? cached.content : null;
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conv?.messages]);

  if (!conv || conv.messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-xs text-muted-foreground text-center">
          {t('chat.empty')}
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
      {conv.messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            "text-sm rounded-lg px-3 py-2 group relative",
            msg.role === "user"
              ? "bg-primary/10 ml-4"
              : "bg-muted mr-4"
          )}
        >
          <div className="text-[10px] text-muted-foreground mb-1 uppercase">
            {msg.role === "user" ? t('chat.you') : t('chat.ai')}
          </div>
          {msg.role === "assistant" ? (
            <>
              <div className="text-xs leading-relaxed ai-chat-markdown [&_.prose]:max-w-none [&_pre]:text-[11px] [&_code]:text-[11px] [&_p]:my-1.5 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                <MarkdownRenderer content={msg.content} className="text-xs" />
                {msg.isStreaming && <span className="animate-pulse">▊</span>}
              </div>
              {msg.usage && (
                <div className="text-[9px] text-muted-foreground/60 mt-1">
                  {msg.usage.totalTokens} tokens ({msg.usage.promptTokens}→{msg.usage.completionTokens})
                </div>
              )}
              {!msg.isStreaming && msg.content && (
                <div className="flex items-center gap-1 mt-1">
                  <CopyMessageButton text={msg.content} />
                  {extractCodeBlocks(msg.content).length > 0 && activeTab && (
                    <button
                      onClick={() => {
                        const blocks = extractCodeBlocks(msg.content);
                        if (blocks.length > 0) {
                          setDiffState(diffState?.msgId === msg.id ? null : { msgId: msg.id, code: blocks[0].code });
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title="Preview Changes"
                    >
                      <GitCompareArrows className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
              {diffState?.msgId === msg.id && activeContent && activeTab && (
                <DiffPreview
                  original={activeContent}
                  modified={diffState.code}
                  onAccept={(result) => {
                    useContentCacheStore.getState().setContent(activeTab.id, result);
                    setDiffState(null);
                  }}
                  onReject={() => setDiffState(null)}
                  className="mt-2"
                />
              )}
            </>
          ) : (
            <div className="whitespace-pre-wrap break-words text-xs leading-relaxed">
              {msg.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ChatInput() {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const isGenerating = useAiChatStore((s) => s.isGenerating);
  const stopGenerating = useAiChatStore((s) => s.stopGenerating);
  const addUserMessage = useAiChatStore((s) => s.addUserMessage);
  const startAssistantMessage = useAiChatStore((s) => s.startAssistantMessage);
  const appendToAssistantMessage = useAiChatStore((s) => s.appendToAssistantMessage);
  const finishAssistantMessage = useAiChatStore((s) => s.finishAssistantMessage);
  const setAssistantError = useAiChatStore((s) => s.setAssistantError);
  const setGenerating = useAiChatStore((s) => s.setGenerating);
  const getMessagesForApi = useAiChatStore((s) => s.getMessagesForApi);
  const setMessageUsage = useAiChatStore((s) => s.setMessageUsage);
  const settings = useSettingsStore((s) => s.settings);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0 });

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput("");

    // Resolve @mentions before sending
    const mentions = parseMentions(text);
    let resolvedText = text;
    if (mentions.length > 0) {
      const context = await buildMentionContext(text);
      resolvedText = context || text;
    }

    addUserMessage(text); // Show original text in UI
    const msgId = startAssistantMessage();
    const controller = new AbortController();
    setGenerating(true, controller);

    try {
      const providerId = (settings.aiProvider ?? undefined) as AiProviderId | undefined;
      const provider = providerId ? getProvider(providerId) : getDefaultProvider();
      if (!provider) {
        setAssistantError(msgId, "No AI provider configured. Go to Settings → AI to set one up.");
        return;
      }

      // getMessagesForApi() already includes the user message we just added
    const apiMessages = getMessagesForApi();
    if (mentions.length > 0 && resolvedText !== text) {
      const last = apiMessages[apiMessages.length - 1];
      if (last && last.role === "user") {
        apiMessages[apiMessages.length - 1] = { ...last, content: resolvedText };
      }
    }

      if (settings.aiStreamingEnabled) {
        for await (const chunk of provider.stream(apiMessages, {
          model: settings.aiModel ?? undefined,
          temperature: settings.aiTemperature,
          maxTokens: settings.aiMaxTokens,
          signal: controller.signal,
        })) {
          if (chunk.type === "text" && chunk.text) {
            appendToAssistantMessage(msgId, chunk.text);
          } else if (chunk.type === "error") {
            setAssistantError(msgId, chunk.error ?? "Unknown error");
            return;
          }
        }
        finishAssistantMessage(msgId);
      } else {
        const result = await provider.generate(apiMessages, {
          model: settings.aiModel ?? undefined,
          temperature: settings.aiTemperature,
          maxTokens: settings.aiMaxTokens,
          signal: controller.signal,
        });
        appendToAssistantMessage(msgId, result.text);
        finishAssistantMessage(msgId);
        if (result.usage) {
          setMessageUsage(msgId, result.usage);
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        finishAssistantMessage(msgId);
      } else {
        setAssistantError(msgId, (err as Error).message ?? "Request failed");
      }
    }
  }, [input, isGenerating, settings, addUserMessage, startAssistantMessage, appendToAssistantMessage, finishAssistantMessage, setAssistantError, setGenerating, getMessagesForApi, setMessageUsage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border p-2 relative">
      {mentionQuery !== null && (
        <MentionAutocomplete
          query={mentionQuery}
          position={mentionPos}
          onSelect={(mention) => {
            // Replace the @query with the selected mention
            const textarea = textareaRef.current;
            if (textarea) {
              const cursorPos = textarea.selectionStart;
              const textBefore = input.slice(0, cursorPos);
              const textAfter = input.slice(cursorPos);
              const atIdx = textBefore.lastIndexOf('@');
              const newText = textBefore.slice(0, atIdx) + mention + ' ' + textAfter;
              setInput(newText);
            }
            setMentionQuery(null);
          }}
          onClose={() => setMentionQuery(null)}
        />
      )}
      <div className="flex items-end gap-1">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            const val = e.target.value;
            setInput(val);
            // Detect @mention trigger
            const cursorPos = e.target.selectionStart;
            const textBefore = val.slice(0, cursorPos);
            const atMatch = textBefore.match(/@(\S*)$/);
            if (atMatch) {
              setMentionQuery(atMatch[1]);
              setMentionPos({ top: 40, left: 8 });
            } else {
              setMentionQuery(null);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.placeholder')}
          rows={1}
          className="flex-1 resize-none rounded-md border border-border bg-muted/50 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={isGenerating}
        />
        {isGenerating ? (
          <button
            onClick={stopGenerating}
            className="rounded-md bg-destructive/10 p-2 text-destructive hover:bg-destructive/20 transition-colors"
            title={t('chat.stop')}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="rounded-md bg-primary/10 p-2 text-primary hover:bg-primary/20 disabled:opacity-30 transition-colors"
            title={t('chat.send')}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
