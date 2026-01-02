/**
 * Property-based tests for useDoubleTap Hook
 * Feature: quantum-keyboard-hud, Property 1: Double-Tap Timing Threshold
 * Validates: Requirements 1.1, 1.2
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  detectDoubleTap,
  wouldTriggerDoubleTap,
  type DoubleTapState,
} from '../use-double-tap';

describe('useDoubleTap', () => {
  const DEFAULT_THRESHOLD = 250;

  describe('Property 1: Double-Tap Timing Threshold', () => {
    /**
     * Property: For any two consecutive key presses, the HUD SHALL open
     * if and only if the time interval between them is less than 250ms
     */
    it('triggers double-tap iff interval < threshold', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000 }), // interval in ms
          fc.integer({ min: 100, max: 500 }), // threshold in ms
          (interval, threshold) => {
            const shouldTrigger = interval < threshold;
            const result = wouldTriggerDoubleTap(interval, threshold);
            return result === shouldTrigger;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Intervals exactly at threshold should NOT trigger
     */
    it('does not trigger at exactly threshold', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 500 }), // threshold
          (threshold) => {
            return !wouldTriggerDoubleTap(threshold, threshold);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Intervals just below threshold should trigger
     */
    it('triggers at threshold - 1', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 500 }), // threshold
          (threshold) => {
            return wouldTriggerDoubleTap(threshold - 1, threshold);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Zero interval should NOT trigger (same keypress)
     */
    it('does not trigger for zero interval', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 500 }), // threshold
          (threshold) => {
            return !wouldTriggerDoubleTap(0, threshold);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Negative intervals should NOT trigger
     */
    it('does not trigger for negative intervals', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -1000, max: -1 }), // negative interval
          fc.integer({ min: 100, max: 500 }), // threshold
          (interval, threshold) => {
            return !wouldTriggerDoubleTap(interval, threshold);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('detectDoubleTap', () => {
    it('detects double-tap when interval is within threshold', () => {
      const state: DoubleTapState = { lastPressTime: 1000 };
      const result = detectDoubleTap(1100, state, DEFAULT_THRESHOLD);
      
      expect(result.isDoubleTap).toBe(true);
      expect(result.newState.lastPressTime).toBe(0); // Reset after detection
    });

    it('does not detect double-tap when interval exceeds threshold', () => {
      const state: DoubleTapState = { lastPressTime: 1000 };
      const result = detectDoubleTap(1300, state, DEFAULT_THRESHOLD);
      
      expect(result.isDoubleTap).toBe(false);
      expect(result.newState.lastPressTime).toBe(1300); // Updated to current time
    });

    it('does not detect double-tap on first press', () => {
      const state: DoubleTapState = { lastPressTime: 0 };
      const result = detectDoubleTap(1000, state, DEFAULT_THRESHOLD);
      
      expect(result.isDoubleTap).toBe(false);
      expect(result.newState.lastPressTime).toBe(1000);
    });

    it('resets state after successful double-tap', () => {
      // First press
      let state: DoubleTapState = { lastPressTime: 0 };
      let result = detectDoubleTap(1000, state, DEFAULT_THRESHOLD);
      expect(result.isDoubleTap).toBe(false);
      state = result.newState;

      // Second press (double-tap)
      result = detectDoubleTap(1100, state, DEFAULT_THRESHOLD);
      expect(result.isDoubleTap).toBe(true);
      state = result.newState;

      // Third press should NOT be a double-tap (state was reset)
      result = detectDoubleTap(1200, state, DEFAULT_THRESHOLD);
      expect(result.isDoubleTap).toBe(false);
    });

    /**
     * Property: After a successful double-tap, the next single press
     * should not trigger another double-tap
     */
    it('prevents triple-tap from triggering twice', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 10000 }), // first press time
          fc.integer({ min: 1, max: 200 }), // interval to second press
          fc.integer({ min: 1, max: 200 }), // interval to third press
          (firstTime, interval1, interval2) => {
            const threshold = DEFAULT_THRESHOLD;
            
            // First press
            let state: DoubleTapState = { lastPressTime: 0 };
            let result = detectDoubleTap(firstTime, state, threshold);
            state = result.newState;

            // Second press (should be double-tap if interval1 < threshold)
            const secondTime = firstTime + interval1;
            result = detectDoubleTap(secondTime, state, threshold);
            const wasDoubleTap = result.isDoubleTap;
            state = result.newState;

            // Third press
            const thirdTime = secondTime + interval2;
            result = detectDoubleTap(thirdTime, state, threshold);

            // If second was a double-tap, third should NOT be
            // (because state was reset)
            if (wasDoubleTap) {
              return !result.isDoubleTap;
            }
            
            // If second was not a double-tap, third might be
            // depending on interval2
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('wouldTriggerDoubleTap', () => {
    it('returns true for intervals less than threshold', () => {
      expect(wouldTriggerDoubleTap(100, 250)).toBe(true);
      expect(wouldTriggerDoubleTap(249, 250)).toBe(true);
      expect(wouldTriggerDoubleTap(1, 250)).toBe(true);
    });

    it('returns false for intervals >= threshold', () => {
      expect(wouldTriggerDoubleTap(250, 250)).toBe(false);
      expect(wouldTriggerDoubleTap(251, 250)).toBe(false);
      expect(wouldTriggerDoubleTap(500, 250)).toBe(false);
    });

    it('returns false for zero or negative intervals', () => {
      expect(wouldTriggerDoubleTap(0, 250)).toBe(false);
      expect(wouldTriggerDoubleTap(-1, 250)).toBe(false);
      expect(wouldTriggerDoubleTap(-100, 250)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('handles very small thresholds', () => {
      expect(wouldTriggerDoubleTap(5, 10)).toBe(true);
      expect(wouldTriggerDoubleTap(10, 10)).toBe(false);
    });

    it('handles very large intervals', () => {
      expect(wouldTriggerDoubleTap(1000000, 250)).toBe(false);
    });

    it('handles threshold of 1ms', () => {
      expect(wouldTriggerDoubleTap(0, 1)).toBe(false);
      expect(wouldTriggerDoubleTap(1, 1)).toBe(false);
    });
  });
});
