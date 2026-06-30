'use client';

/**
 * Keyboard HUD Component
 * Quantum Keyboard - A floating bubble with stable positioning
 * 
 * Stable Positioning:
 * - Opens at the top or bottom center so it does not cover the current pointer area
 * - Stays where the user drags it until explicitly reset
 */

import "katex/dist/katex.min.css";
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence, useDragControls, PanInfo } from 'framer-motion';
import { SymbolSelector } from './symbol-selector';
import { useHUDStore } from '../../stores/hud-store';
import { useQuantumCustomStore, getAllSymbolsForKey } from '../../stores/quantum-custom-store';
import {
  getEffectiveQuantumLayerMeanings,
  useQuantumKeymapStore,
} from '../../stores/quantum-keymap-store';
import { getActiveMathField, getGlobalTiptapEditor, setActiveMathField } from './hud-provider';
import type { QuantumInsertPayload } from './hud-provider';
import {
  quantumKeymap,
  getCandidateLabel,
  getVariants,
  KEY_LABELS,
  QWERTY_LAYOUT,
  type QuantumLayerId,
} from '../../config/quantum-keymap';
import { resolveQuantumKeyboardInput } from './hud-logic';
import { GripHorizontal, RotateCcw } from 'lucide-react';
import { logger } from '@/lib/logger';
import { getActiveInputTarget, getLastActiveInputTarget } from '@/lib/unified-input-handler';
import { useI18n } from '@/hooks/use-i18n';
import type { MathfieldElement } from 'mathlive';

export interface KeyboardHUDProps {
  onInsertSymbol: (input: string | QuantumInsertPayload) => void;
}

type MathfieldWithCommands = MathfieldElement & {
  executeCommand: (command: string) => unknown;
  insert: (latex: string, options?: { insertionMode?: string; selectionMode?: string }) => void;
  getValue?: () => string;
};

/**
 * Find and return the bounding rect of the current input target
 */
function findInputTargetRect(): DOMRect | null {
  // Priority 1: Focused math field
  const focusedMathField = document.querySelector('math-field:focus') as HTMLElement;
  if (focusedMathField) {
    return focusedMathField.getBoundingClientRect();
  }

  // Priority 2: Active saved input target. HUD focus intentionally moves to the
  // hidden key-capture input, so the last real target is the best anchor.
  const target = getActiveInputTarget() || getLastActiveInputTarget();
  if (target) {
    const cursor = target.element.querySelector?.('.cm-cursor') as HTMLElement | null;
    if (cursor) {
      const cursorRect = cursor.getBoundingClientRect();
      if (cursorRect.height > 0) return cursorRect;
    }
    return target.element.getBoundingClientRect();
  }
  
  // Priority 3: Text selection
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      return rect;
    }
  }
  
  return null;
}

function isQuantumMathEditorFocused(): boolean {
  const active = document.activeElement as HTMLElement | null;
  return Boolean(
    active?.closest('math-field') ||
    active?.closest('.cm-quantum-math-editor')
  );
}

