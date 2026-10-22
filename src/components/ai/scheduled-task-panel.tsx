"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CirclePause, CirclePlay, Play, RefreshCw, Trash2 } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import {
  useScheduledTaskStore,
  type ScheduledTaskSchedule,
} from "@/stores/scheduled-task-store";
import { cn } from "@/lib/utils";

function statusClass(status: string): string {
  if (status === "failed") return "text-destructive";
  if (status === "completed") return "text-emerald-700 dark:text-emerald-300";
  if (status === "paused") return "text-amber-700 dark:text-amber-300";
  return "text-muted-foreground";
}

export function ScheduledTaskPanel() {
  const { t } = useI18n();
  const tasks = useScheduledTaskStore((state) => state.tasks);
  const runs = useScheduledTaskStore((state) => state.runs);
  const hydrated = useScheduledTaskStore((state) => state.hydrated);
  const error = useScheduledTaskStore((state) => state.error);
  const hydrate = useScheduledTaskStore((state) => state.hydrate);
  const createTask = useScheduledTaskStore((state) => state.createTask);
  const pauseTask = useScheduledTaskStore((state) => state.pauseTask);
  const resumeTask = useScheduledTaskStore((state) => state.resumeTask);
  const removeTask = useScheduledTaskStore((state) => state.removeTask);
  const runTaskNow = useScheduledTaskStore((state) => state.runTaskNow);
  const retryTask = useScheduledTaskStore((state) => state.retryTask);
  const startScheduler = useScheduledTaskStore((state) => state.startScheduler);
  const stopScheduler = useScheduledTaskStore((state) => state.stopScheduler);
  const executorAvailable = useScheduledTaskStore((state) => state.executorAvailable);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scheduleKind, setScheduleKind] = useState<"once" | "interval">("once");
  const [everyMs, setEveryMs] = useState("3600000");
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrate, hydrated]);

  useEffect(() => {
    startScheduler();
    return () => stopScheduler();
  }, [startScheduler, stopScheduler]);

  const create = () => {
    if (!executorAvailable) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    const schedule: ScheduledTaskSchedule = scheduleKind === "once"
      ? { kind: "once", runAt: Date.now() }
      : { kind: "interval", everyMs: Math.max(1000, Number(everyMs) || 3600000) };
    createTask({ title: trimmed, prompt: prompt.trim(), schedule, maxRetries: 1 });
    setTitle("");
    setPrompt("");
  };

  const runsByTask = useMemo(() => {
    const grouped = new Map<string, typeof runs>();
    runs.forEach((run) => grouped.set(run.taskId, [...(grouped.get(run.taskId) ?? []), run]));
    return grouped;
  }, [runs]);

  return (
    <section className="flex min-h-full flex-col gap-3 p-3" data-testid="scheduled-task-panel">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-medium">{t("chat.scheduledTasks.title")}</h2>
      </div>
      {!executorAvailable ? <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200" role="status" data-testid="scheduled-task-executor-unavailable">
        {t("chat.scheduledTasks.unsupported")}
      </div> : null}

      <div className="flex flex-col gap-2 rounded-md border border-border/70 bg-muted/20 p-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Enter") create(); }}
          placeholder={t("chat.scheduledTasks.titlePlaceholder")}
          aria-label={t("chat.scheduledTasks.titlePlaceholder")}
          data-testid="scheduled-task-title"
          className="h-8 rounded border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          placeholder={t("chat.scheduledTasks.promptPlaceholder")}
          aria-label={t("chat.scheduledTasks.promptLabel")}
          data-testid="scheduled-task-prompt"
          rows={2}
          className="rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-2">
          <select
            value={scheduleKind}
            onChange={(event) => setScheduleKind(event.currentTarget.value as "once" | "interval")}
            aria-label="Schedule type"
            className="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs"
          >
            <option value="once">{t("chat.scheduledTasks.schedule.once")}</option>
            <option value="interval">{t("chat.scheduledTasks.schedule.interval")}</option>
          </select>
          {scheduleKind === "interval" && (
            <input
              type="number"
              min={1000}
              value={everyMs}
              onChange={(event) => setEveryMs(event.currentTarget.value)}
              aria-label="Every milliseconds"
              className="h-8 w-28 rounded border border-border bg-background px-2 text-xs"
            />
          )}
          <button
            type="button"
            onClick={create}
            disabled={!title.trim() || !executorAvailable}
            data-testid="scheduled-task-create"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded bg-primary px-2 text-xs text-primary-foreground disabled:opacity-50"
          >
            <CalendarClock className="h-3 w-3" aria-hidden="true" />
            {t("chat.scheduledTasks.create")}
          </button>
        </div>
      </div>

      {error ? <div className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive" role="alert">{error}</div> : null}
      {tasks.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">{t("chat.scheduledTasks.empty")}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((task, index) => {
            const taskRuns = runsByTask.get(task.id) ?? [];
            const running = runningId === task.id;
            return (
              <article key={task.id} className="rounded-md border border-border/70 p-2" data-testid={`scheduled-task-row-${index}`}>
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium" title={task.title}>{task.title}</div>
                    {task.prompt ? <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{task.prompt}</div> : null}
                    <div className={cn("mt-0.5 text-[10px]", statusClass(task.status))} data-testid={`scheduled-task-status-${index}`}>
                      {t(`chat.scheduledTasks.status.${task.status}` as "chat.scheduledTasks.status.active")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {task.status === "paused" || task.status === "failed" ? (
                      <button type="button" disabled={!executorAvailable} onClick={() => resumeTask(task.id)} className="inline-flex size-6 items-center justify-center rounded hover:bg-accent disabled:opacity-50" title={t("chat.scheduledTasks.resume")} aria-label={t("chat.scheduledTasks.resume")}><CirclePlay className="size-3.5" /></button>
                    ) : task.status !== "completed" ? (
                      <button type="button" onClick={() => pauseTask(task.id)} className="inline-flex size-6 items-center justify-center rounded hover:bg-accent" title={t("chat.scheduledTasks.pause")} aria-label={t("chat.scheduledTasks.pause")}><CirclePause className="size-3.5" /></button>
                    ) : null}
                    {task.status === "failed" ? (
                      <button type="button" disabled={!executorAvailable} onClick={() => void retryTask(task.id)} className="inline-flex size-6 items-center justify-center rounded hover:bg-accent disabled:opacity-50" title={t("chat.scheduledTasks.retry")} aria-label={t("chat.scheduledTasks.retry")}><RefreshCw className="size-3.5" /></button>
                    ) : null}
                    {task.status !== "completed" || task.schedule.kind === "interval" ? (
                      <button
                        type="button"
                        disabled={running || !executorAvailable}
                        onClick={() => { setRunningId(task.id); void runTaskNow(task.id).catch(() => undefined).finally(() => setRunningId(null)); }}
                        data-testid={`scheduled-task-run-${index}`}
                        className="inline-flex size-6 items-center justify-center rounded hover:bg-accent disabled:opacity-50"
                        title={t("chat.scheduledTasks.runNow")}
                        aria-label={t("chat.scheduledTasks.runNow")}
                      ><Play className="size-3.5" /></button>
                    ) : null}
                    <button type="button" onClick={() => removeTask(task.id)} className="inline-flex size-6 items-center justify-center rounded text-destructive hover:bg-destructive/10" title={t("chat.scheduledTasks.delete")} aria-label={t("chat.scheduledTasks.delete")}><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground" data-testid={`scheduled-task-runs-${index}`}>
                  {t("chat.scheduledTasks.runs")}: {taskRuns.length === 0 ? "0" : taskRuns.map((run) => run.status).join(", ")}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
