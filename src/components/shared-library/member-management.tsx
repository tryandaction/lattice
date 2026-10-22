"use client";

import { useI18n } from "@/hooks/use-i18n";
import { t } from "@/lib/i18n";

import { useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LibraryMember, LibraryRole } from "@/lib/shared-library/domain";
import { can } from "@/lib/shared-library/permissions";

export interface MemberManagementProps {
  members: readonly LibraryMember[];
  currentUserId: string;
  viewerRole: LibraryRole;
  onInvite?: (email: string, role: LibraryRole) => void;
  onChangeRole?: (userId: string, role: LibraryRole) => void;
  onSuspend?: (userId: string) => void;
  onRevoke?: (userId: string) => void;
  invitations?: ReadonlyArray<{ id: string; email: string; role: LibraryRole; status: string; expires_at: string }>;
  onRevokeInvitation?: (invitationId: string) => void;
}

const PROMOTABLE_ROLES: readonly LibraryRole[] = ["viewer", "commenter", "editor", "admin"];

/** Promotion ladder for role changes — never auto-promotes to owner. */
export function nextMemberRole(role: LibraryRole): LibraryRole {
  const index = PROMOTABLE_ROLES.indexOf(role);
  if (index === -1 || index === PROMOTABLE_ROLES.length - 1) {
    return role;
  }
  return PROMOTABLE_ROLES[index + 1];
}

export function memberActionImpactLabel(action: "invite" | "change-role" | "suspend" | "revoke"): string {
  switch (action) {
    case "invite":
      return t("cloud.members.impact.invite");
    case "change-role":
      return t("cloud.members.impact.changeRole");
    case "suspend":
      return t("cloud.members.impact.suspend");
    case "revoke":
      return t("cloud.members.impact.revoke");
  }
}

/**
 * Member management. Invite, role change, suspend and revoke are gated by the
 * `member.manage` capability and always show their impact scope. Viewers see
 * the member list but no management entry points.
 */
export function MemberManagement({
  members,
  currentUserId,
  viewerRole,
  onInvite,
  onChangeRole,
  onSuspend,
  onRevoke,
  invitations = [],
  onRevokeInvitation,
}: MemberManagementProps) {
  const { t, formatDate } = useI18n();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<LibraryRole>("viewer");
  const canManage = can(viewerRole, "member.manage");

  return (
    <div data-testid="member-management" className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 py-2 text-sm font-semibold">
        <Users className="h-4 w-4 text-muted-foreground" />
        {t("cloud.members.title")}
      </header>

      {canManage ? (
        <div
          data-testid="member-invite-form"
          className="border-b border-border bg-muted/20 px-3 py-2"
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid flex-1 gap-1 text-xs font-medium">
              {t("cloud.members.email")}
              <input
                data-testid="member-invite-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                placeholder="name@example.com"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              {t("cloud.members.role")}
              <select
                data-testid="member-invite-role"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as LibraryRole)}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="viewer">{t("cloud.role.viewer")}</option>
                <option value="commenter">{t("cloud.role.commenter")}</option>
                <option value="editor">{t("cloud.role.editor")}</option>
                <option value="admin">{t("cloud.role.admin")}</option>
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              data-testid="member-invite-submit"
              disabled={!email.trim()}
              onClick={() => {
                const trimmed = email.trim();
                if (trimmed) {
                  onInvite?.(trimmed, inviteRole);
                  setEmail("");
                }
              }}
            >
              <UserPlus className="h-4 w-4" />
              <span className="ml-1">{t("cloud.members.invite")}</span>
            </Button>
          </div>
          <ul className="mt-2 grid gap-0.5 text-[11px] text-muted-foreground">
            <li>{memberActionImpactLabel("invite")}</li>
            <li>{memberActionImpactLabel("change-role")}</li>
            <li>{memberActionImpactLabel("suspend")}</li>
            <li data-testid="member-action-impact">{memberActionImpactLabel("revoke")}</li>
          </ul>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {canManage && invitations.some(invitation => invitation.status === "pending") ? <div className="mb-3 grid gap-2"><p className="text-xs font-medium">{t("cloud.members.pendingInvitations")}</p>{invitations.filter(invitation => invitation.status === "pending").map(invitation => <div key={invitation.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs"><span className="min-w-0 flex-1">{invitation.email} · {t(`cloud.role.${invitation.role}`)} · {formatDate(invitation.expires_at)}</span><Button size="sm" variant="outline" aria-label={t("cloud.members.revokeInviteFor", { email: invitation.email })} disabled={!onRevokeInvitation} onClick={() => onRevokeInvitation?.(invitation.id)}>{t("cloud.members.revokeInvite")}</Button></div>)}</div> : null}
        <ul className="grid gap-2">
          {members.map((entry) => {
            const isSelf = entry.userId === currentUserId;
            const manageable = canManage && !isSelf && entry.role !== "owner";
            return (
              <li
                key={entry.userId}
                data-testid="member-row"
                className="rounded-md border border-border bg-background/80 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm" title={entry.userId}>{entry.displayName ?? entry.userId}</span>
                  <span
                    data-testid="member-role"
                    className="shrink-0 rounded border border-border bg-muted/35 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                  >
                    {t(`cloud.role.${entry.role}`)}
                  </span>
                  <span
                    data-testid="member-status"
                    className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground"
                  >
                    {t(`cloud.members.status.${entry.status}`)}
                  </span>
                </div>

                {manageable ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select aria-label={t("cloud.members.roleFor", { user: entry.userId })} value={entry.role} className="rounded border border-border bg-background px-2 py-1 text-xs" onChange={event => onChangeRole?.(entry.userId, event.target.value as LibraryRole)}><option value="viewer">{t("cloud.role.viewer")}</option><option value="commenter">{t("cloud.role.commenter")}</option><option value="editor">{t("cloud.role.editor")}</option><option value="admin">{t("cloud.role.admin")}</option></select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid={`member-suspend-${entry.userId}`}
                      disabled={!onSuspend}
                      onClick={() => onSuspend?.(entry.userId)}
                    >
                      {t("cloud.members.suspend")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      data-testid={`member-revoke-${entry.userId}`}
                      onClick={() => onRevoke?.(entry.userId)}
                    >
                      {t("cloud.members.revoke")}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

MemberManagement.nextMemberRole = nextMemberRole;

export default MemberManagement;
