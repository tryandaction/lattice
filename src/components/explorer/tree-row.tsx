"use client";

import type { ComponentProps, KeyboardEvent } from "react";
import { BookOpen, Code, File, FileCode, FileText, Image as ImageIcon, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";

type RowProps = ComponentProps<"button"> & { depth: number; directory?: boolean; selected?: boolean; as?: "button" };
type ContainerProps = ComponentProps<"div"> & { depth: number; directory?: boolean; selected?: boolean; as: "div" };

/** The same visible row frame is used by native entries and source adapters. */
export function ExplorerTreeRow(props: RowProps | ContainerProps) {
  const { as = "button", depth, directory, selected, className, style, ...rest } = props;
  const shared = {
    "data-explorer-node": "true",
    "data-explorer-depth": depth,
    className: cn("flex w-full items-center px-2 py-1 text-left text-sm transition-colors", directory ? "gap-1" : "gap-2", selected && (directory ? "bg-accent/70" : "bg-accent"), className),
    style: { paddingLeft: `${depth * 12 + (directory ? 4 : 8)}px`, ...style },
  };
  return as === "div"
    ? <div {...rest as ComponentProps<"div">} {...shared} />
    : <button type="button" data-explorer-focus="true" {...rest as ComponentProps<"button">} {...shared} />;
}

export function ExplorerFileIcon({ extension, className }: { extension: string; className?: string }) {
  const normalized = extension.toLowerCase();
  const Icon = normalized === "pdf" || normalized === "txt" ? FileText
    : normalized === "ppt" || normalized === "pptx" ? Presentation
      : normalized === "md" ? FileCode : normalized === "py" ? Code
        : normalized === "ipynb" ? BookOpen : ["png", "jpg", "jpeg"].includes(normalized) ? ImageIcon : File;
  return <Icon className={className} />;
}

/** DOM order is shared by local and remote trees; moving focus never opens a file. */
export function handleTreeNavigation(event: KeyboardEvent<HTMLDivElement>): boolean {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return false;
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return false;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-explorer-focus='true']"));
  if (!rows.length) return false;
  const index = rows.indexOf(target.closest<HTMLButtonElement>("[data-explorer-focus='true']")!);
  const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
    : event.key === "ArrowUp" ? Math.max(0, index - 1) : Math.min(rows.length - 1, index + 1);
  event.preventDefault();
  rows[next]?.focus();
  return true;
}
