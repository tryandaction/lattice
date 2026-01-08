/**
 * Split View Hook
 * 支持 iPad 分屏模式检测和适配
 */

import { useState, useEffect, useCallback } from 'react';

interface SplitViewState {
  isSplitView: boolean;
  splitRatio: number; // 0-1, 当前应用占屏幕的比例
  isSlideOver: boolean;
  isCompact: boolean;
}

/**
 * 检测 iPad 分屏模式
 */
export function useSplitView(): SplitViewState {
  const [state, setState] = useState<SplitViewState>({
    isSplitView: false,
    splitRatio: 1,
    isSlideOver: false,
    isCompact: false,
  });

  const updateState = useCallback(() => {
    if (typeof window === 'undefined') return;

    const screenWidth = window.screen.width;
    const windowWidth = window.innerWidth;
    const ratio = windowWidth / screenWidth;

    // 检测分屏
    const isSplitView = ratio < 0.95;
    
    // 检测 Slide Over (窄窗口悬浮)
    const isSlideOver = windowWidth < 400 && isSplitView;
    
    // 紧凑模式 (需要简化 UI)
    const isCompact = windowWidth < 500;

    setState({
      isSplitView,
      splitRatio: ratio,
      isSlideOver,
      isCompact,
    });
  }, []);

  useEffect(() => {
    updateState();

    // 监听窗口大小变化
    window.addEventListener('resize', updateState);
    
    // 监听 visualViewport 变化 (更精确)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateState);
    }

    return () => {
      window.removeEventListener('resize', updateState);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateState);
      }
    };
  }, [updateState]);

  return state;
}

/**
 * 检测虚拟键盘状态
 */
export function useVirtualKeyboard() {
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      if (window.visualViewport) {
        const viewportHeight = window.visualViewport.height;
        const windowHeight = window.innerHeight;
        const diff = windowHeight - viewportHeight;
        
        // 如果差值大于 100px，认为键盘弹出
        const visible = diff > 100;
        setIsKeyboardVisible(visible);
        setKeyboardHeight(visible ? diff : 0);
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      handleResize();
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
    };
  }, []);

  return { isKeyboardVisible, keyboardHeight };
}

/**
 * 检测设备方向
 */
export function useDeviceOrientation() {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');

  useEffect(() => {
    const updateOrientation = () => {
      if (typeof window === 'undefined') return;
      
      // 使用 screen.orientation API
      if (window.screen.orientation) {
        const type = window.screen.orientation.type;
        setOrientation(type.includes('portrait') ? 'portrait' : 'landscape');
      } else {
        // 回退到窗口尺寸判断
        setOrientation(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
      }
    };

    updateOrientation();

    // 监听方向变化
    if (window.screen.orientation) {
      window.screen.orientation.addEventListener('change', updateOrientation);
    }
    window.addEventListener('orientationchange', updateOrientation);
    window.addEventListener('resize', updateOrientation);

    return () => {
      if (window.screen.orientation) {
        window.screen.orientation.removeEventListener('change', updateOrientation);
      }
      window.removeEventListener('orientationchange', updateOrientation);
      window.removeEventListener('resize', updateOrientation);
    };
  }, []);

  return orientation;
}

