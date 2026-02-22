"use client";

/**
 * Handwriting Viewer Component
 * 手写笔记查看器 - 用于在主应用中查看和编辑手写笔记
 */

import React, { useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { HandwritingEditor } from '@/components/handwriting';
import { useHandwritingStore } from '@/stores/handwriting-store';
import type { Layer, BackgroundType, HandwritingDocument } from '@/lib/handwriting/types';

interface HandwritingViewerProps {
  /** 文件路径 */
  filePath: string;
  /** 文件内容（JSON 字符串） */
  content?: string;
  /** 内容变化回调 */
  onChange?: (content: string) => void;
  /** 保存回调 */
  onSave?: () => void;
  /** 只读模式 */
  readOnly?: boolean;
  /** 自定义类名 */
  className?: string;
}

// 默认文档
const createDefaultDocument = (): HandwritingDocument => ({
  id: `doc-${Date.now()}`,
  version: 1,
  layers: [
    {
      id: 'default',
      name: '图层 1',
      visible: true,
      locked: false,
      strokes: [],
    },
  ],
  background: 'grid',
  pageSize: { width: 1920, height: 1080, infinite: true },
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// 解析文档内容
function parseDocument(content: string | undefined): HandwritingDocument {
  if (!content) {
    return createDefaultDocument();
  }

  try {
    const doc = JSON.parse(content) as HandwritingDocument;
    // 验证基本结构
    if (!doc.layers || !Array.isArray(doc.layers)) {
      return createDefaultDocument();
    }
    return doc;
  } catch {
    return createDefaultDocument();
  }
}

// 序列化文档
function serializeDocument(
  layers: Layer[],
  background: BackgroundType,
  existingDoc?: HandwritingDocument
): string {
  const doc: HandwritingDocument = {
    id: existingDoc?.id || `doc-${Date.now()}`,
    version: 1,
    layers,
    background,
    pageSize: existingDoc?.pageSize || { width: 1920, height: 1080, infinite: true },
    createdAt: existingDoc?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  return JSON.stringify(doc, null, 2);
}

export function HandwritingViewer({
  filePath: _filePath,
  content,
  onChange,
  onSave,
  readOnly = false,
  className,
}: HandwritingViewerProps) {
  const document = useMemo(() => parseDocument(content), [content]);
  const { background, markSaved } = useHandwritingStore();

  // 处理内容变化
  const handleChange = useCallback((layers: Layer[]) => {
    if (!onChange || !document) return;

    const serialized = serializeDocument(layers, background, document);
    onChange(serialized);
  }, [onChange, document, background]);

  // 处理保存
  const handleSave = useCallback(() => {
    markSaved();
    onSave?.();
  }, [markSaved, onSave]);

  if (!document) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className={cn('w-full h-full', className)}>
      <HandwritingEditor
        initialLayers={document.layers}
        initialBackground={document.background}
        onChange={handleChange}
        onSave={handleSave}
        readOnly={readOnly}
      />
    </div>
  );
}

export default HandwritingViewer;

