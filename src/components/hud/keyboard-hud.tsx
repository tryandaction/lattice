'use client';

/**
 * Keyboard HUD Component
 * Quantum Keyboard - A floating bubble with smart positioning
 * 
 * Smart Positioning:
 * - Auto-detects cursor/math field position
 * - Positions keyboard to avoid blocking the input area
 * - Supports user drag to customize position
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useDragControls, PanInfo } from 'framer-motion';
import { ShadowKeyboard } from './shadow-keyboard';
import { SymbolSelector } from './symbol-selector';
import { useHUDStore, computeMode } from '../../stores/hud-store';
import { useQuantumCustomStore, getAllSymbolsForKey } from '../../stores/quantum-custom-store';
import { getGlobalTiptapEditor } from './hud-provider';
import {
  quantumKeymap,
  getDisplaySymbol,
  getVariants,
  KEY_LABELS,
} from '../../config/quantum-keymap';
import { GripHorizontal, RotateCcw } from 'lucide-react';

export interface KeyboardHUDProps {
  onInsertSymbol: (latex: string) => void;
}

/**
 * Find and return the bounding rect of the current input target
 */
function findInputTargetRect(): DOMRect | null {
  // Priority 1: Focused math field
  const focusedMathField = document.querySelector('math-field:focus') as HTMLElement;
  if (focusedMathField) {
    return focusedMathField.getBoundingClientRect();
  }
  
  // Priority 2: Any math field (most recent)
  const mathFields = document.querySelectorAll('math-field');
  if (mathFields.length > 0) {
    const lastMathField = mathFields[mathFields.length - 1] as HTMLElement;
    return lastMathField.getBoundingClientRect();
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

export function KeyboardHUD({ onInsertSymbol }: KeyboardHUDProps) {
  const keycapRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragControls = useDragControls();
  const activeMathFieldRef = useRef<HTMLElement | null>(null);
  const isProcessingEnterRef = useRef(false);

  // Store state
  const isOpen = useHUDStore((state) => state.isOpen);
  const activeSymbolKey = useHUDStore((state) => state.activeSymbolKey);
  const highlightedIndex = useHUDStore((state) => state.highlightedIndex);
  const flashingKey = useHUDStore((state) => state.flashingKey);
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
  const resetPosition = useHUDStore((state) => state.resetPosition);
  const computeOptimalPosition = useHUDStore((state) => state.computeOptimalPosition);

  // Local state for drag
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Custom store actions
  const addCustomSymbol = useQuantumCustomStore((state) => state.addCustomSymbol);
  const removeCustomSymbol = useQuantumCustomStore((state) => state.removeCustomSymbol);
  const hideDefaultSymbol = useQuantumCustomStore((state) => state.hideDefaultSymbol);
  const getCustomSymbols = useQuantumCustomStore((state) => state.getCustomSymbols);
  const getHiddenSymbols = useQuantumCustomStore((state) => state.getHiddenSymbols);

  // Compute current mode and position
  const mode = computeMode({ isOpen, activeSymbolKey });
  const optimalPosition = computeOptimalPosition();


  // ============================================================================
  // Cursor Position Tracking
  // ============================================================================
  
  // Update cursor position when HUD opens and periodically while open
  useEffect(() => {
    if (!isOpen) return;
    
    const doUpdate = () => {
      // Don't update position while dragging to prevent jarring changes
      if (isDragging) return;
      
      const rect = findInputTargetRect();
      updateCursorPosition(rect);
    };
    
    // Initial update with slight delay to ensure DOM is ready
    const initialTimeout = setTimeout(doUpdate, 100);
    
    // Update on focus changes
    const handleFocusIn = () => {
      if (!isDragging) setTimeout(doUpdate, 50);
    };
    document.addEventListener('focusin', handleFocusIn);
    
    // Update on scroll/resize
    const handleScrollResize = () => {
      if (!isDragging) doUpdate();
    };
    window.addEventListener('scroll', handleScrollResize, { passive: true });
    window.addEventListener('resize', handleScrollResize, { passive: true });
    
    // Update on DOM changes (new math fields)
    const observer = new MutationObserver(() => {
      if (!isDragging) setTimeout(doUpdate, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Periodic update while open (fallback for edge cases)
    const interval = setInterval(() => {
      if (!isDragging) doUpdate();
    }, 800);
    
    return () => {
      clearTimeout(initialTimeout);
      document.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('scroll', handleScrollResize);
      window.removeEventListener('resize', handleScrollResize);
      observer.disconnect();
      clearInterval(interval);
    };
  }, [isOpen, isDragging, updateCursorPosition]);

  // ============================================================================
  // Drag Handling
  // ============================================================================
  
  // Sync drag offset with store's custom offset
  useEffect(() => {
    if (isOpen) {
      if (customOffset) {
        setDragOffset({ x: customOffset.x, y: customOffset.y });
      } else {
        setDragOffset({ x: 0, y: 0 });
      }
    }
  }, [isOpen, customOffset]);

  // Reset drag offset when HUD closes
  useEffect(() => {
    if (!isOpen) {
      setDragOffset({ x: 0, y: 0 });
    }
  }, [isOpen]);

  const handleDragEnd = useCallback((_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const newOffset = {
      x: dragOffset.x + info.offset.x,
      y: dragOffset.y + info.offset.y,
    };
    setDragOffset(newOffset);
    setCustomOffset(newOffset);
    // Delay setting isDragging to false to prevent immediate position recalculation
    setTimeout(() => setIsDragging(false), 100);
  }, [dragOffset, setCustomOffset, setIsDragging]);

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, [setIsDragging]);

  const handleResetPosition = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resetPosition();
    setDragOffset({ x: 0, y: 0 });
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

  const selectorPosition = useCallback(() => {
    if (!activeSymbolKey || !containerRef.current) return { x: 0, y: 0 };
    
    const keycapElement = keycapRefs.current.get(activeSymbolKey);
    if (!keycapElement) return { x: 200, y: -100 };
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const keycapRect = keycapElement.getBoundingClientRect();
    
    return {
      x: keycapRect.left + keycapRect.width / 2 - containerRect.left,
      y: keycapRect.top - containerRect.top - 10,
    };
  }, [activeSymbolKey]);

  const handleKeySelect = useCallback((keyCode: string) => {
    const mapping = quantumKeymap[keyCode];
    if (!mapping) return;

    const symbol = getDisplaySymbol(keyCode, false);
    if (!symbol) return;

    flashKey(keyCode);
    onInsertSymbol(symbol);
  }, [flashKey, onInsertSymbol]);

  const handleShiftKeySelect = useCallback((keyCode: string) => {
    const mapping = quantumKeymap[keyCode];
    if (!mapping) return;
    openSymbolSelector(keyCode);
  }, [openSymbolSelector]);

  const handleSymbolSelect = useCallback((symbol: string) => {
    if (activeSymbolKey) {
      flashKey(activeSymbolKey);
    }
    onInsertSymbol(symbol);
    closeSymbolSelector();
  }, [activeSymbolKey, flashKey, onInsertSymbol, closeSymbolSelector]);

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
  // MathLive Integration
  // ============================================================================

  const findCurrentMathField = useCallback((): HTMLElement | null => {
    // 使用全局的活动 math-field
    const { getActiveMathField } = require('./hud-provider');
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
    
    return activeMathFieldRef.current;
  }, []);

  useEffect(() => {
    if (isOpen) {
      // 不要自动查找 math-field，使用 provider 设置的
    }
  }, [isOpen]);

  const forwardKeyToMathField = useCallback((event: React.KeyboardEvent) => {
    const mathField = findCurrentMathField();
    if (!mathField || !('executeCommand' in mathField)) return false;
    
    const mf = mathField as any;
    
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
        
        // 导入 setActiveMathField
        const { setActiveMathField } = require('./hud-provider');
        
        setTimeout(() => {
          try {
            editor.chain().focus()
              .insertContent([
                { type: 'hardBreak' },
                { type: 'inlineMathLive', attrs: { latex: '' } }
              ])
              .run();
            
            setTimeout(() => {
              const mathFields = document.querySelectorAll('math-field');
              let newMathField: HTMLElement | null = null;
              for (let i = mathFields.length - 1; i >= 0; i--) {
                const field = mathFields[i] as any;
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
            console.error('[HUD] Failed to create new line:', e);
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
    
    // Let modifier-only keys pass through
    if (['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 
         'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight'].includes(keyCode)) {
      return;
    }

    // Let Ctrl/Cmd/Alt shortcuts pass through
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // Escape handling
    if (keyCode === 'Escape') {
      event.preventDefault();
      if (activeSymbolKey) {
        closeSymbolSelector();
      } else {
        closeHUD();
      }
      return;
    }

    // Symbol selector mode
    if (activeSymbolKey) {
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

    // Enter key - create new line
    if (keyCode === 'Enter' || keyCode === 'NumpadEnter') {
      forwardKeyToMathField(event);
      return;
    }

    // Quantum keymap keys
    if (keyCode && quantumKeymap[keyCode]) {
      event.preventDefault();
      if (event.shiftKey) {
        handleShiftKeySelect(keyCode);
      } else {
        handleKeySelect(keyCode);
      }
      return;
    }

    // Forward other keys to MathLive
    forwardKeyToMathField(event);
  }, [
    activeSymbolKey, highlightedIndex, closeSymbolSelector, closeHUD,
    navigateSymbol, selectSymbol, handleSymbolSelect, handleKeySelect,
    handleShiftKeySelect, getSymbolsForActiveKey, toggleEditMode, forwardKeyToMathField,
  ]);

  // ============================================================================
  // Focus Management
  // ============================================================================

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
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
        if (isOpen && inputRef.current) inputRef.current.focus();
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
        <div className="quantum-hud-container" data-position={optimalPosition}>
          <input
            ref={inputRef}
            type="password"
            className="quantum-ime-blocker"
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onInput={handleInput}
            onChange={handleInput}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            tabIndex={0}
            aria-label="量子键盘输入"
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
              y: optimalPosition === 'top' ? -150 : 150, 
              x: dragOffset.x,
              opacity: 0, 
              scale: 0.3,
              borderRadius: '50%',
            }}
            animate={{ 
              y: dragOffset.y, 
              x: dragOffset.x,
              opacity: 1, 
              scale: 1,
              borderRadius: '20px',
            }}
            exit={{ 
              y: optimalPosition === 'top' ? -120 : 120, 
              opacity: 0, 
              scale: 0.5,
              borderRadius: '40px',
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
            aria-label="Quantum Keyboard"
          >
            {/* Drag Handle */}
            <div className="quantum-drag-handle" onPointerDown={(e) => dragControls.start(e)}>
              <GripHorizontal className="w-4 h-4 opacity-50" />
              <span className="quantum-position-label">
                {optimalPosition === 'top' ? '↑ 上方' : '↓ 下方'}
              </span>
              {customOffset && (customOffset.x !== 0 || customOffset.y !== 0) && (
                <button className="quantum-reset-btn" onClick={handleResetPosition} title="重置位置">
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Ripple Background */}
            <div className="quantum-ripple-bg">
              <div className="quantum-ripple quantum-ripple-1" />
              <div className="quantum-ripple quantum-ripple-2" />
              <div className="quantum-ripple quantum-ripple-3" />
            </div>

            {/* Content */}
            <div className="quantum-content">
              <div className="quantum-mode-indicator">
                {mode === 'symbol-selector' ? `◆ ${activeKeyLabel} 符号` : '∑ 量子键盘'}
              </div>

              <ShadowKeyboard
                isShiftHeld={false}
                flashingKey={flashingKey}
                onKeySelect={handleKeySelect}
                onShiftKeySelect={handleShiftKeySelect}
                keycapRefs={keycapRefs}
                activeKey={activeSymbolKey}
              />

              <div className="quantum-hint">
                {mode === 'symbol-selector' 
                  ? '↑↓/空格 选择 • Enter 确认 • Esc 返回'
                  : '拖动移动 • 按键输入 • Shift 变体 • Esc 关闭'}
              </div>
            </div>

            {/* Symbol Selector */}
            <SymbolSelector
              keyCode={activeSymbolKey || ''}
              keyLabel={activeKeyLabel}
              symbols={currentSymbols}
              highlightedIndex={highlightedIndex}
              anchorPosition={selectorPosition()}
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