export function KeyboardHUD({ onInsertSymbol }: KeyboardHUDProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragControls = useDragControls();
  const activeMathFieldRef = useRef<HTMLElement | null>(null);
  const isProcessingEnterRef = useRef(false);
  const [selectorAnchor, setSelectorAnchor] = useState({ x: 0, y: 0 });
  const [candidatePrefix, setCandidatePrefix] = useState<number | null>(null);
  const [activeLayer, setActiveLayer] = useState<QuantumLayerId>('base');
  const [lastActionLabel, setLastActionLabel] = useState('ready');

  // Store state
  const isOpen = useHUDStore((state) => state.isOpen);
  const activeSymbolKey = useHUDStore((state) => state.activeSymbolKey);
  const highlightedIndex = useHUDStore((state) => state.highlightedIndex);
  const isEditMode = useHUDStore((state) => state.isEditMode);
  const customOffset = useHUDStore((state) => state.customOffset);
  const isDragging = useHUDStore((state) => state.isDragging);
  // Note: cursorPosition is managed in store, we use computeOptimalPosition instead

  // Store actions
  const closeHUD = useHUDStore((state) => state.closeHUD);
  const openSymbolSelector = useHUDStore((state) => state.openSymbolSelector);
  const closeSymbolSelector = useHUDStore((state) => state.closeSymbolSelector);
  const navigateSymbol = useHUDStore((state) => state.navigateSymbol);
  const selectSymbol = useHUDStore((state) => state.selectSymbol);
  const flashKey = useHUDStore((state) => state.flashKey);
  const toggleEditMode = useHUDStore((state) => state.toggleEditMode);
  const setCustomOffset = useHUDStore((state) => state.setCustomOffset);
  const setIsDragging = useHUDStore((state) => state.setIsDragging);
  const updateCursorPosition = useHUDStore((state) => state.updateCursorPosition);
  const updateHUDSize = useHUDStore((state) => state.updateHUDSize);
  const resetPosition = useHUDStore((state) => state.resetPosition);
  const computeOptimalPosition = useHUDStore((state) => state.computeOptimalPosition);
  const keymapOverrides = useQuantumKeymapStore((state) => state.overrides);

  const dragOffset = useMemo(
    () => customOffset ?? { x: 0, y: 0 },
    [customOffset]
  );

  // Custom store actions
  const addCustomSymbol = useQuantumCustomStore((state) => state.addCustomSymbol);
  const removeCustomSymbol = useQuantumCustomStore((state) => state.removeCustomSymbol);
  const hideDefaultSymbol = useQuantumCustomStore((state) => state.hideDefaultSymbol);
  const getCustomSymbols = useQuantumCustomStore((state) => state.getCustomSymbols);
  const getHiddenSymbols = useQuantumCustomStore((state) => state.getHiddenSymbols);
  // Compute current position
  const { side: optimalPosition, topPx, leftPx, widthPx, heightPx, maxHeightPx } = computeOptimalPosition();
  const safePosition = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        topPx: topPx + dragOffset.y,
        leftPx: leftPx + dragOffset.x,
      };
    }

    const measuredHeight = Math.min(maxHeightPx, Math.max(40, containerRef.current?.offsetHeight ?? heightPx));
    const clampedTop = Math.max(8, Math.min(topPx + dragOffset.y, window.innerHeight - measuredHeight - 8));
    const clampedLeft = Math.max(8, Math.min(leftPx + dragOffset.x, window.innerWidth - widthPx - 8));
    return {
      topPx: clampedTop,
      leftPx: clampedLeft,
    };
  }, [dragOffset.x, dragOffset.y, heightPx, leftPx, maxHeightPx, topPx, widthPx]);

  // ============================================================================
  // MathLive Integration (moved before useEffects that depend on it)
  // ============================================================================

  const findCurrentMathField = useCallback((): HTMLElement | null => {
    // 使用全局的活动 math-field
    const activeMf = getActiveMathField();
    if (activeMf) {
      activeMathFieldRef.current = activeMf;
      return activeMf;
    }
    
    // 如果没有，检查当前聚焦的
    const focused = document.activeElement;
    if (focused?.tagName?.toLowerCase() === 'math-field') {
      activeMathFieldRef.current = focused as HTMLElement;
      return focused as HTMLElement;
    }
    
    // 不要自动选择最后一个 math-field！
    // 这会导致输入跳转到错误的位置
    
    if (activeMathFieldRef.current?.isConnected) {
      return activeMathFieldRef.current;
    }

    activeMathFieldRef.current = null;
    return null;
  }, []);

  // ============================================================================
  // Cursor Position Tracking
  // ============================================================================
  
  // Highlight active math-field when HUD is open (Bug 5 fix)
  useEffect(() => {
    if (!isOpen) {
      // Remove highlight from all math-fields when HUD closes
      document.querySelectorAll('math-field.quantum-keyboard-active').forEach(el => {
        el.classList.remove('quantum-keyboard-active');
      });
      return;
    }
    
    const updateHighlight = () => {
      // Remove existing highlights
      document.querySelectorAll('math-field.quantum-keyboard-active').forEach(el => {
        el.classList.remove('quantum-keyboard-active');
      });
      
      // Add highlight to active math-field
      const mathField = findCurrentMathField();
      if (mathField) {
        mathField.classList.add('quantum-keyboard-active');
      }
    };
    
    updateHighlight();
    
    // Update highlight when focus changes
    const handleFocusChange = () => setTimeout(updateHighlight, 50);
    document.addEventListener('focusin', handleFocusChange);
    
    return () => {
      document.removeEventListener('focusin', handleFocusChange);
      document.querySelectorAll('math-field.quantum-keyboard-active').forEach(el => {
        el.classList.remove('quantum-keyboard-active');
      });
    };
  }, [isOpen, findCurrentMathField]);

  useEffect(() => {
    if (!isOpen) return;

    const syncPreview = () => {
      const mathField = findCurrentMathField() as MathfieldWithCommands | null;
      const value = mathField?.getValue?.();
      if (value && value.trim()) {
        setLastActionLabel('editing');
      }
    };

    syncPreview();
    const interval = window.setInterval(syncPreview, 180);
    return () => window.clearInterval(interval);
  }, [isOpen, findCurrentMathField]);

  // Capture the opening anchor once. The keyboard stays stable until moved by the user.
  useEffect(() => {
    if (!isOpen) return;
    
    const doUpdate = () => {
      if (isDragging) return;
      
      const rect = findInputTargetRect();
      updateCursorPosition(rect);
    };
    
    const initialTimeout = setTimeout(doUpdate, 100);
    
    return () => {
      clearTimeout(initialTimeout);
    };
  }, [isOpen, isDragging, updateCursorPosition]);

  useEffect(() => {
    if (!isOpen || !containerRef.current || typeof ResizeObserver === 'undefined') return;

    const updateSize = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      updateHUDSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    window.addEventListener('resize', updateSize, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [isOpen, updateHUDSize]);

  // ============================================================================
  // Drag Handling
  // ============================================================================
  
  const handleDragEnd = useCallback((_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const rawOffset = {
      x: dragOffset.x + info.offset.x,
      // Y drag shifts the computed topPx — store it so the container inline style picks it up
      y: dragOffset.y + info.offset.y,
    };

    const bubbleRect = containerRef.current?.getBoundingClientRect();
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const bubbleWidth = bubbleRect?.width ?? widthPx;
    const bubbleHeight = Math.min(bubbleRect?.height ?? 320, maxHeightPx);
    const minX = 8 - leftPx;
    const maxX = viewportWidth - bubbleWidth - 8 - leftPx;
    const minY = 8 - topPx;
    const maxY = viewportHeight - bubbleHeight - 8 - topPx;
    const newOffset = {
      x: Math.max(minX, Math.min(rawOffset.x, maxX)),
      y: Math.max(minY, Math.min(rawOffset.y, maxY)),
    };

    setCustomOffset(newOffset);
    setTimeout(() => setIsDragging(false), 100);
  }, [dragOffset, leftPx, maxHeightPx, setCustomOffset, setIsDragging, topPx, widthPx]);

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, [setIsDragging]);

  const handleResetPosition = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resetPosition();
    // Trigger position recalculation after reset
    setTimeout(() => {
      const rect = findInputTargetRect();
      updateCursorPosition(rect);
    }, 50);
  }, [resetPosition, updateCursorPosition]);

  // ============================================================================
  // Symbol Handling
  // ============================================================================

  const getSymbolsForActiveKey = useCallback(() => {
    if (!activeSymbolKey) return [];
    const mapping = quantumKeymap[activeSymbolKey];
    if (!mapping) return [];
    
    const customSymbols = getCustomSymbols(activeSymbolKey);
    const hiddenSymbols = getHiddenSymbols(activeSymbolKey);
    const variants = getVariants(activeSymbolKey);
    
    return getAllSymbolsForKey(
      activeSymbolKey,
      mapping.default,
      mapping.shift,
      variants,
      customSymbols,
      hiddenSymbols
    );
  }, [activeSymbolKey, getCustomSymbols, getHiddenSymbols]);

  const updateSelectorAnchor = useCallback((_keyCode: string) => {
    if (!containerRef.current) {
      setSelectorAnchor({ x: 0, y: 0 });
      return;
    }
    const containerRect = containerRef.current.getBoundingClientRect();
    setSelectorAnchor({
      x: Math.min(containerRect.width - 16, Math.max(16, containerRect.width / 2)),
      y: -8,
    });
  }, []);

  const insertCandidateForKey = useCallback((keyCode: string, oneBasedIndex = 1, layer: QuantumLayerId = 'base') => {
    const mapping = quantumKeymap[keyCode];
    if (!mapping) return;

    const result = resolveQuantumKeyboardInput({
      keyCode,
      shiftKey: layer === 'base',
      ctrlKey: layer === 'ctrl',
      candidatePrefix: oneBasedIndex,
    }, keymapOverrides);
    if (result.action !== 'insert' || !result.latex) return;

    flashKey(keyCode);
    setLastActionLabel(`${KEY_LABELS[keyCode] ?? keyCode} ${result.meaning?.label ?? result.latex}`);
    setCandidatePrefix(null);
    setActiveLayer('base');
    onInsertSymbol({
      latex: result.latex,
      mathLiveLatex: result.meaning?.mathlive,
      displayMode: Boolean(result.meaning?.displayMode ?? mapping.displayMode),
    });
  }, [flashKey, keymapOverrides, onInsertSymbol]);

  const handleKeySelect = useCallback((keyCode: string) => {
    insertCandidateForKey(keyCode, candidatePrefix ?? 1, activeLayer);
  }, [activeLayer, candidatePrefix, insertCandidateForKey]);

  const handleShiftKeySelect = useCallback((keyCode: string) => {
    const mapping = quantumKeymap[keyCode];
    if (!mapping) return;
    updateSelectorAnchor(keyCode);
    openSymbolSelector(keyCode);
  }, [openSymbolSelector, updateSelectorAnchor]);

  const handleSymbolSelect = useCallback((symbol: string) => {
    if (activeSymbolKey) {
      flashKey(activeSymbolKey);
      setLastActionLabel(`${KEY_LABELS[activeSymbolKey] ?? activeSymbolKey} ${symbol}`);
    }
    onInsertSymbol(symbol);
    closeSymbolSelector();
  }, [activeSymbolKey, flashKey, onInsertSymbol, closeSymbolSelector]);

  const handleVisualKeyClick = useCallback((event: React.MouseEvent, keyCode: string) => {
    event.preventDefault();
    event.stopPropagation();
    inputRef.current?.focus();
    handleKeySelect(keyCode);
  }, [handleKeySelect]);

  const handleVisualVariantClick = useCallback((event: React.MouseEvent, keyCode: string) => {
    event.preventDefault();
    event.stopPropagation();
    inputRef.current?.focus();
    handleShiftKeySelect(keyCode);
  }, [handleShiftKeySelect]);

  const handleAddSymbol = useCallback((symbol: string) => {
    if (activeSymbolKey) {
      addCustomSymbol(activeSymbolKey, symbol);
    }
  }, [activeSymbolKey, addCustomSymbol]);

  const handleRemoveSymbol = useCallback((symbol: string) => {
    if (!activeSymbolKey) return;
    
    const mapping = quantumKeymap[activeSymbolKey];
    if (!mapping) return;
    
    const customSymbols = getCustomSymbols(activeSymbolKey);
    if (customSymbols.includes(symbol)) {
      removeCustomSymbol(activeSymbolKey, symbol);
    } else {
      hideDefaultSymbol(activeSymbolKey, symbol);
    }
  }, [activeSymbolKey, getCustomSymbols, removeCustomSymbol, hideDefaultSymbol]);


  // ============================================================================
  // MathLive Key Forwarding
  // ============================================================================

  const forwardKeyToMathField = useCallback((event: React.KeyboardEvent) => {
    const mathField = findCurrentMathField();
    if (!mathField || !('executeCommand' in mathField)) return false;
    
    const mf = mathField as MathfieldWithCommands;
    
    switch (event.code) {
      case 'Backspace':
        event.preventDefault();
        mf.executeCommand('deleteBackward');
        return true;
      case 'Delete':
        event.preventDefault();
        mf.executeCommand('deleteForward');
        return true;
      case 'ArrowLeft':
        event.preventDefault();
        mf.executeCommand(event.shiftKey ? 'extendToPreviousChar' : 'moveToPreviousChar');
        return true;
      case 'ArrowRight':
        event.preventDefault();
        mf.executeCommand(event.shiftKey ? 'extendToNextChar' : 'moveToNextChar');
        return true;
      case 'ArrowUp':
        event.preventDefault();
        mf.executeCommand('moveUp');
        return true;
      case 'ArrowDown':
        event.preventDefault();
        mf.executeCommand('moveDown');
        return true;
      case 'Home':
        event.preventDefault();
        mf.executeCommand('moveToMathfieldStart');
        return true;
      case 'End':
        event.preventDefault();
        mf.executeCommand('moveToMathfieldEnd');
        return true;
      case 'Tab':
        event.preventDefault();
        mf.executeCommand(event.shiftKey ? 'moveToPreviousPlaceholder' : 'moveToNextPlaceholder');
        return true;
      case 'Enter':
      case 'NumpadEnter':
        event.preventDefault();
        isProcessingEnterRef.current = true;
        
        const editor = getGlobalTiptapEditor();
        if (!editor || editor.isDestroyed) {
          isProcessingEnterRef.current = false;
          return true;
        }
        
        const hasInlineMathLive = editor.schema.nodes.inlineMathLive !== undefined;
        if (!hasInlineMathLive) {
          isProcessingEnterRef.current = false;
          return true;
        }
        
        setTimeout(() => {
          try {
            editor.chain().focus()
              .insertContent([
                { type: 'hardBreak' },
                { type: 'inlineMathLive', attrs: { latex: '' } }
              ])
              .run();
            
            setTimeout(() => {
              const mathFields = document.querySelectorAll('math-field') as NodeListOf<MathfieldWithCommands>;
              let newMathField: MathfieldWithCommands | null = null;
              for (let i = mathFields.length - 1; i >= 0; i--) {
                const field = mathFields[i];
                if (field.getValue?.() === '') {
                  newMathField = field;
                  break;
                }
              }
              if (newMathField) {
                // 更新全局活动 math-field
                setActiveMathField(newMathField);
                activeMathFieldRef.current = newMathField;
                // 重新聚焦 HUD 输入框，而不是 math-field
                // 这样量子键盘继续工作
                if (inputRef.current) {
                  inputRef.current.focus();
                }
              }
              isProcessingEnterRef.current = false;
            }, 150);
          } catch (e) {
            logger.error('[HUD] Failed to create new line:', e);
            isProcessingEnterRef.current = false;
          }
        }, 80);
        return true;
      default:
        if (event.key && event.key.length === 1) {
          event.preventDefault();
          mf.insert(event.key, { insertionMode: 'insertAfter', selectionMode: 'after' });
          return true;
        }
        break;
    }
    return false;
  }, [findCurrentMathField]);


  // ============================================================================
  // Keyboard Event Handler
  // ============================================================================

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    const keyCode = event.code;
    
    if (keyCode === 'ControlLeft' || keyCode === 'ControlRight') {
      event.preventDefault();
      setActiveLayer('ctrl');
      return;
    }

    if (keyCode === 'ShiftLeft' || keyCode === 'ShiftRight') {
      event.preventDefault();
      setActiveLayer('base');
      return;
    }

    // Let non-quantum modifier-only keys pass through
    if (['AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(keyCode)) {
      return;
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey) {
      setActiveLayer('ctrl');
    }

    if (event.metaKey || event.altKey) return;

    // Escape handling
    if (keyCode === 'Escape') {
      event.preventDefault();
      setCandidatePrefix(null);
      if (activeSymbolKey) {
        closeSymbolSelector();
      } else {
        closeHUD();
      }
      return;
    }

    // Symbol selector mode
    if (activeSymbolKey) {
      if (keyCode === 'Tab') {
        event.preventDefault();
        navigateSymbol(event.shiftKey ? 'up' : 'down');
        return;
      }
      if (keyCode === 'ArrowDown' || keyCode === 'Space') {
        event.preventDefault();
        navigateSymbol('down');
        return;
      }
      if (keyCode === 'ArrowUp') {
        event.preventDefault();
        navigateSymbol('up');
        return;
      }
      if (keyCode === 'Enter' || keyCode === 'NumpadEnter') {
        event.preventDefault();
        const symbols = getSymbolsForActiveKey();
        if (highlightedIndex === symbols.length) return; // Add button
        if (highlightedIndex === symbols.length + 1) {
          toggleEditMode();
          return;
        }
        const symbol = selectSymbol();
        if (symbol) handleSymbolSelect(symbol);
        return;
      }
      
      if (quantumKeymap[keyCode]) {
        closeSymbolSelector();
      } else {
        closeSymbolSelector();
        return;
      }
    }

    const digitMatch = /^Digit([1-9])$/.exec(keyCode);
    if (digitMatch && (event.shiftKey || event.ctrlKey)) {
      event.preventDefault();
      const nextPrefix = Number(digitMatch[1]);
      setCandidatePrefix(nextPrefix);
      setActiveLayer(event.ctrlKey ? 'ctrl' : 'base');
      setLastActionLabel(`${event.ctrlKey ? 'Ctrl' : 'Shift'} choice ${nextPrefix}`);
      return;
    }

    // Tab moves through MathLive placeholders. It never switches output format.
    if (keyCode === 'Tab') {
      event.preventDefault();
      forwardKeyToMathField(event);
      return;
    }

    // Enter key - create new line
    if (keyCode === 'Enter' || keyCode === 'NumpadEnter') {
      forwardKeyToMathField(event);
      return;
    }

    // Quantum keymap keys
    if (keyCode && quantumKeymap[keyCode]) {
      event.preventDefault();
      handleKeySelect(keyCode);
      return;
    }

    // Forward other keys to MathLive
    setCandidatePrefix(null);
    if (!event.ctrlKey) {
      setActiveLayer('base');
    }
    forwardKeyToMathField(event);
  }, [
    activeSymbolKey, highlightedIndex, closeSymbolSelector, closeHUD,
    navigateSymbol, selectSymbol, handleSymbolSelect, handleKeySelect,
    getSymbolsForActiveKey, toggleEditMode, forwardKeyToMathField,
    activeLayer, candidatePrefix,
  ]);

  const handleKeyUp = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Control' || !event.ctrlKey) {
      if (!candidatePrefix) {
        setActiveLayer('base');
      }
    }
  }, [candidatePrefix]);

  // ============================================================================
  // Focus Management
  // ============================================================================

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        if (!isQuantumMathEditorFocused()) inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Monitor for MathLive virtual keyboard
  useEffect(() => {
    if (!isOpen) return;

    const checkVirtualKeyboard = () => {
      const mlKeyboard = document.querySelector('.ML__keyboard');
      if (mlKeyboard) {
        const style = window.getComputedStyle(mlKeyboard);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          closeHUD();
        }
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              if (node.classList?.contains('ML__keyboard') || node.querySelector?.('.ML__keyboard')) {
                closeHUD();
                return;
              }
            }
          }
        }
        if (mutation.type === 'attributes' && 
            mutation.target instanceof HTMLElement &&
            mutation.target.classList?.contains('ML__keyboard')) {
          checkVirtualKeyboard();
        }
      }
    });

    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'],
    });
    checkVirtualKeyboard();

    return () => observer.disconnect();
  }, [isOpen, closeHUD]);

  const handleBlur = useCallback(() => {
    if (isProcessingEnterRef.current) return;
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        if (isProcessingEnterRef.current) return;
        if (isOpen && inputRef.current && !isQuantumMathEditorFocused()) {
          inputRef.current.focus();
        }
      }, 10);
    }
  }, [isOpen]);

  const handleInput = useCallback(() => {
    if (inputRef.current) inputRef.current.value = '';
  }, []);


  // ============================================================================
  // Render
  // ============================================================================

  const currentSymbols = getSymbolsForActiveKey();
  const activeKeyLabel = activeSymbolKey ? KEY_LABELS[activeSymbolKey] || activeSymbolKey : '';

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="quantum-hud-container"
          data-position={optimalPosition}
          style={{
            top: `${safePosition.topPx}px`,
            left: `${safePosition.leftPx}px`,
            width: `${widthPx}px`,
            maxHeight: `${maxHeightPx}px`,
          }}
        >
          <input
            ref={inputRef}
            type="password"
            className="quantum-ime-blocker"
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onBlur={handleBlur}
            onInput={handleInput}
            onChange={handleInput}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            tabIndex={0}
            aria-label={t("quantum.inputAria")}
          />

          <motion.div
            ref={containerRef}
            className={`quantum-bubble quantum-bubble-${optimalPosition}`}
            drag
            dragControls={dragControls}
            dragMomentum={false}
            dragElastic={0.1}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            initial={{
              x: 0,
              y: optimalPosition === 'top' ? -24 : 24,
              opacity: 0,
              scale: 0.96,
              borderRadius: '18px',
            }}
            animate={{
              x: 0,
              y: 0,
              opacity: 1,
              scale: 1,
              borderRadius: '18px',
            }}
            exit={{
              x: 0,
              y: optimalPosition === 'top' ? -18 : 18,
              opacity: 0,
              scale: 0.98,
              borderRadius: '20px',
              transition: { type: "spring", stiffness: 400, damping: 30, mass: 0.8 }
            }}
            transition={{ 
              type: "spring", stiffness: 260, damping: 20, mass: 1,
              opacity: { duration: 0.2 },
              scale: { type: "spring", stiffness: 300, damping: 15 },
              borderRadius: { duration: 0.4, ease: "easeOut" },
            }}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            role="dialog"
            aria-modal="true"
            aria-label={t("quantum.dialogAria")}
          >
            {/* Drag Handle */}
            <div className="quantum-drag-handle" onPointerDown={(e) => dragControls.start(e)}>
              <GripHorizontal className="w-4 h-4 opacity-50" />
              <span className="quantum-position-label">
                {optimalPosition === 'top'
                  ? t("quantum.position.top")
                  : t("quantum.position.bottom")}
              </span>
              {customOffset && (customOffset.x !== 0 || customOffset.y !== 0) && (
                <button className="quantum-reset-btn" onClick={handleResetPosition} title={t("quantum.resetPosition")}>
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Content */}
            <div className="quantum-content">
              <div className="quantum-ime-bar" aria-label="Formula keyboard status" data-layer={activeLayer}>
                <span className="quantum-structure" title={lastActionLabel}>
                  Shift/Ctrl + number + letter
                </span>
                <span className={candidatePrefix ? "quantum-prefix is-active" : "quantum-prefix"}>
                  {candidatePrefix ? `${activeLayer === 'ctrl' ? 'Ctrl' : 'Shift'}+${candidatePrefix}` : activeLayer === 'ctrl' ? "Ctrl" : "A-Z"}
                </span>
              </div>

              <div className="quantum-letter-board" aria-label="Quantum letter keyboard">
                {QWERTY_LAYOUT.map((row) => (
                  <div
                    key={row.keys.join("-")}
                    className="quantum-letter-row"
                    style={{ paddingLeft: `${row.offset * 2.25}rem` }}
                  >
                    {row.keys.map((keyCode) => {
                      const mapping = quantumKeymap[keyCode];
                      const keyLabel = KEY_LABELS[keyCode] ?? keyCode.replace(/^Key/, "");
                      const candidates = getEffectiveQuantumLayerMeanings(
                        keyCode,
                        activeLayer,
                        keymapOverrides,
                      ).slice(0, 5);
                      const activeChoice = candidatePrefix
                        ? candidates[Math.max(0, Math.min(candidatePrefix - 1, candidates.length - 1))]?.label
                        : candidates[0]?.label ?? mapping.label ?? getCandidateLabel(keyCode, 1);

                      return (
                        <button
                          key={keyCode}
                          type="button"
                          data-testid="quantum-letter-key"
                          data-keycode={keyCode}
                          data-layer={activeLayer}
                          className={candidatePrefix ? "quantum-letter-key is-prefixed" : "quantum-letter-key"}
                          onClick={(event) => handleVisualKeyClick(event, keyCode)}
                          onContextMenu={(event) => handleVisualVariantClick(event, keyCode)}
                          onPointerDown={(event) => event.stopPropagation()}
                          title={`${keyLabel}: ${mapping.title ?? mapping.label ?? mapping.default}`}
                          aria-label={`${keyLabel}: ${mapping.title ?? mapping.label ?? mapping.default}`}
                        >
                          <span className="quantum-letter-physical">{keyLabel}</span>
                          <span className="quantum-letter-action">{activeChoice}</span>
                          <span className="quantum-letter-candidates" aria-hidden="true">
                            {candidates.map((meaning, index) => (
                              <span key={`${keyCode}-${meaning.id}-${index}`}>{meaning.label}</span>
                            ))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Symbol Selector */}
            <SymbolSelector
              keyCode={activeSymbolKey || ''}
              keyLabel={activeKeyLabel}
              symbols={currentSymbols}
              highlightedIndex={highlightedIndex}
              anchorPosition={selectorAnchor}
              isEditMode={isEditMode}
              onSelect={handleSymbolSelect}
              onAddSymbol={handleAddSymbol}
              onRemoveSymbol={handleRemoveSymbol}
              onToggleEditMode={toggleEditMode}
              onClose={closeSymbolSelector}
              onNavigate={navigateSymbol}
              isVisible={activeSymbolKey !== null}
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default KeyboardHUD;
