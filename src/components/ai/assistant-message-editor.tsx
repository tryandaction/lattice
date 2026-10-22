"use client";

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { Loader2, Save, X } from "lucide-react";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useI18n } from "@/hooks/use-i18n";

function EditorLoading() {
  const { t } = useI18n();
  return <div className="p-3 text-xs text-muted-foreground" role="status">{t("chat.edit.loading")}</div>;
}

const LivePreviewEditor = dynamic(
  () => import("@/components/editor/codemirror/live-preview/live-preview-editor").then((module) => module.LivePreviewEditor),
  { ssr: false, loading: EditorLoading },
);

export function AssistantMessageEditor({
  messageId,
  content,
  onClose,
}: {
  messageId: string;
  content: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(content);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const initialContent = useRef(content);
  const saveMessage = useAiChatStore((state) => state.updateAssistantMessage);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    if (!draft.trim()) {
      setError(t("chat.edit.empty"));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await saveMessage(messageId, draft, initialContent.current);
      onClose();
    } catch (failure) {
      setError(t("chat.edit.failed", {
        reason: failure instanceof Error ? failure.message : String(failure),
      }));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draft, messageId, onClose, saveMessage, t]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!savingRef.current) onClose();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      void save();
    }
  }, [onClose, save]);

  return (
    <div
      className="overflow-hidden rounded-md border border-primary/40 bg-background"
      data-testid="ai-assistant-message-editor"
      onKeyDownCapture={handleKeyDown}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <span className="text-xs font-medium">{t("chat.edit.title")}</span>
        <span className="text-[10px] text-muted-foreground">{t("chat.edit.hint")}</span>
      </div>
      <LivePreviewEditor
        content={draft}
        onChange={setDraft}
        mode="live"
        showLineNumbers={false}
        showFoldGutter
        readOnly={saving}
        autoHeight={false}
        fileId={`ai-response-${messageId}`}
        onSave={() => { void save(); }}
        className="h-[min(55vh,30rem)] min-h-[12rem] text-xs"
      />
      {error && <p role="alert" className="px-2 py-1 text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-2 border-t border-border px-2 py-1.5">
        <button type="button" onClick={onClose} disabled={saving} data-testid="ai-assistant-edit-cancel"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">
          <X className="h-3 w-3" />{t("common.cancel")}
        </button>
        <button type="button" onClick={() => { void save(); }} disabled={saving} data-testid="ai-assistant-edit-save"
          className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {saving ? t("chat.edit.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
