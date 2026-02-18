"use client";

import { useEffect, useRef } from "react";
import { getRegisteredCommands, subscribePluginRegistry } from "@/lib/plugins/runtime";

/**
 * Parses a shortcut string like "Ctrl+Shift+H" into a matcher.
 */
function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+").map((p) => p.trim().toLowerCase());
  const needCtrl = parts.includes("ctrl") || parts.includes("control");
  const needShift = parts.includes("shift");
  const needAlt = parts.includes("alt");
  const needMeta = parts.includes("meta") || parts.includes("cmd");
  const key = parts.filter(
    (p) => !["ctrl", "control", "shift", "alt", "meta", "cmd"].includes(p)
  )[0];

  if (!key) return false;
  if (needCtrl !== (e.ctrlKey || e.metaKey)) return false;
  if (needShift !== e.shiftKey) return false;
  if (needAlt !== e.altKey) return false;
  if (needMeta && !e.metaKey) return false;

  return e.key.toLowerCase() === key;
}

/**
 * Registers global keyboard shortcuts for plugin commands that have a `shortcut` field.
 */
export function usePluginShortcuts() {
  const commandsRef = useRef(getRegisteredCommands());

  useEffect(() => {
    // Keep commands in sync with registry
    const unsub = subscribePluginRegistry(() => {
      commandsRef.current = getRegisteredCommands();
    });

    const handler = (e: KeyboardEvent) => {
      for (const cmd of commandsRef.current) {
        if (cmd.shortcut && matchesShortcut(e, cmd.shortcut)) {
          e.preventDefault();
          e.stopPropagation();
          cmd.run();
          return;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      unsub();
    };
  }, []);
}
