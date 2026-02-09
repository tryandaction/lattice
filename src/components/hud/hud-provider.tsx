'use client';

/**
 * HUD Provider Component
 * 
 * 核心功能：
 * 1. 双击 Tab 在光标位置创建公式
 * 2. 管理当前活动的 math-field
 * 3. 处理符号插入
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { KeyboardHUD } from './keyboard-hud';
import { useDoubleTap } from '../../hooks/use-double-tap';
import { useHUDStore } from '../../stores/hud-store';
import type { MathfieldElement } from 'mathlive';
import type { Editor } from '@tiptap/react';
import { insertLatexAtCursor, setActiveInputTargetFromElement } from '@/lib/unified-input-handler';
import { wrapLatexForMarkdown, normalizeFormulaInput } from '@/lib/formula-utils';

export interface HUDProviderProps {
  children: React.ReactNode;
  enabled?: boolean;
}

type CodeMirrorContentElement = HTMLElement & {
  cmView?: {
    view?: {
      state: { selection: { main: { from: number; to: number } } };
      dispatch: (spec: {
        changes: { from: number; to: number; insert: string };
        selection: { anchor: number };
      }) => void;
    };
  };
};

// ============================================================================
// 全局状态
// ============================================================================

let globalTiptapEditor: Editor | null = null;
let currentInsertPosition: number = 1;
let positionSavedOnFirstTab: number | null = null;

// 当前活动的 math-field（全局，供 keyboard-hud 使用）
let globalActiveMathField: MathfieldElement | null = null;

export function getActiveMathField(): MathfieldElement | null {
  // 验证 math-field 仍然存在于 DOM 中
  if (globalActiveMathField && document.body.contains(globalActiveMathField)) {
    return globalActiveMathField;
  }
  globalActiveMathField = null;
  return null;
}

export function setActiveMathField(mf: MathfieldElement | null): void {
  globalActiveMathField = mf;
  if (mf) {
    setActiveInputTargetFromElement(mf as unknown as HTMLElement);
  }
  console.log('[HUD] 设置活动 math-field:', mf ? 'yes' : 'null');
}

// ============================================================================
// 编辑器注册
// ============================================================================

export function registerTiptapEditor(editor: Editor | null) {
  if (globalTiptapEditor && globalTiptapEditor !== editor) {
    try {
      globalTiptapEditor.off('selectionUpdate', handleSelectionUpdate);
      globalTiptapEditor.view.dom.removeEventListener('mouseup', handleEditorMouseUp);
    } catch {}
  }
  
  globalTiptapEditor = editor;
  
  if (editor) {
    editor.on('selectionUpdate', handleSelectionUpdate);
    // 监听 mouseup 来捕获点击位置
    editor.view.dom.addEventListener('mouseup', handleEditorMouseUp);
    handleSelectionUpdate();
  }
}

function handleSelectionUpdate() {
  if (globalTiptapEditor && !globalTiptapEditor.isDestroyed) {
    const newPos = globalTiptapEditor.state.selection.from;
    currentInsertPosition = newPos;
    console.log('[HUD] selectionUpdate 位置:', newPos);
  }
}

function handleEditorMouseUp() {
  // mouseup 后稍等一下让 selection 更新
  setTimeout(() => {
    if (globalTiptapEditor && !globalTiptapEditor.isDestroyed) {
      const newPos = globalTiptapEditor.state.selection.from;
      currentInsertPosition = newPos;
      console.log('[HUD] mouseup 位置:', newPos);
    }
  }, 0);
}

export function getGlobalTiptapEditor(): Editor | null {
  return globalTiptapEditor;
}

export function getLastKnownCursorPosition(): { from: number; to: number } | null {
  return { from: currentInsertPosition, to: currentInsertPosition };
}

export function getLastClickViewportPosition(): { x: number; y: number } | null {
  return null;
}

export function savePositionOnFirstTab(): void {
  // 直接从编辑器获取当前位置，确保是最新的
  if (globalTiptapEditor && !globalTiptapEditor.isDestroyed) {
    positionSavedOnFirstTab = globalTiptapEditor.state.selection.from;
  } else {
    positionSavedOnFirstTab = currentInsertPosition;
  }
  console.log('[HUD] 第一次 Tab 保存位置:', positionSavedOnFirstTab);
}

function getAndClearSavedPosition(): number {
  const pos = positionSavedOnFirstTab ?? currentInsertPosition;
  positionSavedOnFirstTab = null;
  return pos;
}

function getActiveCodeMirrorView(): EditorView | null {
  const activeElement = document.activeElement as HTMLElement | null;
  const cmEditor =
    activeElement?.closest('.cm-editor') ||
    document.querySelector('.cm-editor.cm-focused') ||
    document.querySelector('.cm-editor');

  if (!cmEditor || !(cmEditor instanceof HTMLElement)) return null;

  try {
    return EditorView.findFromDOM(cmEditor);
  } catch {
    return null;
  }
}

// ============================================================================
// 创建 MathLive 节点
// ============================================================================

function createMathLiveAtPosition(editor: Editor, pos: number): Promise<MathfieldElement | null> {
  const hasInlineMathLive = editor.schema.nodes.inlineMathLive !== undefined;
  if (!hasInlineMathLive) {
    return Promise.resolve(null);
  }
  
  const docSize = editor.state.doc.content.size;
  const safePos = Math.min(Math.max(1, pos), docSize);
  
  console.log('[HUD] 创建公式，位置:', safePos);
  
  const countBefore = document.querySelectorAll('math-field').length;
  
  try {
    editor
      .chain()
      .setTextSelection(safePos)
      .insertContent({ type: 'inlineMathLive', attrs: { latex: '' } })
      .run();
  } catch (e) {
    console.error('[HUD] 创建失败:', e);
    return Promise.resolve(null);
  }
  
  return new Promise((resolve) => {
    setTimeout(() => {
      const allFields = document.querySelectorAll('math-field');
      
      // 找新创建的空 math-field
      for (let i = allFields.length - 1; i >= 0; i--) {
        const mf = allFields[i] as MathfieldElement;
        if (mf.getValue?.() === '') {
          mf.focus();
          setActiveMathField(mf);
          resolve(mf);
          return;
        }
      }
      
      // 如果数量增加了，用最后一个
      if (allFields.length > countBefore) {
        const mf = allFields[allFields.length - 1] as MathfieldElement;
        mf.focus();
        setActiveMathField(mf);
        resolve(mf);
        return;
      }
      
      resolve(null);
    }, 120);
  });
}

// ============================================================================
// HUD Provider 组件
// ============================================================================

export function HUDProvider({ children, enabled = true }: HUDProviderProps) {
  const openHUD = useHUDStore((state) => state.openHUD);
  const closeHUD = useHUDStore((state) => state.closeHUD);
  const isOpen = useHUDStore((state) => state.isOpen);
  const updateCursorPosition = useHUDStore((state) => state.updateCursorPosition);
  const insertMode = useHUDStore((state) => state.insertMode);
  const insertFormat = useHUDStore((state) => state.insertFormat);

  // Track registered math-fields to avoid duplicate listeners
  const registeredMathFieldsRef = useRef<WeakSet<Element>>(new WeakSet());

  // ============================================================================
  // MutationObserver: 自动监听所有新创建的 math-field
  // 这确保粘贴创建的公式也能被量子键盘编辑
  // ============================================================================
  useEffect(() => {
    const registerMathField = (mathField: Element) => {
      if (registeredMathFieldsRef.current.has(mathField)) return;
      registeredMathFieldsRef.current.add(mathField);

      const handleFocus = () => {
        console.log('[HUD] math-field 获得焦点');
        setActiveMathField(mathField as MathfieldElement);
        updateCursorPosition((mathField as HTMLElement).getBoundingClientRect());
      };

      const handleClick = (e: Event) => {
        e.stopPropagation();
        console.log('[HUD] math-field 被点击');
        setActiveMathField(mathField as MathfieldElement);
        updateCursorPosition((mathField as HTMLElement).getBoundingClientRect());
      };

      mathField.addEventListener('focus', handleFocus);
      mathField.addEventListener('click', handleClick);
    };

    // 注册已存在的 math-field
    const existingFields = document.querySelectorAll('math-field');
    existingFields.forEach(registerMathField);

    // 监听新创建的 math-field
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            // 检查节点本身是否是 math-field
            if (node.tagName?.toLowerCase() === 'math-field') {
              registerMathField(node);
            }
            // 检查子节点中是否有 math-field
            const mathFields = node.querySelectorAll?.('math-field');
            mathFields?.forEach(registerMathField);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
    };
  }, [updateCursorPosition]);

  // HUD 打开时，监听编辑器点击以切换输入位置
  useEffect(() => {
    if (!isOpen || !globalTiptapEditor || globalTiptapEditor.isDestroyed) {
      return;
    }
    
    const handleEditorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // 检查是否点击在 math-field 上
      const clickedMathField = target.closest('math-field') as MathfieldElement | null;
      
      if (clickedMathField) {
        // 点击了已有的 math-field，切换到它
        console.log('[HUD] 点击了已有公式，切换目标');
        setActiveMathField(clickedMathField);
        updateCursorPosition(clickedMathField.getBoundingClientRect());
      } else {
        // 点击了编辑器的其他位置
        // 更新插入位置，清除当前 math-field
        // 下次输入会在新位置创建公式
        setTimeout(() => {
          if (globalTiptapEditor && !globalTiptapEditor.isDestroyed) {
            currentInsertPosition = globalTiptapEditor.state.selection.from;
            console.log('[HUD] 点击新位置:', currentInsertPosition);
            // 清除活动 math-field，这样下次输入会创建新的
            setActiveMathField(null);
          }
        }, 10);
      }
    };
    
    const editorDom = globalTiptapEditor.view.dom;
    editorDom.addEventListener('mouseup', handleEditorClick);
    
    return () => {
      try {
        editorDom.removeEventListener('mouseup', handleEditorClick);
      } catch {}
    };
  }, [isOpen, updateCursorPosition]);

  // 双击 Tab 处理
  const handleDoubleTap = useCallback(() => {
    if (isOpen) {
      closeHUD();
      return;
    }
    
    // 检查是否已经在 math-field 中
    const active = document.activeElement;
    if (active?.tagName?.toLowerCase() === 'math-field') {
      setActiveMathField(active as MathfieldElement);
      updateCursorPosition((active as HTMLElement).getBoundingClientRect());
      openHUD('existing');
      return;
    }

    // CodeMirror: 直接打开 HUD，并以当前光标位置定位
    const cmView = getActiveCodeMirrorView();
    if (cmView) {
      const pos = cmView.state.selection.main.head;
      const coords = cmView.coordsAtPos(pos);
      if (coords) {
        const rect = new DOMRect(
          coords.left,
          coords.top,
          Math.max(0, coords.right - coords.left),
          Math.max(0, coords.bottom - coords.top)
        );
        updateCursorPosition(rect);
      }
      openHUD('codemirror');
      return;
    }
    
    // 在当前位置创建新公式
    if (globalTiptapEditor && !globalTiptapEditor.isDestroyed) {
      const pos = getAndClearSavedPosition();
      
      createMathLiveAtPosition(globalTiptapEditor, pos).then((mf) => {
        if (mf) {
          updateCursorPosition(mf.getBoundingClientRect());
          openHUD('new');
        } else {
          openHUD('failed');
        }
      });
    }
  }, [isOpen, openHUD, closeHUD, updateCursorPosition]);

  const handleFirstTap = useCallback(() => {
    savePositionOnFirstTab();
  }, []);

  useDoubleTap({
    key: 'Tab',
    threshold: 350,
    onDoubleTap: handleDoubleTap,
    onFirstTap: handleFirstTap,
    enabled,
  });

  // 符号插入处理 - 支持 MathLive、Tiptap 和 CodeMirror
  const handleInsertSymbol = useCallback((latex: string) => {
    const displayMode = insertMode === 'block';
    // Unified input handling (CodeMirror / MathLive / textarea)
    if (insertLatexAtCursor(latex, { format: insertFormat, displayMode })) {
      return;
    }

    // Priority 1: Active MathLive math-field
    const mf = getActiveMathField();

    if (mf) {
      // 有活动的 math-field，直接插入
      try {
        mf.insert(latex, {
          insertionMode: 'insertAfter',
          selectionMode: 'after',
        });
        return;
      } catch (e) {
        console.error('[HUD] MathLive 插入失败:', e);
        setActiveMathField(null);
      }
    }

    // Priority 2: Check for CodeMirror editor (Markdown editor)
    const cmEditor = document.querySelector('.cm-editor.cm-focused') as HTMLElement;
    if (cmEditor) {
      const cmContent = cmEditor.querySelector('.cm-content');
      if (cmContent) {
        const view = (cmContent as CodeMirrorContentElement).cmView?.view;
        if (view) {
          try {
            const { from, to } = view.state.selection.main;
            const normalized = normalizeFormulaInput(latex, { preferDisplay: displayMode });
            const wrappedLatex =
              insertFormat === 'markdown'
                ? wrapLatexForMarkdown(normalized.latex, displayMode)
                : normalized.latex;
            view.dispatch({
              changes: { from, to, insert: wrappedLatex },
              selection: { anchor: from + wrappedLatex.length },
            });
            console.log('[HUD] CodeMirror 插入成功:', latex);
            return;
          } catch (e) {
            console.error('[HUD] CodeMirror 插入失败:', e);
          }
        }
      }
    }

    // Priority 3: Check for any focused CodeMirror (not necessarily .cm-focused)
    const activeElement = document.activeElement;
    if (activeElement?.closest('.cm-editor')) {
      const cmEditorEl = activeElement.closest('.cm-editor') as HTMLElement;
      const cmContent = cmEditorEl?.querySelector('.cm-content');
      if (cmContent) {
        const view = (cmContent as CodeMirrorContentElement).cmView?.view;
        if (view) {
          try {
            const { from, to } = view.state.selection.main;
            const normalized = normalizeFormulaInput(latex, { preferDisplay: displayMode });
            const wrappedLatex =
              insertFormat === 'markdown'
                ? wrapLatexForMarkdown(normalized.latex, displayMode)
                : normalized.latex;
            view.dispatch({
              changes: { from, to, insert: wrappedLatex },
              selection: { anchor: from + wrappedLatex.length },
            });
            console.log('[HUD] CodeMirror (active) 插入成功:', latex);
            return;
          } catch (e) {
            console.error('[HUD] CodeMirror (active) 插入失败:', e);
          }
        }
      }
    }

    // Priority 4: Tiptap editor - 在当前位置创建新的 math-field
    if (globalTiptapEditor && !globalTiptapEditor.isDestroyed) {
      const pos = currentInsertPosition;
      console.log('[HUD] 在 Tiptap 新位置创建公式:', pos);

      createMathLiveAtPosition(globalTiptapEditor, pos).then((newMf) => {
        if (newMf) {
          newMf.insert(latex, {
            insertionMode: 'insertAfter',
            selectionMode: 'after',
          });
          // 更新 HUD 位置
          updateCursorPosition(newMf.getBoundingClientRect());
        }
      });
    }
  }, [insertMode, insertFormat, updateCursorPosition]);

  // HUD 关闭时，聚焦到 math-field
  useEffect(() => {
    if (!isOpen) {
      const mf = getActiveMathField();
      if (mf) {
        try {
          mf.focus();
        } catch {}
      }
    }
  }, [isOpen]);

  return (
    <>
      {children}
      <KeyboardHUD onInsertSymbol={handleInsertSymbol} />
    </>
  );
}

export default HUDProvider;
