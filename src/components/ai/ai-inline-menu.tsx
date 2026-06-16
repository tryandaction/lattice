"use client";

interface AiInlineMenuProps {
  selectedText: string;
  position: { x: number; y: number };
  onInsert: (text: string) => void;
  onReplace: (text: string) => void;
  onClose: () => void;
}

export function AiInlineMenu(_props: AiInlineMenuProps) {
  return null;
}
