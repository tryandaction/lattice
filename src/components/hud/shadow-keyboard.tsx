'use client';

/**
 * Shadow Keyboard Component
 * Renders a visual QWERTY keyboard layout with math symbol mappings
 */

import React, { useCallback, useRef } from 'react';
import { Keycap } from './keycap';
import {
  QWERTY_LAYOUT,
  KEY_LABELS,
  quantumKeymap,
  hasVariants,
} from '../../config/quantum-keymap';

export interface ShadowKeyboardProps {
  /** Whether Shift is currently held (deprecated - kept for compatibility) */
  isShiftHeld: boolean;
  /** Key code of the currently flashing key */
  flashingKey: string | null;
  /** Callback when a key is selected (single click) */
  onKeySelect: (keyCode: string) => void;
  /** Callback when Shift+key is selected */
  onShiftKeySelect?: (keyCode: string) => void;
  /** Ref map for keycap positions (for symbol selector positioning) */
  keycapRefs?: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  /** Currently active key (for symbol selector) */
  activeKey?: string | null;
}

export function ShadowKeyboard({
  isShiftHeld,
  flashingKey,
  onKeySelect,
  onShiftKeySelect,
  keycapRefs,
  activeKey,
}: ShadowKeyboardProps) {
  const internalRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const refs = keycapRefs ?? internalRefs;

  const setKeycapRef = useCallback(
    (keyCode: string, element: HTMLButtonElement | null) => {
      if (element) {
        refs.current.set(keyCode, element);
      } else {
        refs.current.delete(keyCode);
      }
    },
    [refs]
  );

  const handleClick = useCallback(
    (keyCode: string, event: React.MouseEvent) => {
      if (event.shiftKey && onShiftKeySelect) {
        onShiftKeySelect(keyCode);
      } else {
        onKeySelect(keyCode);
      }
    },
    [onKeySelect, onShiftKeySelect]
  );

  return (
    <div className="shadow-keyboard" role="group" aria-label="Math symbol keyboard">
      {QWERTY_LAYOUT.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="flex gap-1"
          style={{ marginLeft: `${row.offset * 3}rem` }}
        >
          {row.keys.map((keyCode) => {
            const mapping = quantumKeymap[keyCode];
            const physicalLabel = KEY_LABELS[keyCode] || keyCode;

            // Skip keys without mappings
            if (!mapping) {
              return (
                <div
                  key={keyCode}
                  className="w-12 h-12 rounded-xl bg-white/3 border border-white/5"
                  aria-hidden="true"
                />
              );
            }

            const isActive = activeKey === keyCode;

            return (
              <Keycap
                key={keyCode}
                ref={(el) => setKeycapRef(keyCode, el)}
                keyCode={keyCode}
                physicalLabel={physicalLabel}
                defaultSymbol={mapping.default}
                shiftSymbol={mapping.shift}
                hasVariants={hasVariants(keyCode) || !!mapping.shift}
                isShiftHeld={false}
                isFlashing={flashingKey === keyCode}
                isActive={isActive}
                onClick={(e) => handleClick(keyCode, e)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Get the position of a keycap for symbol selector positioning
 */
export function getKeycapPosition(
  keycapRefs: Map<string, HTMLButtonElement>,
  keyCode: string
): { x: number; y: number } | null {
  const element = keycapRefs.get(keyCode);
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.bottom + 8,
  };
}

export default ShadowKeyboard;
