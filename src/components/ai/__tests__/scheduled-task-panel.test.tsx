import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const storage = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/storage-adapter", () => ({ getStorageAdapter: () => storage }));
vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => ({
      "chat.scheduledTasks.title": "Scheduled Tasks",
      "chat.scheduledTasks.create": "Create task",
      "chat.scheduledTasks.titlePlaceholder": "Task title",
      "chat.scheduledTasks.promptPlaceholder": "What should this task do?",
      "chat.scheduledTasks.promptLabel": "Task prompt",
      "chat.scheduledTasks.schedule.once": "Once",
      "chat.scheduledTasks.schedule.interval": "Interval",
      "chat.scheduledTasks.runNow": "Run now",
      "chat.scheduledTasks.pause": "Pause",
      "chat.scheduledTasks.resume": "Resume",
      "chat.scheduledTasks.delete": "Delete",
      "chat.scheduledTasks.retry": "Retry",
      "chat.scheduledTasks.empty": "No scheduled tasks",
      "chat.scheduledTasks.runs": "Runs",
      "chat.scheduledTasks.status.active": "Active",
      "chat.scheduledTasks.status.completed": "Completed",
      "chat.scheduledTasks.status.failed": "Failed",
      "chat.scheduledTasks.status.paused": "Paused",
    }[key] ?? key),
  }),
}));

import { ScheduledTaskPanel } from "../scheduled-task-panel";
import { useScheduledTaskStore } from "@/stores/scheduled-task-store";

describe("ScheduledTaskPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.get.mockResolvedValue(null);
    useScheduledTaskStore.getState().resetForTests();
  });

  it("blocks task creation when no approved executor is configured", async () => {
    render(<ScheduledTaskPanel />);
    await waitFor(() => expect(screen.getByTestId("scheduled-task-panel")).not.toBeNull());

    expect(screen.getByTestId("scheduled-task-executor-unavailable")).not.toBeNull();
    expect(screen.getByTestId("scheduled-task-create")).toHaveProperty("disabled", true);
  });
});
