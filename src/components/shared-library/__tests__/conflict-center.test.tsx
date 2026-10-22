/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import {
  buildConflictViewModels,
  classifyConflictReason,
  conflictActionLabel,
  conflictActionToOperation,
  type ConflictResolutionAction,
} from "@/lib/shared-library/conflict-model";
import {
  buildActivityFeed,
  activityVerbLabel,
  type ActivityEvent,
} from "@/lib/shared-library/activity";
import { ConflictCenter } from "@/components/shared-library/conflict-center";
import { ActivityPanel } from "@/components/shared-library/activity-panel";
import type { Annotation, Item, SyncConflict } from "@/lib/shared-library/domain";

beforeEach(() => setLocale("en-US"));
afterEach(() => { cleanup(); setLocale("zh-CN"); });

function conflict(overrides: Partial<SyncConflict> = {}): SyncConflict {
  return {
    id: "conflict-1",
    entityType: "item",
    entityId: "item-1",
    reason: "binary-version",
    localOperationId: "op-local",
    remoteOperationId: "op-remote",
    localPayload: { versionNumber: 3, authorId: "user-1", createdAt: "2026-08-20T00:00:00.000Z" },
    remotePayload: { versionNumber: 4, authorId: "user-2", createdAt: "2026-08-20T00:01:00.000Z" },
    createdAt: "2026-08-20T00:01:00.000Z",
    ...overrides,
  };
}

