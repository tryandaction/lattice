import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { queueQuantumMathInput } from "@/lib/quantum-input-session";
import { getActiveInputTarget, getLastActiveInputTarget } from "@/lib/unified-input-handler";
import { useQuantumPreferences } from "./preferences";
import { useQuantumPluginRuntime } from "./runtime";
import type { QuantumCatalogEntry } from "./catalog";
import { resolveQuantumInputAction, type CandidatePrefix } from "./input-policy";
import { resolveControlFormulaChord, type ControlFormulaChord } from "./shortcut-engine";

type Layer = "base" | "ctrl";
interface ControlChordSession {
  keyCode: "KeyI" | "KeyM";
  origin: HTMLElement;
  modifier: "ctrl" | "meta";
  digits: string;
  invalid: boolean;
}
interface KeyboardInputOptions {
  catalog: QuantumCatalogEntry[];
  insert: (entry: QuantumCatalogEntry) => void;
  close: () => void;
  report: (value: string) => void;
  zh: boolean;
  lookup: () => void;
  commitControlChord: (chord: ControlFormulaChord) => void;
}

function inputRoot(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement) || target.closest("[data-quantum-keyboard]")) return null;
  if (target.closest(".cm-search, .cm-panels, input, select, button")) return null;
  const mathfield = target.closest("math-field");
  if (mathfield instanceof HTMLElement) return mathfield;
  const textarea = target.closest("textarea");
  if (textarea instanceof HTMLTextAreaElement && !textarea.disabled && !textarea.readOnly) return textarea;
  const content = target.closest(".cm-content[contenteditable='true']");
  if (content instanceof HTMLElement) return content.closest(".cm-editor") as HTMLElement ?? content;
  const editable = target.closest("[contenteditable='true']");
  return editable instanceof HTMLElement ? editable : null;
}

function hasAltGraph(event: KeyboardEvent): boolean {
  return event.getModifierState("AltGraph");
}

function sameEditor(origin: HTMLElement, target: HTMLElement): boolean {
  if (origin === target) return true;
  const editor = origin.closest(".cm-editor");
  return Boolean(editor && target.closest(".cm-editor") === editor);
}

export function finishQuantumFormula(): boolean {
  const target = getActiveInputTarget() ?? getLastActiveInputTarget();
  if (!target?.element.isConnected) return false;
  if (target.type === "mathlive") {
    target.element.dispatchEvent(new CustomEvent("quantum-finish-formula"));
    return true;
  }
  if (target.type === "codemirror") {
    if (queueQuantumMathInput(target.element, field => field.dispatchEvent(new CustomEvent("quantum-finish-formula")))) return true;
    return !target.element.dispatchEvent(new CustomEvent("quantum-edit-formula", { cancelable: true }));
  }
  target.focus();
  return false;
}

