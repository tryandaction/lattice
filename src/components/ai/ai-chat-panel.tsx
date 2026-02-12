"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getDefaultProvider, getProvider } from "@/lib/ai/providers";
import { buildAiContext } from "@/lib/ai/context-builder";
import { X, Send, Square, Plus, Trash2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AiProviderId } from "@/lib/ai/types";

export function AiChatPanel() {
  const isOpen = useAiChatStore((s) => s.isOpen);
  const setOpen = useAiChatStore((s) => s.setOpen);

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
  const newConversation = useAiChatStore((s) => s.newConversation);
  const conversations = useAiChatStore((s) => s.conversations);
  const activeId = useAiChatStore((s) => s.activeConversationId);
  const setActive = useAiChatStore((s) => s.setActiveConversation);
  const deleteConv = useAiChatStore((s) => s.deleteConversation);

  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          AI Chat
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => newConversation()}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="New conversation"
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        {activeId && (
          <button
            onClick={() => deleteConv(activeId)}
            className="p-1 rounded hover:bg-accent transition-colors"
            title="Delete conversation"
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="Close"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

/* CHAT_PANEL_CONTINUE */

function ChatMessages() {
  const conv = useAiChatStore((s) => s.getActiveConversation());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conv?.messages]);

  if (!conv || conv.messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-xs text-muted-foreground text-center">
          Ask a question about your document or research.
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
            "text-sm rounded-lg px-3 py-2",
            msg.role === "user"
              ? "bg-primary/10 ml-4"
              : "bg-muted mr-4"
          )}
        >
          <div className="text-[10px] text-muted-foreground mb-1 uppercase">
            {msg.role === "user" ? "You" : "AI"}
          </div>
          <div className="whitespace-pre-wrap break-words text-xs leading-relaxed">
            {msg.content}
            {msg.isStreaming && <span className="animate-pulse">▊</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChatInput() {
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
  const settings = useSettingsStore((s) => s.settings);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput("");

    addUserMessage(text);
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

      const apiMessages = getMessagesForApi();
      // Add the new user message
      apiMessages.push({ role: "user", content: text });

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
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        finishAssistantMessage(msgId);
      } else {
        setAssistantError(msgId, (err as Error).message ?? "Request failed");
      }
    }
  }, [input, isGenerating, settings, addUserMessage, startAssistantMessage, appendToAssistantMessage, finishAssistantMessage, setAssistantError, setGenerating, getMessagesForApi]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border p-2">
      <div className="flex items-end gap-1">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask something..."
          rows={1}
          className="flex-1 resize-none rounded-md border border-border bg-muted/50 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={isGenerating}
        />
        {isGenerating ? (
          <button
            onClick={stopGenerating}
            className="rounded-md bg-destructive/10 p-2 text-destructive hover:bg-destructive/20 transition-colors"
            title="Stop"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="rounded-md bg-primary/10 p-2 text-primary hover:bg-primary/20 disabled:opacity-30 transition-colors"
            title="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
