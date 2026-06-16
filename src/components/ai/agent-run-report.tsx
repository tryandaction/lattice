"use client";

import { MarkdownRenderer } from "@/components/renderers/markdown-renderer";
import type {
  AgentRunReportAction,
  AgentRunReportViewModel,
} from "@/lib/ai/agent-run-report-view-model";

export function AgentRunReport({
  report,
  onAction,
}: {
  report: AgentRunReportViewModel;
  onAction?: (action: AgentRunReportAction) => void;
}) {
  return (
    <div
      className="rounded border border-border/60 bg-background/60 p-2"
      data-testid="agent-run-report"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Run report</div>
          <div className="mt-0.5 truncate text-xs font-medium text-foreground">{report.title}</div>
          <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{report.task}</div>
        </div>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">
          {report.status}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">{report.summary}</div>
      {report.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" data-testid="agent-run-report-actions">
          {report.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => onAction?.(action)}
              data-testid={`agent-run-report-action-${action.id}`}
              className="rounded border border-border/70 bg-background/70 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 grid gap-1.5">
        {report.sections.map((section) => (
          <section
            key={`${report.sessionId}:${section.kind}:${section.title}`}
            className="rounded border border-border/40 bg-muted/20 px-2 py-1.5"
          >
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {section.title}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              <MarkdownRenderer content={section.content} className="text-xs" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