export function useKeyboardInput(options: KeyboardInputOptions) {
  const [prefix, setPrefix] = useState<CandidatePrefix | null>(null);
  const [choosingKey, setChoosingKey] = useState<string | null>(null);
  const [choosingLayer, setChoosingLayer] = useState<Layer>("base");
  const [candidateIndex, setCandidateIndex] = useState(1);
  const choiceOrigin = useRef<HTMLElement | null>(null);
  const heldSymbolKeys = useRef(new Set<string>());
  const chord = useRef<ControlChordSession | null>(null);
  const candidateCount = options.catalog.filter(entry => entry.keyCode === choosingKey && entry.layer === choosingLayer).length;
  const visibleCandidateIndex = Math.min(candidateIndex, Math.max(1, candidateCount));
  const clearChoice = useCallback(() => {
    choiceOrigin.current = null;
    setChoosingKey(null);
    setPrefix(null);
    setCandidateIndex(1);
  }, []);
  const latest = useRef({ ...options, prefix, choosingKey, choosingLayer, candidateIndex: visibleCandidateIndex });
  useLayoutEffect(() => {
    latest.current = { ...options, prefix, choosingKey, choosingLayer, candidateIndex: visibleCandidateIndex };
  });

  useEffect(() => {
    const cancelChord = (message?: string) => {
      chord.current = null;
      if (message) latest.current.report(message);
    };
    const chooseKey = (keyCode: string, layer: Layer, origin: HTMLElement) => {
      choiceOrigin.current = origin;
      setChoosingKey(keyCode);
      setChoosingLayer(layer);
      setPrefix(null);
      setCandidateIndex(1);
      useQuantumPreferences.setState({ selectedKey: keyCode });
      latest.current.report(latest.current.zh
        ? "按当前候选编号输入，或用方向键选择后按 Enter；Esc 取消。"
        : "Press the visible number, or use arrows then Enter. Esc cancels.");
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      let current = latest.current;
      const root = inputRoot(event.target);
      if (root && choiceOrigin.current && !sameEditor(choiceOrigin.current, root)) {
        clearChoice();
        heldSymbolKeys.current.clear();
        current = { ...current, choosingKey: null, prefix: null, candidateIndex: 1 };
      }
      const activeChord = chord.current;

      if (activeChord) {
        if (!root || root !== activeChord.origin || event.isComposing || hasAltGraph(event)) {
          cancelChord(current.zh ? "编辑位置改变，Ctrl 组合已取消。" : "Editing position changed; chord cancelled.");
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelChord(current.zh ? "Ctrl 组合已取消。" : "Ctrl chord cancelled.");
          return;
        } else if (event.key === "Backspace" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (activeChord.invalid) activeChord.invalid = false;
          else activeChord.digits = activeChord.digits.slice(0, -1);
          current.report(current.zh ? "组合数字 " + activeChord.digits : "Chord digits " + activeChord.digits);
          return;
        } else if (/^(?:Digit|Numpad)\d$/.test(event.code) && event.ctrlKey) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.repeat) return;
          if (activeChord.digits.length >= 2) {
            activeChord.invalid = true;
            current.report(current.zh ? "组合最多两位数字；按 Backspace 修正，或 Esc 取消。" : "Use at most two digits; Backspace corrects, Esc cancels.");
          } else {
            activeChord.digits += event.code.slice(-1);
            current.report(
              (current.zh ? (activeChord.keyCode === "KeyM" ? "矩阵尺寸 " : "积分类型 ") : (activeChord.keyCode === "KeyM" ? "Matrix size " : "Integral ")) +
              activeChord.digits + (current.zh ? " · 松开 Ctrl 输入" : " · release Ctrl to insert"),
            );
          }
          return;
        } else if (event.code === activeChord.keyCode) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        } else if (event.key !== "Control" && event.key !== "Meta") {
          cancelChord(current.zh ? "Ctrl 组合已取消。" : "Ctrl chord cancelled.");
        }
      }

      if (!root) {
        const uiTarget = event.target instanceof HTMLElement ? event.target : null;
        if (event.key === "Escape" && uiTarget?.closest(".qk-settings")) return;
        if (uiTarget?.closest("[data-quantum-keyboard]")) {
          if (uiTarget.closest("[data-quantum-matrix-size], [data-quantum-search]")) return;
          if (event.key === "Escape" && !event.isComposing) {
            event.preventDefault();
            event.stopImmediatePropagation();
            current.close();
          }
          if (event.key === "F4") {
            event.preventDefault();
            useQuantumPluginRuntime.setState({ tab: "input" });
            getLastActiveInputTarget()?.focus();
          }
        }
        return;
      }

      if (event.isComposing || hasAltGraph(event)) return;
      const preferences = useQuantumPreferences.getState();
      if (event.repeat && (heldSymbolKeys.current.has(event.code)
        || (!event.ctrlKey && !event.metaKey && /^Key[A-Z]$/.test(event.code) && (preferences.shortcutMode || event.altKey || current.prefix)))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!event.repeat && event.ctrlKey && !event.altKey && !event.metaKey && /^Key[IM]$/.test(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        chord.current = {
          keyCode: event.code as "KeyI" | "KeyM",
          origin: root,
          modifier: "ctrl",
          digits: "",
          invalid: false,
        };
        heldSymbolKeys.current.add(event.code);
        clearChoice();
        current.report(current.zh ? "保持 Ctrl 按住，依次按数字，松开 Ctrl 输入。" : "Keep Ctrl held, type the digits in order, then release Ctrl to insert.");
        return;
      }

      const action = resolveQuantumInputAction(
        event,
        preferences.shortcutMode ? "symbols" : "variables",
        preferences.layer,
        current.prefix,
        current.choosingKey,
        current.choosingLayer,
      );
      if (action.kind === "navigate") {
        const target = getActiveInputTarget() ?? getLastActiveInputTarget();
        if (target?.type === "mathlive") {
          event.preventDefault(); event.stopImmediatePropagation();
          (target.element as HTMLElement & { executeCommand?: (command: string) => unknown }).executeCommand?.(action.direction === "next" ? "moveToNextPlaceholder" : "moveToPreviousPlaceholder");
          return;
        }
        if (target?.type === "codemirror" && queueQuantumMathInput(target.element, field => field.executeCommand(action.direction === "next" ? "moveToNextPlaceholder" : "moveToPreviousPlaceholder"))) {
          event.preventDefault(); event.stopImmediatePropagation();
          return;
        }
        clearChoice();
        return;
      }
      if (action.kind === "matrix") {
        const target = getActiveInputTarget() ?? getLastActiveInputTarget();
        if (target?.type === "mathlive") {
          event.preventDefault(); event.stopImmediatePropagation();
          (target.element as HTMLElement & { executeCommand: (command: string) => boolean }).executeCommand(action.command);
          return;
        }
        if (target?.type === "codemirror" && queueQuantumMathInput(target.element, field => field.executeCommand(action.command))) {
          event.preventDefault(); event.stopImmediatePropagation();
          return;
        }
        return;
      }
      if (action.kind === "pass") {
        const target = getActiveInputTarget() ?? getLastActiveInputTarget();
        if (target?.type === "codemirror" && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1
          && queueQuantumMathInput(target.element, field => field.insert(event.key, { insertionMode: "replaceSelection", selectionMode: "after" }))) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (!event.repeat && !["Alt", "Shift", "Control", "Meta"].includes(event.key)) clearChoice();
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      if (action.kind === "choose-key" || action.kind === "insert" || action.kind === "prefix") heldSymbolKeys.current.add(event.code);
      switch (action.kind) {
        case "close": current.close(); break;
        case "cancel": clearChoice(); break;
        case "toggle-mode":
          useQuantumPreferences.setState({ shortcutMode: !preferences.shortcutMode });
          clearChoice(); break;
        case "toggle-layer":
          useQuantumPreferences.setState({ layer: preferences.layer === "base" ? "ctrl" : "base" });
          clearChoice(); break;
        case "configure":
          useQuantumPluginRuntime.setState({ tab: "settings" });
          queueMicrotask(() => document.querySelector<HTMLInputElement>("[data-quantum-keyboard] .qk-settings input")?.focus());
          break;
        case "lookup": clearChoice(); current.lookup(); break;
        case "finish":
          finishQuantumFormula();
          useQuantumPreferences.setState({ shortcutMode: false });
          clearChoice(); break;
        case "prefix": choiceOrigin.current = root; setPrefix(action.prefix); setChoosingKey(null); break;
        case "choose-key": chooseKey(action.keyCode, action.layer, root); break;
        case "candidate-step": {
          const count = current.catalog.filter(entry => entry.keyCode === current.choosingKey && entry.layer === current.choosingLayer).length;
          if (count) setCandidateIndex(((current.candidateIndex - 1 + action.delta + count) % count) + 1);
          break;
        }
        case "candidate-confirm": {
          const entry = current.catalog.filter(entry => entry.keyCode === current.choosingKey && entry.layer === current.choosingLayer)[current.candidateIndex - 1];
          if (entry) current.insert(entry);
          else current.report(current.zh ? "此键当前没有可用候选，请重新选择。" : "This key has no available candidates. Select a key again.");
          clearChoice(); break;
        }
        case "insert": {
          const entry = current.catalog.filter(candidate => candidate.keyCode === action.keyCode && candidate.layer === action.layer)[action.index - 1];
          if (!entry) current.report(current.zh ? "此键没有第 " + action.index + " 项。" : "This key has no candidate " + action.index + ".");
          else { useQuantumPreferences.setState({ selectedKey: action.keyCode }); current.insert(entry); }
          clearChoice(); break;
        }
      }
    };

    const cancelOnBlur = () => {
      if (chord.current) cancelChord(latest.current.zh ? "窗口焦点改变，Ctrl 组合已取消。" : "Window focus changed; chord cancelled.");
      clearChoice();
      heldSymbolKeys.current.clear();
    };
    const handleFocusIn = (event: FocusEvent) => {
      const origin = choiceOrigin.current;
      if (!origin || (event.target instanceof HTMLElement && event.target.closest("[data-quantum-keyboard]"))) return;
      const root = inputRoot(event.target);
      if (!root || !sameEditor(origin, root)) {
        clearChoice();
        heldSymbolKeys.current.clear();
      }
    };
    const handleFocusOut = (event: FocusEvent) => {
      const active = chord.current;
      if (!active || !(event.target instanceof Node) || !active.origin.contains(event.target)) return;
      if (event.relatedTarget instanceof Node && active.origin.contains(event.relatedTarget)) return;
      cancelChord(latest.current.zh ? "编辑位置改变，Ctrl 组合已取消。" : "Editing position changed; chord cancelled.");
    };
    const finishChord = (event: KeyboardEvent) => {
      const active = chord.current;
      if (!active) return;
      const root = inputRoot(document.activeElement);
      if (event.isComposing || hasAltGraph(event) || !active.origin.isConnected || root !== active.origin) {
        cancelChord(latest.current.zh ? "编辑位置改变，Ctrl 组合已取消。" : "Editing position changed; chord cancelled.");
        return;
      }
      if (active.invalid) {
        cancelChord(latest.current.zh ? "组合数字超过两位，已取消。" : "Chord exceeded two digits and was cancelled.");
        return;
      }
      if (!active.digits) {
        cancelChord(latest.current.zh ? "Ctrl 组合已取消。" : "Ctrl chord cancelled.");
        return;
      }
      const result = resolveControlFormulaChord(active.keyCode, active.digits);
      chord.current = null;
      if (result) latest.current.commitControlChord(result);
      else latest.current.report(latest.current.zh ? "该积分或矩阵尺寸不存在。" : "Unsupported integral or matrix dimensions.");
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      heldSymbolKeys.current.delete(event.code);
      const active = chord.current;
      if (!active) return;
      if (event.key === "Escape" || event.key === "Backspace") return;
      if (active.modifier === "ctrl" && event.key.startsWith("Control") && !event.ctrlKey) finishChord(event);
      else if (active.modifier === "meta" && event.key.startsWith("Meta") && !event.metaKey) finishChord(event);
    };
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") cancelOnBlur();
    };
    const unsubscribePreferences = useQuantumPreferences.subscribe((state, previous) => {
      if (state.mappingSource !== previous.mappingSource) clearChoice();
    });

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", cancelOnBlur);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", cancelOnBlur);
      chord.current = null;
      unsubscribePreferences();
    };
  }, [clearChoice]);

  return {
    prefix, choosingKey, choosingLayer, candidateIndex: visibleCandidateIndex,
    chooseKey: (keyCode: string, layer: Layer = useQuantumPreferences.getState().layer) => {
      const target = getActiveInputTarget() ?? getLastActiveInputTarget();
      choiceOrigin.current = target?.element.isConnected ? inputRoot(target.element) ?? target.element : null;
      setChoosingKey(keyCode); setChoosingLayer(layer); setPrefix(null); setCandidateIndex(1);
      useQuantumPreferences.setState({ selectedKey: keyCode });
      latest.current.report(latest.current.zh ? "按当前候选编号输入，或用方向键选择后按 Enter；Esc 取消。" : "Press the visible number, or use arrows then Enter. Esc cancels.");
    },
    clearChoice,
  };
}
