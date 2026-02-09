"use client";

import { useRef, useCallback, useEffect, useState, useMemo } from 'react';

/**
 * Stylus point with pressure and tilt data
 */
export interface StylusPoint {
  /** X coordinate in pixels */
  x: number;
  /** Y coordinate in pixels */
  y: number;
  /** Pressure value (0-1) */
  pressure: number;
  /** Tilt X angle in degrees (-90 to 90) */
  tiltX: number;
  /** Tilt Y angle in degrees (-90 to 90) */
  tiltY: number;
  /** Timestamp in milliseconds */
  timestamp: number;
}

/**
 * Input type classification
 */
export type InputType = 'pen' | 'touch' | 'mouse';

/**
 * Stylus input state
 */
export interface StylusInputState {
  /** Whether stylus is currently drawing */
  isDrawing: boolean;
  /** Current input type */
  inputType: InputType | null;
  /** Current stylus points in the stroke */
  currentPoints: StylusPoint[];
  /** Whether palm rejection is active */
  isPalmRejectionActive: boolean;
}

/**
 * Configuration for stylus input
 */
export interface StylusInputConfig {
  /** Called when a stroke starts */
  onStrokeStart?: (point: StylusPoint, inputType: InputType) => void;
  /** Called when stroke continues with new points */
  onStrokeMove?: (points: StylusPoint[]) => void;
  /** Called when stroke ends */
  onStrokeEnd?: (points: StylusPoint[]) => void;
  /** Called when stroke is cancelled (e.g., palm rejection) */
  onStrokeCancel?: () => void;
  /** Whether to enable palm rejection (default: true) */
  enablePalmRejection?: boolean;
  /** Minimum pressure to register (default: 0.01) */
  minPressure?: number;
  /** Whether to only accept pen input (default: false) */
  penOnly?: boolean;
  /** Maximum touch area to accept (for palm rejection, default: 100) */
  maxTouchArea?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<StylusInputConfig> = {
  onStrokeStart: () => {},
  onStrokeMove: () => {},
  onStrokeEnd: () => {},
  onStrokeCancel: () => {},
  enablePalmRejection: true,
  minPressure: 0.01,
  penOnly: false,
  maxTouchArea: 100,
};

/**
 * Detect input type from pointer event
 */
function getInputType(event: PointerEvent): InputType {
  switch (event.pointerType) {
    case 'pen':
      return 'pen';
    case 'touch':
      return 'touch';
    case 'mouse':
    default:
      return 'mouse';
  }
}

/**
 * Extract stylus point from pointer event
 */
function extractStylusPoint(event: PointerEvent): StylusPoint {
  return {
    x: event.clientX,
    y: event.clientY,
    pressure: event.pressure || 0.5, // Default pressure for non-pressure devices
    tiltX: event.tiltX || 0,
    tiltY: event.tiltY || 0,
    timestamp: event.timeStamp,
  };
}

/**
 * Check if touch should be rejected as palm
 */
function isPalmTouch(event: PointerEvent, maxTouchArea: number): boolean {
  // Check touch area (width * height)
  const touchArea = (event.width || 1) * (event.height || 1);
  
  // Large touch area indicates palm
  if (touchArea > maxTouchArea) {
    return true;
  }
  
  // Check if touch is at edge of screen (common palm position)
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const edgeThreshold = 50;
  
  if (
    event.clientX < edgeThreshold ||
    event.clientX > screenWidth - edgeThreshold ||
    event.clientY > screenHeight - edgeThreshold
  ) {
    // Edge touch with large area is likely palm
    if (touchArea > maxTouchArea / 2) {
      return true;
    }
  }
  
  return false;
}

/**
 * Hook for handling stylus/pen input with pressure sensitivity
 * 
 * Features:
 * - Captures pressure, tilt data from stylus
 * - Differentiates between pen, touch, and mouse input
 * - Palm rejection for touch input
 * - Smooth point collection for stroke rendering
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.5, 8.6
 */
export function useStylusInput<T extends HTMLElement>(
  config: StylusInputConfig = {}
) {
  const opts = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);
  const elementRef = useRef<T>(null);
  
  const [state, setState] = useState<StylusInputState>({
    isDrawing: false,
    inputType: null,
    currentPoints: [],
    isPalmRejectionActive: false,
  });
  
  // Track active pointer for multi-touch handling
  const activePointerRef = useRef<number | null>(null);
  const pointsRef = useRef<StylusPoint[]>([]);
  const rejectedPointersRef = useRef<Set<number>>(new Set());

  // Handle pointer down
  const handlePointerDown = useCallback((event: PointerEvent) => {
    const inputType = getInputType(event);
    
    // If pen-only mode, reject non-pen input
    if (opts.penOnly && inputType !== 'pen') {
      return;
    }
    
    // Palm rejection for touch input
    if (opts.enablePalmRejection && inputType === 'touch') {
      if (isPalmTouch(event, opts.maxTouchArea)) {
        rejectedPointersRef.current.add(event.pointerId);
        setState(prev => ({ ...prev, isPalmRejectionActive: true }));
        return;
      }
    }
    
    // If already drawing with another pointer, ignore
    if (activePointerRef.current !== null) {
      return;
    }
    
    // Check minimum pressure
    const pressure = event.pressure || 0.5;
    if (pressure < opts.minPressure) {
      return;
    }
    
    // Start stroke
    activePointerRef.current = event.pointerId;
    const point = extractStylusPoint(event);
    pointsRef.current = [point];
    
    setState({
      isDrawing: true,
      inputType,
      currentPoints: [point],
      isPalmRejectionActive: false,
    });
    
    opts.onStrokeStart(point, inputType);
    
    // Capture pointer for reliable tracking
    (event.target as HTMLElement)?.setPointerCapture?.(event.pointerId);
  }, [opts]);

