export type ShortcutScope = "markdown-editor" | "quantum-hud" | "table-editor";

export interface ShortcutSpec {
  id: string;
  scope: ShortcutScope;
  key: string;
  mac?: string;
  enabledByDefault: boolean;
  reason?: string;
}

const MODIFIER_ALIASES: Record<string, string> = {
  cmd: "mod",
  command: "mod",
  ctrl: "ctrl",
  control: "ctrl",
  mod: "mod",
  alt: "alt",
  option: "alt",
  shift: "shift",
};

const MODIFIER_ORDER = ["mod", "ctrl", "alt", "shift"];

export function normalizeShortcutKey(key: string): string {
  const parts = key
    .split("-")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length === 0) return "";

  const modifiers: string[] = [];
  const baseParts: string[] = [];

  for (const part of parts) {
    const alias = MODIFIER_ALIASES[part];
    if (alias) {
      if (!modifiers.includes(alias)) modifiers.push(alias);
    } else {
      baseParts.push(part);
    }
  }

  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...modifiers, baseParts.join("-")].filter(Boolean).join("-");
}

const RESERVED_SHORTCUT_KEYS = new Set(
  [
    "Ctrl-F",
    "Cmd-F",
    "Ctrl-L",
    "Cmd-L",
    "Ctrl-N",
    "Cmd-N",
    "Ctrl-O",
    "Cmd-O",
    "Ctrl-P",
    "Cmd-P",
    "Ctrl-R",
    "Cmd-R",
    "Ctrl-S",
    "Cmd-S",
    "Ctrl-T",
    "Cmd-T",
    "Ctrl-W",
    "Cmd-W",
    "Ctrl-Shift-F",
    "Cmd-Shift-F",
    "Ctrl-Shift-I",
    "Cmd-Alt-I",
    "Ctrl-Shift-R",
    "Cmd-Shift-R",
    "Ctrl-Shift-S",
    "Cmd-Shift-S",
    "Ctrl-Shift-U",
    "Ctrl-Shift-V",
    "Cmd-Shift-V",
    "Cmd-[",
    "Cmd-]",
  ].map(normalizeShortcutKey)
);

export function isReservedShortcut(key: string): boolean {
  return RESERVED_SHORTCUT_KEYS.has(normalizeShortcutKey(key));
}

export interface ShortcutConflict {
  shortcutId: string;
  key: string;
  type: "reserved" | "duplicate";
  conflictsWith?: string;
}

export function findShortcutConflicts(shortcuts: ShortcutSpec[]): ShortcutConflict[] {
  const conflicts: ShortcutConflict[] = [];
  const seen = new Map<string, ShortcutSpec>();

  for (const shortcut of shortcuts) {
    if (!shortcut.enabledByDefault) continue;

    const keys = [shortcut.key, shortcut.mac].filter((key): key is string => Boolean(key));
    for (const key of keys) {
      const normalized = normalizeShortcutKey(key);
      const seenKey = `${shortcut.scope}:${normalized}`;
      const previous = seen.get(seenKey);

      if (isReservedShortcut(key)) {
        conflicts.push({ shortcutId: shortcut.id, key, type: "reserved" });
      }

      if (previous) {
        conflicts.push({
          shortcutId: shortcut.id,
          key,
          type: "duplicate",
          conflictsWith: previous.id,
        });
      } else {
        seen.set(seenKey, shortcut);
      }
    }
  }

  return conflicts;
}
