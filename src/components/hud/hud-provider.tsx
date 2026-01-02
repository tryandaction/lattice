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
import { KeyboardHUD } from './keyboard-hud';
import { useDoubleTap } from '../../hooks/use-double-tap';
import { useHUDStore } from '../../stores/hud-store';
import type { MathfieldElement } from 'mathlive';
import type { Editor } from '@tiptap/react';

export interface HUDProviderProps {
  children: React.ReactNode;
  enabled?: boolean;
}

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
    } catch (e) {}
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
      } catch (e) {}
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

  // 符号插入处理
  const handleInsertSymbol = useCallback((latex: string) => {
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
        console.error('[HUD] 插入失败:', e);
        setActiveMathField(null);
      }
    }
    
    // 没有活动的 math-field，在当前位置创建新的
    if (globalTiptapEditor && !globalTiptapEditor.isDestroyed) {
      const pos = currentInsertPosition;
      console.log('[HUD] 在新位置创建公式:', pos);
      
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
  }, [updateCursorPosition]);

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