const item: Item = {
  id: "item-1",
  libraryId: "lib-1",
  kind: "pdf",
  title: "Quantum Paper",
  canonicalName: "quantum-paper",
  metadata: {},
  status: "conflicted",
  createdBy: "user-1",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

const annotation: Annotation = {
  id: "ann-1",
  itemId: "item-1",
  versionId: "v1",
  authorId: "user-1",
  kind: "highlight",
  target: { locatorType: "pdf-page", locator: { page: 1 } },
  style: {},
  body: {},
  status: "conflicted",
  revision: 2,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

describe("conflict classification", () => {
  it.each([
    ["binary-version", "Binary version conflict", "adopt-remote", true],
    ["annotation-revision", "Annotation revision conflict", "merge-annotations", true],
    ["delete-edit", "Delete vs edit conflict", "restore-deletion", true],
    ["permission-revoked", "Permission revoked", "keep-local", false],
    ["quota-exceeded", "Quota exceeded", "keep-local", false],
  ] as const)("classifies %s", (reason, label, recommended, recoverable) => {
    const meta = classifyConflictReason(reason);
    expect(meta.label).toBe(label);
    expect(meta.recommended.kind).toBe(recommended);
    expect(meta.recoverable).toBe(recoverable);
  });
});

describe("conflict view model", () => {
  it("shows entity, both versions, creator, time, recommended action and recoverable payload", () => {
    const [view] = buildConflictViewModels([conflict()], [item], [annotation]);

    expect(view.conflictId).toBe("conflict-1");
    expect(view.title).toBe("Quantum Paper");
    expect(view.entityType).toBe("item");
    expect(view.reason).toBe("binary-version");
    expect(view.local?.versionLabel).toContain("v3");
    expect(view.local?.versionLabel).toContain("local");
    expect(view.local?.authorId).toBe("user-1");
    expect(view.remote?.versionLabel).toContain("v4");
    expect(view.remote?.versionLabel).toContain("remote");
    expect(view.remote?.authorId).toBe("user-2");
    expect(view.recommendedAction.kind).toBe("adopt-remote");
    expect(view.recoverable).toBe(true);
    expect(view.recoverablePayload).toMatchObject({ versionNumber: 4 });
  });

  it("falls back to the entity id as title when the item is unknown", () => {
    const [view] = buildConflictViewModels([conflict()], [], []);
    expect(view.title).toBe("item-1");
  });
});

describe("conflict resolution actions map to operations", () => {
  const actions: ConflictResolutionAction[] = [
    { kind: "keep-local" },
    { kind: "adopt-remote" },
    { kind: "copy-as-new-item" },
    { kind: "merge-annotations" },
    { kind: "restore-deletion" },
  ];
  const expectedTypes = [
    "conflict.resolve.keep-local",
    "conflict.resolve.adopt-remote",
    "item.copy",
    "annotation.merge",
    "item.restore",
  ];

  it("emits a distinct operation per action", () => {
    actions.forEach((action, index) => {
      const operation = conflictActionToOperation(action, conflict());
      expect(operation.operationType).toBe(expectedTypes[index]);
      expect(operation.payload.conflictId).toBe("conflict-1");
    });
  });

  it("labels each action for the UI", () => {
    expect(conflictActionLabel({ kind: "keep-local" })).toBe("Keep local");
    expect(conflictActionLabel({ kind: "adopt-remote" })).toBe("Adopt remote");
    expect(conflictActionLabel({ kind: "copy-as-new-item" })).toBe("Copy as new item");
    expect(conflictActionLabel({ kind: "merge-annotations" })).toBe("Merge annotations");
    expect(conflictActionLabel({ kind: "restore-deletion" })).toBe("Restore deletion");
  });
});

describe("ConflictCenter", () => {
  it("renders conflict cards with entity, sides, recommendation and resolve actions", () => {
    render(
      <ConflictCenter
        conflicts={[conflict()]}
        items={[item]}
        annotations={[annotation]}
        viewerRole="owner"
        onResolve={() => {}}
      />,
    );

    expect(screen.getByTestId("conflict-center")).toBeTruthy();
    expect(screen.getByTestId("conflict-card")).toBeTruthy();
    expect(screen.getByText("Quantum Paper")).toBeTruthy();
    expect(screen.getByText(/Binary version conflict/)).toBeTruthy();
    expect(screen.getByTestId("conflict-recommended")).toBeTruthy();
    expect(screen.getByTestId("conflict-resolve-recommended")).toBeTruthy();
    expect(screen.getByTestId("conflict-resolve-keep-local")).toBeTruthy();
  });

  it("calls onResolve with the recommended action", () => {
    const onResolve = vi.fn();
    render(
      <ConflictCenter
        conflicts={[conflict()]}
        items={[item]}
        annotations={[annotation]}
        viewerRole="owner"
        onResolve={onResolve}
      />,
    );

    fireEvent.click(screen.getByTestId("conflict-resolve-recommended"));
    expect(onResolve).toHaveBeenCalledWith("conflict-1", { kind: "adopt-remote" });
  });

  it("hides resolve controls from viewers", () => {
    render(
      <ConflictCenter
        conflicts={[conflict()]}
        items={[item]}
        annotations={[annotation]}
        viewerRole="viewer"
        onResolve={() => {}}
      />,
    );

    expect(screen.getByTestId("conflict-card")).toBeTruthy();
    expect(screen.queryByTestId("conflict-resolve-recommended")).toBeNull();
    expect(screen.queryByTestId("conflict-resolve-keep-local")).toBeNull();
  });

  it("renders an empty state when there are no conflicts", () => {
    render(
      <ConflictCenter conflicts={[]} items={[]} annotations={[]} viewerRole="owner" />,
    );
    expect(screen.getByText(/No conflicts/i)).toBeTruthy();
  });
});

describe("activity feed", () => {
  const events: ActivityEvent[] = [
    {
      id: "e1",
      libraryId: "lib-1",
      actorId: "user-1",
      verb: "created",
      entityType: "item",
      entityId: "item-1",
      targetLabel: "Quantum Paper",
      createdAt: "2026-08-20T00:00:00.000Z",
    },
    {
      id: "e2",
      libraryId: "lib-1",
      actorId: "user-2",
      verb: "annotated",
      entityType: "annotation",
      entityId: "ann-1",
      targetLabel: "Quantum Paper",
      createdAt: "2026-08-20T00:02:00.000Z",
    },
  ];

  it("sorts newest first", () => {
    const feed = buildActivityFeed(events);
    expect(feed[0].id).toBe("e2");
    expect(feed[1].id).toBe("e1");
  });

  it("labels verbs for the UI", () => {
    expect(activityVerbLabel("created")).toBe("created");
    expect(activityVerbLabel("role-changed")).toBe("changed role");
  });

  it("renders the panel in newest-first order", () => {
    render(<ActivityPanel events={events} />);
    expect(screen.getByTestId("activity-panel")).toBeTruthy();
    const items = screen.getAllByTestId("activity-item");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("Quantum Paper");
  });
});
