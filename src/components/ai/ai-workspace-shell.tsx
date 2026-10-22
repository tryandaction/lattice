"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AIWorkspaceShell({
  className,
  header,
  status,
  body,
}: {
  className?: string;
  header: ReactNode;
  status: ReactNode;
  body: ReactNode;
}) {
  return (
    <section
      className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background", className)}
      data-testid="ai-chat-panel"
      data-workspace-shell="ai"
    >
      {header}
      {status}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="ai-workspace-body">
        {body}
      </div>
    </section>
  );
}
