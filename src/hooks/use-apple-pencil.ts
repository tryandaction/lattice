/**
 * Apple Pencil Hook
 * 支持 Apple Pencil 双击切换工具
 */

import { useEffect, useCallback, useRef } from 'react';

interface ApplePencilOptions {
  onDoubleTap?: () => void;
  onSqueeze?: () => void;
  enabled?: boolean;
}

/**
 * 检测 Apple Pencil 双击事件
 * Apple Pencil 2 双击会触发特殊的 pointer 事件
 */
export function useApplePencil({
  onDoubleTap,
  onSqueeze,
  enabled = true,
}: ApplePencilOptions) {
  const lastPenDownRef = useRef<number>(0);
  const lastPenUpRef = useRef<number>(0);
  const tapCountRef = useRef<number>(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePenDoubleTap = useCallback(() => {
    onDoubleTap?.();
  }, [onDoubleTap]);

  useEffect(() => {
    if (!enabled) return;

    // 方法1: 监听 preferredStylusAction (Safari/WebKit)
    // @ts-ignore - 实验性 API
    if ('preferredStylusAction' in navigator) {
      // Safari 可能支持这个 API
    }

    // 方法2: 通过快速连续的 pen 事件检测双击
    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return;

      const now = Date.now();
      const timeSinceLastDown = now - lastPenDownRef.current;
      
      // 检测快速双击 (< 300ms)
      if (timeSinceLastDown < 300 && timeSinceLastDown > 50) {
        // 检查是否是同一位置的双击 (可能是 Apple Pencil 双击)
        tapCountRef.current++;
        
        if (tapCountRef.current >= 2) {
          handlePenDoubleTap();
          tapCountRef.current = 0;
        }
      } else {
        tapCountRef.current = 1;
      }

      lastPenDownRef.current = now;

      // 重置计数器
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = setTimeout(() => {
        tapCountRef.current = 0;
      }, 400);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return;
      lastPenUpRef.current = Date.now();
    };

    // 方法3: 监听特殊的 button 值
    // Apple Pencil 双击可能触发 button === 5
    const handlePointerEvent = (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return;
      
      // 某些浏览器可能将 Apple Pencil 双击映射到特殊按钮
      if (e.button === 5 || e.buttons === 32) {
        handlePenDoubleTap();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointerdown', handlePointerEvent);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointerdown', handlePointerEvent);
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    };
  }, [enabled, handlePenDoubleTap]);
}

/**
 * 检测设备是否支持 Apple Pencil
 */
export function supportsApplePencil(): boolean {
  if (typeof window === 'undefined') return false;
  
  // 检查是否是 iPad
  const isIPad = /iPad/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  
  // 检查是否支持 pointer 事件
  const hasPointerEvents = 'PointerEvent' in window;
  
  return isIPad && hasPointerEvents;
}

