"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getResearchAgentWorkflow, listResearchAgentWorkflows, type ResearchAgentWorkflowId } from "@/lib/ai/research-agent-workflows";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useI18n } from "@/hooks/use-i18n";

function canSelectDelivery(id: ResearchAgentWorkflowId, includePdfScoped: boolean): boolean {
  return id === "reading-note" || (includePdfScoped && id === "pdf-annotation");
}

export function ResearchWorkflowSelector({ includePdfScoped = false }: { includePdfScoped?: boolean }) {
  const { t } = useI18n();
  const selected = useAiChatStore((state) => state.selectedResearchWorkflowId);
  const overrides = useAiChatStore((state) => state.noteConfigOverrides);
  const setSelected = useAiChatStore((state) => state.setResearchWorkflow);
  const setOverrides = useAiChatStore((state) => state.setNoteConfigOverrides);
  const clearOverride = useAiChatStore((state) => state.clearNoteConfigOverride);
  const [sectionsDraft, setSectionsDraft] = useState(overrides.sections?.join(", ") ?? "");
  const [templateDraft, setTemplateDraft] = useState(overrides.template ?? "");
  const sectionsDirty = useRef(false);
  const templateDirty = useRef(false);
  useEffect(() => { if (!sectionsDirty.current) setSectionsDraft(overrides.sections?.join(", ") ?? ""); }, [overrides.sections]);
  useEffect(() => { if (!templateDirty.current) setTemplateDraft(overrides.template ?? ""); }, [overrides.template]);
  const workflows = useMemo(() => {
    const available = listResearchAgentWorkflows({ includePdfScoped }).filter(item => canSelectDelivery(item.id, includePdfScoped));
    if (selected && !available.some((item) => item.id === selected)) return [...available, getResearchAgentWorkflow(selected)];
    return available;
  }, [includePdfScoped, selected]);
  const workflow = workflows.find((item) => item.id === selected);
  const missingPdfContext = Boolean(workflow?.pdfScoped && !includePdfScoped);
  const commitSections = () => {
    sectionsDirty.current = false;
    const sections = sectionsDraft.split(",").map((item) => item.trim()).filter(Boolean);
    if (sections.length) setOverrides({ sections }); else clearOverride("sections");
  };
  const commitTemplate = () => {
    templateDirty.current = false;
    if (templateDraft.trim()) setOverrides({ template: templateDraft }); else clearOverride("template");
  };
  return (
    <div className="flex flex-col gap-1" data-testid="research-workflow-selector">
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground" aria-live="polite">
        <span>{workflow ? t("chat.workflow.manualOverride") : t("chat.workflow.autoHint")}</span>
        {workflow ? <button type="button" onClick={() => setSelected(null)} className="shrink-0 text-xs underline underline-offset-2">{t("chat.workflow.resetAuto")}</button> : null}
      </div>
      {missingPdfContext ? <p className="text-[10px] text-amber-700 dark:text-amber-300" role="status">{t("chat.workflow.pdfContextRequired")}</p> : null}
      <details className="rounded border border-border/70 px-2 py-1" data-testid="research-workflow-advanced">
        <summary className="cursor-pointer text-xs font-medium">{t("chat.workflow.advanced")}</summary>
        <div className="mt-2 grid gap-2">
      <p className="text-[10px] text-muted-foreground">{t("chat.workflow.strategyHint")}</p>
      <label className="text-xs font-medium" htmlFor="research-workflow-select">{t("chat.workflow.deliveryLabel")}</label>
      <select
        id="research-workflow-select"
        value={selected ?? ""}
        onChange={(event) => setSelected((event.target.value || null) as ResearchAgentWorkflowId | null)}
        className="h-8 rounded border border-border bg-background px-2 text-xs"
      >
        <option value="">{t("chat.workflow.auto")}</option>
        {workflows.map((item) => <option key={item.id} value={item.id} disabled={!canSelectDelivery(item.id, includePdfScoped)}>{t(`chat.workflow.name.${item.id}` as "chat.workflow.name.markdown-research")}</option>)}
      </select>
      <p className="text-[10px] text-muted-foreground" aria-live="polite">
        {workflow ? `${t(`chat.workflow.summary.${workflow.id}` as "chat.workflow.summary.markdown-research")} ${workflow.approvalPolicy.createDraft === "ask" ? t("chat.workflow.approvalAsk") : t("chat.workflow.approvalNoWrite")}` : t("chat.workflow.autoHint")}
      </p>
      <details className="rounded border border-border/70 px-2 py-1" data-testid="research-note-settings">
        <summary className="cursor-pointer text-xs font-medium">{t("chat.workflow.noteSettings")}</summary>
        <div className="mt-2 grid max-h-64 gap-2 overflow-y-auto pr-1">
          {includePdfScoped && <label className="grid gap-1 text-xs">{t('chat.workflow.annotationLimit')}<select aria-label={t('chat.workflow.annotationLimit')} value={overrides.annotationLimit ?? ''} onChange={(event) => event.target.value ? setOverrides({ annotationLimit: Number(event.target.value) }) : clearOverride('annotationLimit')} className="h-8 rounded border bg-background px-2"><option value="">{t('chat.workflow.default')}</option>{[5, 10, 20, 30].map(limit => <option key={limit} value={limit}>{limit}</option>)}</select></label>}
          <label className="grid gap-1 text-xs">{t("chat.workflow.language")}<select aria-label={t("chat.workflow.language")} value={overrides.language ?? ""} onChange={(e) => e.target.value ? setOverrides({ language: e.target.value as "zh-CN" | "en-US" }) : clearOverride("language")} className="h-8 rounded border bg-background px-2"><option value="">{t("chat.workflow.default")}</option><option value="zh-CN">简体中文</option><option value="en-US">English</option></select></label>
          <label className="grid gap-1 text-xs">{t("chat.workflow.noteStyle")}<select aria-label={t("chat.workflow.noteStyle")} value={overrides.noteStyle ?? ""} onChange={(e) => e.target.value ? setOverrides({ noteStyle: e.target.value as NonNullable<typeof overrides.noteStyle> }) : clearOverride("noteStyle")} className="h-8 rounded border bg-background px-2"><option value="">{t("chat.workflow.default")}</option>{["academic","concise","zotero-like","cornell","custom"].map((value) => <option key={value} value={value}>{t(`chat.workflow.style.${value}` as "chat.workflow.style.academic")}</option>)}</select></label>
          <label className="grid gap-1 text-xs">{t("chat.workflow.sections")}<input aria-label={t("chat.workflow.sections")} value={sectionsDraft} onChange={(e) => { sectionsDirty.current = true; setSectionsDraft(e.target.value); }} onBlur={commitSections} className="h-8 rounded border bg-background px-2" /></label>
          <label className="grid gap-1 text-xs">{t("chat.workflow.quotePolicy")}<select aria-label={t("chat.workflow.quotePolicy")} value={overrides.quotePolicy ?? ""} onChange={(e) => e.target.value ? setOverrides({ quotePolicy: e.target.value as NonNullable<typeof overrides.quotePolicy> }) : clearOverride("quotePolicy")} className="h-8 rounded border bg-background px-2"><option value="">{t("chat.workflow.default")}</option>{["short-quotes-only","paraphrase-first","evidence-table"].map((value) => <option key={value} value={value}>{t(`chat.workflow.quote.${value}` as "chat.workflow.quote.short-quotes-only")}</option>)}</select></label>
          <label className="grid gap-1 text-xs">{t("chat.workflow.template")}<textarea aria-label={t("chat.workflow.template")} value={templateDraft} onChange={(e) => { templateDirty.current = true; setTemplateDraft(e.target.value); }} onBlur={commitTemplate} rows={4} className="rounded border bg-background px-2 py-1" /></label>
        </div>
      </details>
        </div>
      </details>
    </div>
  );
}
