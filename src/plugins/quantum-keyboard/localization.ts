import type { Locale } from "@/types/settings";

const COMMAND_LABELS: Record<string, Record<Locale, string>> = {
  "quantum-keyboard.open": { "zh-CN": "打开量子键盘", "en-US": "Open Quantum Keyboard" },
  "quantum-keyboard.configure": { "zh-CN": "配置量子键盘", "en-US": "Configure Quantum Keyboard" },
  "quantum-keyboard.close": { "zh-CN": "关闭量子键盘", "en-US": "Close Quantum Keyboard" },
};

export function localizeQuantumKeyboardCommand(id: string, locale: Locale, fallback: string): string {
  return COMMAND_LABELS[id]?.[locale] ?? fallback;
}
