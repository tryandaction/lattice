"use client";

export async function copyToClipboard(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const textInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
    const inputSelection = textInput && textInput.selectionStart !== null
      ? { start: textInput.selectionStart, end: textInput.selectionEnd, direction: textInput.selectionDirection }
      : null;
    const selection = document.getSelection();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
    const textarea = document.createElement("textarea");
    // Explicit copy actions own this one event; a viewer's global selection
    // handler must not replace formula/source text with its frozen selection.
    const handleCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      event.clipboardData.setData("text/plain", content);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    try {
      textarea.value = content;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      window.addEventListener("copy", handleCopy, true);
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      window.removeEventListener("copy", handleCopy, true);
      textarea.remove();
      active?.focus({ preventScroll: true });
      if (selection) {
        selection.removeAllRanges();
        for (const range of ranges) selection.addRange(range);
      }
      if (textInput && inputSelection) {
        textInput.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction ?? undefined);
      }
    }
  }
}
