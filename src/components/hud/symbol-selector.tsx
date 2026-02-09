'use client';

/**
 * Symbol Selector Component
 * Shows all available symbols for a key with add/edit functionality
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import katex from 'katex';
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react';

export interface SymbolSelectorProps {
  /** Key code this selector is for */
  keyCode: string;
  /** Physical key label (e.g., 'I') */
  keyLabel: string;
  /** All available symbols for this key */
  symbols: string[];
  /** Currently highlighted index */
  highlightedIndex: number;
  /** Position to anchor the selector */
  anchorPosition: { x: number; y: number };
  /** Whether in edit mode */
  isEditMode: boolean;
  /** Callback when a symbol is selected */
  onSelect: (symbol: string) => void;
  /** Callback when adding a new symbol */
  onAddSymbol: (symbol: string) => void;
  /** Callback when removing a symbol */
  onRemoveSymbol: (symbol: string) => void;
  /** Callback to toggle edit mode */
  onToggleEditMode: () => void;
  /** Callback when selector should close */
  onClose: () => void;
  /** Callback to navigate */
  onNavigate: (direction: 'up' | 'down') => void;
  /** Whether the selector is visible */
  isVisible: boolean;
}

/**
 * Render LaTeX to HTML using KaTeX
 */
function renderLatex(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,
      output: 'html',
    });
  } catch {
    return `<span class="text-xs text-gray-400">${latex}</span>`;
  }
}

export function SymbolSelector({
  keyCode: _keyCode,
  keyLabel,
  symbols,
  highlightedIndex,
  anchorPosition,
  isEditMode,
  onSelect,
  onAddSymbol,
  onRemoveSymbol,
  onToggleEditMode,
  onClose: _onClose,
  onNavigate: _onNavigate,
  isVisible,
}: SymbolSelectorProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newSymbolPreview, setNewSymbolPreview] = useState('');

  // Total items: symbols + add button + edit button
  const addButtonIndex = symbols.length;
  const editButtonIndex = symbols.length + 1;

  // Scroll highlighted item into view
  useEffect(() => {
    if (!menuRef.current) return;
    const highlightedItem = menuRef.current.querySelector('.highlighted');
    if (highlightedItem) {
      highlightedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [highlightedIndex]);

  // Focus input when adding new
  useEffect(() => {
    if (isAddingNew && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAddingNew]);

  // Update preview when typing
  useEffect(() => {
    if (newSymbol) {
      setNewSymbolPreview(renderLatex(newSymbol));
    } else {
      setNewSymbolPreview('');
    }
  }, [newSymbol]);

  // Render symbols with KaTeX
  const renderedSymbols = useMemo(() => {
    return symbols.map((symbol) => ({
      latex: symbol,
      html: renderLatex(symbol),
    }));
  }, [symbols]);

  // Handle adding new symbol
  const handleAddNew = useCallback(() => {
    if (newSymbol.trim()) {
      onAddSymbol(newSymbol.trim());
      setNewSymbol('');
      setIsAddingNew(false);
    }
  }, [newSymbol, onAddSymbol]);

  // Handle key press in input
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      handleAddNew();
    } else if (e.key === 'Escape') {
      setIsAddingNew(false);
      setNewSymbol('');
    }
  }, [handleAddNew]);

  // Calculate menu position
  const menuStyle = useMemo(() => {
    return {
      left: anchorPosition.x,
      top: anchorPosition.y,
      transform: 'translate(-50%, -100%)',
    };
  }, [anchorPosition]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          ref={menuRef}
          className="symbol-selector"
          style={menuStyle}
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          role="listbox"
          aria-label={`符号选择 - ${keyLabel}`}
        >
          {/* Header */}
          <div className="symbol-selector-header">
            <span className="symbol-selector-key">{keyLabel}</span>
            <span className="symbol-selector-title">
              {isEditMode ? '编辑模式' : '选择符号'}
            </span>
            {isEditMode && (
              <button
                className="symbol-selector-close"
                onClick={onToggleEditMode}
                aria-label="退出编辑"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Symbol list */}
          <div className="symbol-selector-list">
            {renderedSymbols.map((symbol, index) => (
              <div
                key={symbol.latex}
                className={`symbol-selector-item ${index === highlightedIndex ? 'highlighted' : ''}`}
                onClick={() => isEditMode ? null : onSelect(symbol.latex)}
                role="option"
                aria-selected={index === highlightedIndex}
              >
                <span
                  className="symbol-selector-symbol"
                  dangerouslySetInnerHTML={{ __html: symbol.html }}
                />
                {isEditMode && index > 0 && (
                  <button
                    className="symbol-selector-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveSymbol(symbol.latex);
                    }}
                    aria-label={`删除 ${symbol.latex}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                {index === 0 && (
                  <span className="symbol-selector-default-badge">默认</span>
                )}
              </div>
            ))}

            {/* Add new symbol section */}
            {isAddingNew ? (
              <div className="symbol-selector-add-form">
                <input
                  ref={inputRef}
                  type="text"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="输入 LaTeX，如 \alpha"
                  className="symbol-selector-input"
                />
                {newSymbolPreview && (
                  <div 
                    className="symbol-selector-preview"
                    dangerouslySetInnerHTML={{ __html: newSymbolPreview }}
                  />
                )}
                <div className="symbol-selector-add-actions">
                  <button
                    className="symbol-selector-confirm"
                    onClick={handleAddNew}
                    disabled={!newSymbol.trim()}
                  >
                    <Check size={14} />
                    <span>添加</span>
                  </button>
                  <button
                    className="symbol-selector-cancel"
                    onClick={() => {
                      setIsAddingNew(false);
                      setNewSymbol('');
                    }}
                  >
                    <X size={14} />
                    <span>取消</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`symbol-selector-item symbol-selector-action ${highlightedIndex === addButtonIndex ? 'highlighted' : ''}`}
                onClick={() => setIsAddingNew(true)}
                role="option"
                aria-selected={highlightedIndex === addButtonIndex}
              >
                <Plus size={16} />
                <span>添加符号</span>
              </div>
            )}

            {/* Edit mode toggle */}
            <div
              className={`symbol-selector-item symbol-selector-action ${highlightedIndex === editButtonIndex ? 'highlighted' : ''}`}
              onClick={onToggleEditMode}
              role="option"
              aria-selected={highlightedIndex === editButtonIndex}
            >
              <Pencil size={16} />
              <span>{isEditMode ? '完成编辑' : '编辑符号'}</span>
            </div>
          </div>

          {/* Footer hint */}
          <div className="symbol-selector-footer">
            <span>↑↓/空格 选择</span>
            <span>Enter 确认</span>
            <span>Esc 关闭</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default SymbolSelector;