  // Handle pointer move
  const handlePointerMove = useCallback((event: PointerEvent) => {
    // Ignore rejected pointers
    if (rejectedPointersRef.current.has(event.pointerId)) {
      return;
    }
    
    // Only process if this is the active pointer
    if (event.pointerId !== activePointerRef.current) {
      return;
    }
    
    // Check minimum pressure
    const pressure = event.pressure || 0.5;
    if (pressure < opts.minPressure) {
      return;
    }
    
    // Add point
    const point = extractStylusPoint(event);
    pointsRef.current.push(point);
    
    // Get coalesced events for smoother strokes
    const coalescedEvents = event.getCoalescedEvents?.() || [event];
    const coalescedPoints = coalescedEvents.map(extractStylusPoint);
    
    // Update state with all points
    setState(prev => ({
      ...prev,
      currentPoints: [...pointsRef.current],
    }));
    
    opts.onStrokeMove(coalescedPoints);
  }, [opts]);

  // Handle pointer up
  const handlePointerUp = useCallback((event: PointerEvent) => {
    // Clean up rejected pointer
    if (rejectedPointersRef.current.has(event.pointerId)) {
      rejectedPointersRef.current.delete(event.pointerId);
      if (rejectedPointersRef.current.size === 0) {
        setState(prev => ({ ...prev, isPalmRejectionActive: false }));
      }
      return;
    }
    
    // Only process if this is the active pointer
    if (event.pointerId !== activePointerRef.current) {
      return;
    }
    
    // End stroke
    const finalPoints = [...pointsRef.current];
    
    activePointerRef.current = null;
    pointsRef.current = [];
    
    setState({
      isDrawing: false,
      inputType: null,
      currentPoints: [],
      isPalmRejectionActive: rejectedPointersRef.current.size > 0,
    });
    
    if (finalPoints.length > 0) {
      opts.onStrokeEnd(finalPoints);
    }
    
    // Release pointer capture
    (event.target as HTMLElement)?.releasePointerCapture?.(event.pointerId);
  }, [opts]);

  // Handle pointer cancel
  const handlePointerCancel = useCallback((event: PointerEvent) => {
    // Clean up rejected pointer
    if (rejectedPointersRef.current.has(event.pointerId)) {
      rejectedPointersRef.current.delete(event.pointerId);
      return;
    }
    
    // Only process if this is the active pointer
    if (event.pointerId !== activePointerRef.current) {
      return;
    }
    
    // Cancel stroke
    activePointerRef.current = null;
    pointsRef.current = [];
    
    setState({
      isDrawing: false,
      inputType: null,
      currentPoints: [],
      isPalmRejectionActive: rejectedPointersRef.current.size > 0,
    });
    
    opts.onStrokeCancel();
  }, [opts]);

  // Handle pointer leave
  const handlePointerLeave = useCallback((event: PointerEvent) => {
    // Treat leave as end if drawing
    if (event.pointerId === activePointerRef.current) {
      handlePointerUp(event);
    }
  }, [handlePointerUp]);

  // Set up event listeners
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    // Use passive: false to allow preventDefault if needed
    const options = { passive: false };

    element.addEventListener('pointerdown', handlePointerDown, options);
    element.addEventListener('pointermove', handlePointerMove, options);
    element.addEventListener('pointerup', handlePointerUp, options);
    element.addEventListener('pointercancel', handlePointerCancel, options);
    element.addEventListener('pointerleave', handlePointerLeave, options);

    // Prevent default touch behavior to avoid scrolling while drawing
    const preventTouchDefault = (e: TouchEvent) => {
      if (state.isDrawing) {
        e.preventDefault();
      }
    };
    element.addEventListener('touchmove', preventTouchDefault, { passive: false });

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointercancel', handlePointerCancel);
      element.removeEventListener('pointerleave', handlePointerLeave);
      element.removeEventListener('touchmove', preventTouchDefault);
    };
  }, [
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    state.isDrawing,
  ]);

  /**
   * Cancel the current stroke
   */
  const cancelStroke = useCallback(() => {
    if (activePointerRef.current !== null) {
      activePointerRef.current = null;
      pointsRef.current = [];
      
      setState({
        isDrawing: false,
        inputType: null,
        currentPoints: [],
        isPalmRejectionActive: false,
      });
      
      opts.onStrokeCancel();
    }
  }, [opts]);

  /**
   * Check if a specific input type is supported
   */
  const isInputTypeSupported = useCallback((type: InputType): boolean => {
    if (typeof window === 'undefined') return false;
    
    switch (type) {
      case 'pen':
        // Check for pen support via matchMedia
        return window.matchMedia('(pointer: fine)').matches;
      case 'touch':
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      case 'mouse':
        return true;
      default:
        return false;
    }
  }, []);

  return {
    ref: elementRef,
    state,
    cancelStroke,
    isInputTypeSupported,
  };
}

/**
 * Utility to calculate stroke width from pressure
 */
export function calculateStrokeWidth(
  pressure: number,
  minWidth: number = 1,
  maxWidth: number = 10
): number {
  // Apply easing for more natural feel
  const easedPressure = Math.pow(pressure, 0.7);
  return minWidth + (maxWidth - minWidth) * easedPressure;
}

/**
 * Utility to calculate stroke opacity from pressure
 */
export function calculateStrokeOpacity(
  pressure: number,
  minOpacity: number = 0.3,
  maxOpacity: number = 1
): number {
  return minOpacity + (maxOpacity - minOpacity) * pressure;
}
