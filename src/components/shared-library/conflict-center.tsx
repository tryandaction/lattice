"use client";

import { useI18n } from "@/hooks/use-i18n";
import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Annotation, Item, LibraryRole, SyncConflict } from "@/lib/shared-library/domain";
import { can } from "@/lib/shared-library/permissions";
import {
  buildConflictViewModels,
  type ConflictResolutionAction,
} from "@/lib/shared-library/conflict-model";

export interface ConflictCenterProps {
  conflicts: readonly SyncConflict[];
  items: readonly Item[];
  annotations: readonly Annotation[];
  viewerRole: LibraryRole;
  onResolve?: (conflictId: string, action: ConflictResolutionAction) => void;
}

/**
 * Conflict center. Renders every unresolved sync conflict as a card showing
 * the entity, both sides (version/author/time), a recommended action and the
 * concrete resolution buttons. Viewers see the conflict but never the resolve
 * controls — resolution is gated by `item.update` / `item.restore`.
 */
export function ConflictCenter({
  conflicts,
  items,
  annotations,
  viewerRole,
  onResolve,
}: ConflictCenterProps) {
  const { t } = useI18n();
  const actionLabel = (action: ConflictResolutionAction) => t(`cloud.conflict.action.${action.kind}`);
  const models = useMemo(
    () => buildConflictViewModels(conflicts, items, annotations),
    [conflicts, items, annotations],
  );
  const canResolve = can(viewerRole, "item.update") || can(viewerRole, "item.restore");

  if (models.length === 0) {
    return (
      <div
        data-testid="conflict-center"
        className="flex items-center gap-2 p-3 text-xs text-muted-foreground"
      >
        <AlertTriangle className="h-4 w-4" />
        {t("cloud.conflict.empty")}
      </div>
    );
  }

  return (
    <div data-testid="conflict-center" className="grid gap-2 p-3">
      {models.map((model) => {
        return (
          <div
            key={model.conflictId}
            data-testid="conflict-card"
            className="rounded-md border border-destructive/40 bg-background/80 p-3"
          >
            <div className="text-sm font-medium">{model.title}</div>
            <div className="text-[11px] text-muted-foreground">
              {t(`cloud.conflict.reason.${model.reason}`)} · {model.entityType === "item" ? t("cloud.library.item.file") : model.entityType === "annotation" ? t("cloud.annotation.fallback") : model.entityType}
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border bg-muted/20 p-2">
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("cloud.conflict.localSide")}
                </dt>
                <dd data-testid="conflict-local-side">
                  {model.local
                    ? `${model.local.versionLabel.replace(/ \((?:local|remote)\)$/u, "")} · ${model.local.authorId}`
                    : t("cloud.conflict.none")}
                </dd>
              </div>
              <div className="rounded border border-border bg-muted/20 p-2">
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("cloud.conflict.remoteSide")}
                </dt>
                <dd data-testid="conflict-remote-side">
                  {model.remote
                    ? `${model.remote.versionLabel.replace(/ \((?:local|remote)\)$/u, "")} · ${model.remote.authorId}`
                    : t("cloud.conflict.none")}
                </dd>
              </div>
            </dl>

            <div className="mt-2 text-xs" data-testid="conflict-recommended">
              <span className="text-muted-foreground">{t("cloud.conflict.recommended")}</span>{" "}
              <span className="font-medium">
                {actionLabel(model.recommendedAction)}
              </span>
            </div>

            {canResolve && onResolve ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onResolve(model.conflictId, model.recommendedAction)}
                  data-testid="conflict-resolve-recommended"
                >
                  {t("cloud.conflict.resolve", { action: actionLabel(model.recommendedAction) })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onResolve(model.conflictId, { kind: "keep-local" })}
                  data-testid="conflict-resolve-keep-local"
                >
                  {t("cloud.conflict.action.keep-local")}
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default ConflictCenter;
