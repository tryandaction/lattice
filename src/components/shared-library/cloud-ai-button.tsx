"use client";

import { useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/use-i18n";
import { getCloudWorkspaceSnapshot, subscribeCloudWorkspaceHost } from "@/lib/cloud-workspace-host";
import { openCloudAiEntry, type CloudAiEntryInput } from "@/lib/shared-library/cloud-ai-entry";
import { cloudAiLabels } from "@/lib/shared-library/cloud-ai-labels";
import { useAiChatStore } from "@/stores/ai-chat-store";

export interface CloudAiButtonProps extends Omit<CloudAiEntryInput, "locale"> {
  className?: string;
  compact?: boolean;
  disabled?: boolean;
}

export function CloudAiButton({ className, compact = false, disabled = false, ...input }: CloudAiButtonProps) {
  const { locale } = useI18n();
  const host = useSyncExternalStore(subscribeCloudWorkspaceHost, getCloudWorkspaceSnapshot, getCloudWorkspaceSnapshot);
  const generating = useAiChatStore(state => state.isGenerating);
  const labels = cloudAiLabels(locale);
  const label = input.selection.kind === "folder" ? labels.folder : labels.open;
  const stale = !input.expectedScope || input.provider.scope !== input.expectedScope || host.provider !== input.provider;
  return <button type="button" aria-label={label} title={generating ? labels.generating : stale ? labels.scopeChanged : labels.source(input.sourceName ?? label)}
    className={className ?? "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"}
    disabled={disabled || generating || stale} onClick={() => {
      try { openCloudAiEntry({ ...input, locale }); }
      catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    }}>
    <Sparkles className="size-3.5 shrink-0" />{compact ? null : label}
  </button>;
}
