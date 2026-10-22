export interface AiStreamAccumulator {
  append(text: string): void;
  finish(): void;
  abort(message?: string): void;
  error(message: string): void;
  text(): string;
  hasText(): boolean;
  isTerminal(): boolean;
  errorMessage(): string | null;
}

export function createAiStreamAccumulator(): AiStreamAccumulator {
  let value = "";
  let terminal = false;
  let failure: string | null = null;

  return {
    append(text) {
      if (terminal || !text) return;
      value += text;
    },
    finish() {
      terminal = true;
    },
    abort(message = "Generation cancelled") {
      terminal = true;
      failure = message;
    },
    error(message) {
      terminal = true;
      failure = message.trim() || "AI provider stream failed";
    },
    text: () => value,
    hasText: () => value.trim().length > 0,
    isTerminal: () => terminal,
    errorMessage: () => failure,
  };
}
