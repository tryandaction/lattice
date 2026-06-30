/**
 * Property-based tests for HUD Store
 * Feature: quantum-keyboard-hud
 * Validates: Requirements 1.1, 1.2, 2.1, 2.2, 2.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { computeSafeHUDPosition, useHUDStore, computeMode, isStateConsistent } from '../hud-store';

describe('HUD Store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useHUDStore.setState({
      isOpen: false,
      activeSymbolKey: null,
      highlightedIndex: 0,
      activeMathFieldId: null,
      flashingKey: null,
      isEditMode: false,
      position: 'auto',
      customOffset: null,
      isDragging: false,
      cursorPosition: null,
      hudSize: { width: 500, height: 178 },
    });
  });

  describe('Property 1: HUD Open/Close State', () => {
    it('openHUD sets isOpen to true', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (mathFieldId) => {
          useHUDStore.getState().openHUD(mathFieldId);
          return useHUDStore.getState().isOpen === true;
        }),
        { numRuns: 50 }
      );
    });

    it('closeHUD sets isOpen to false', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (mathFieldId) => {
          useHUDStore.getState().openHUD(mathFieldId);
          useHUDStore.getState().closeHUD();
          return useHUDStore.getState().isOpen === false;
        }),
        { numRuns: 50 }
      );
    });

    it('closeHUD resets all state', () => {
      useHUDStore.getState().openHUD('test');
      useHUDStore.getState().openSymbolSelector('KeyI');
      useHUDStore.getState().closeHUD();
      
      const state = useHUDStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.activeSymbolKey).toBe(null);
      expect(state.highlightedIndex).toBe(0);
      expect(state.isEditMode).toBe(false);
    });
  });

  describe('Property 2: Symbol Selector State', () => {
    it('openSymbolSelector only works when HUD is open', () => {
      // HUD closed - should not open symbol selector
      useHUDStore.getState().openSymbolSelector('KeyI');
      expect(useHUDStore.getState().activeSymbolKey).toBe(null);
      
      // HUD open - should open symbol selector
      useHUDStore.getState().openHUD('test');
      useHUDStore.getState().openSymbolSelector('KeyI');
      expect(useHUDStore.getState().activeSymbolKey).toBe('KeyI');
    });

    it('closeSymbolSelector clears activeSymbolKey', () => {
      useHUDStore.getState().openHUD('test');
      useHUDStore.getState().openSymbolSelector('KeyI');
      useHUDStore.getState().closeSymbolSelector();
      
      expect(useHUDStore.getState().activeSymbolKey).toBe(null);
      expect(useHUDStore.getState().highlightedIndex).toBe(0);
    });
  });

  describe('Property 3: Navigation', () => {
    it('navigateSymbol wraps around correctly', () => {
      useHUDStore.getState().openHUD('test');
      useHUDStore.getState().openSymbolSelector('KeyI');
      
      const totalItems = useHUDStore.getState().getTotalItems();
      
      // Navigate down through all items
      for (let i = 0; i < totalItems; i++) {
        useHUDStore.getState().navigateSymbol('down');
      }
      
      // Should wrap back to 0
      expect(useHUDStore.getState().highlightedIndex).toBe(0);
    });

    it('navigateSymbol up wraps correctly', () => {
      useHUDStore.getState().openHUD('test');
      useHUDStore.getState().openSymbolSelector('KeyI');
      
      // Navigate up from 0 should wrap to last item
      useHUDStore.getState().navigateSymbol('up');
      
      const totalItems = useHUDStore.getState().getTotalItems();
      expect(useHUDStore.getState().highlightedIndex).toBe(totalItems - 1);
    });
  });

  describe('Property 4: Edit Mode', () => {
    it('toggleEditMode toggles isEditMode', () => {
      useHUDStore.getState().openHUD('test');
      
      expect(useHUDStore.getState().isEditMode).toBe(false);
      useHUDStore.getState().toggleEditMode();
      expect(useHUDStore.getState().isEditMode).toBe(true);
      useHUDStore.getState().toggleEditMode();
      expect(useHUDStore.getState().isEditMode).toBe(false);
    });

    it('setEditMode sets specific value', () => {
      useHUDStore.getState().openHUD('test');
      
      useHUDStore.getState().setEditMode(true);
      expect(useHUDStore.getState().isEditMode).toBe(true);
      
      useHUDStore.getState().setEditMode(false);
      expect(useHUDStore.getState().isEditMode).toBe(false);
    });
  });

  describe('computeMode', () => {
    it('returns closed when not open', () => {
      expect(computeMode({ isOpen: false, activeSymbolKey: null })).toBe('closed');
    });

    it('returns standard when open without symbol selector', () => {
      expect(computeMode({ isOpen: true, activeSymbolKey: null })).toBe('standard');
    });

    it('returns symbol-selector when symbol selector is open', () => {
      expect(computeMode({ isOpen: true, activeSymbolKey: 'KeyI' })).toBe('symbol-selector');
    });
  });

  describe('isStateConsistent', () => {
    it('returns true for valid states', () => {
      expect(isStateConsistent({ isOpen: false, activeSymbolKey: null, highlightedIndex: 0 })).toBe(true);
      expect(isStateConsistent({ isOpen: true, activeSymbolKey: null, highlightedIndex: 0 })).toBe(true);
      expect(isStateConsistent({ isOpen: true, activeSymbolKey: 'KeyI', highlightedIndex: 0 })).toBe(true);
    });

    it('returns false when activeSymbolKey is set but HUD is closed', () => {
      expect(isStateConsistent({ isOpen: false, activeSymbolKey: 'KeyI', highlightedIndex: 0 })).toBe(false);
    });
  });

  describe('Flash Key', () => {
    it('flashKey sets and auto-clears flashingKey', async () => {
      useHUDStore.getState().flashKey('KeyI');
      expect(useHUDStore.getState().flashingKey).toBe('KeyI');
      
      // Wait for auto-clear
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(useHUDStore.getState().flashingKey).toBe(null);
    });
  });

  describe('Position Management', () => {
    it('setPosition updates position and clears customOffset', () => {
      useHUDStore.getState().setCustomOffset({ x: 100, y: 50 });
      useHUDStore.getState().setPosition('top');
      
      const state = useHUDStore.getState();
      expect(state.position).toBe('top');
      expect(state.customOffset).toBe(null);
    });

    it('setCustomOffset updates offset', () => {
      useHUDStore.getState().setCustomOffset({ x: 100, y: 50 });
      
      const state = useHUDStore.getState();
      expect(state.customOffset).toEqual({ x: 100, y: 50 });
    });

    it('resetPosition resets to auto with no offset', () => {
      useHUDStore.getState().setPosition('top');
      useHUDStore.getState().setCustomOffset({ x: 100, y: 50 });
      useHUDStore.getState().resetPosition();
      
      const state = useHUDStore.getState();
      expect(state.position).toBe('auto');
      expect(state.customOffset).toBe(null);
    });

    it('computeOptimalPosition returns bottom when no cursor position', () => {
      useHUDStore.getState().openHUD('test');
      const result = useHUDStore.getState().computeOptimalPosition();
      expect(result.side).toBe('bottom');
      expect(typeof result.topPx).toBe('number');
      expect(typeof result.leftPx).toBe('number');
    });

    it('computeOptimalPosition respects fixed position setting', () => {
      useHUDStore.getState().openHUD('test');
      useHUDStore.getState().setPosition('top');
      const result = useHUDStore.getState().computeOptimalPosition();
      expect(result.side).toBe('top');
      expect(typeof result.topPx).toBe('number');
      expect(typeof result.leftPx).toBe('number');
    });

    it('computeSafeHUDPosition clamps the HUD inside small viewports', () => {
      const result = computeSafeHUDPosition({
        cursorPosition: {
          top: 540,
          bottom: 568,
          left: 320,
          right: 350,
          centerX: 335,
          centerY: 554,
        },
        hudSize: { width: 700, height: 360 },
        viewport: { width: 360, height: 640 },
        position: 'auto',
      });

      expect(result.leftPx).toBeGreaterThanOrEqual(12);
      expect(result.topPx).toBeGreaterThanOrEqual(12);
      expect(result.leftPx + result.widthPx).toBeLessThanOrEqual(348);
      expect(result.topPx + result.heightPx).toBeLessThanOrEqual(628);
    });

    it('uses compact visible keyboard dimensions by default', () => {
      const result = computeSafeHUDPosition({
        cursorPosition: {
          top: 220,
          bottom: 244,
          left: 300,
          right: 304,
          centerX: 302,
          centerY: 232,
        },
        hudSize: { width: 500, height: 178 },
        viewport: { width: 1280, height: 720 },
        position: 'auto',
      });

      expect(result.widthPx).toBeLessThanOrEqual(500);
      expect(result.heightPx).toBeLessThanOrEqual(220);
      expect(result.side).toBe('top');
    });

    it('updateHUDSize stores measured dimensions', () => {
      useHUDStore.getState().updateHUDSize({ width: 612, height: 284 });
      expect(useHUDStore.getState().hudSize).toEqual({ width: 612, height: 284 });
    });

    it('closeHUD preserves position settings', () => {
      useHUDStore.getState().openHUD('test');
      useHUDStore.getState().setPosition('top');
      useHUDStore.getState().setCustomOffset({ x: 50, y: 30 });
      useHUDStore.getState().closeHUD();
      
      const state = useHUDStore.getState();
      expect(state.position).toBe('top');
      expect(state.customOffset).toEqual({ x: 50, y: 30 });
    });

    it('updateCursorPosition stores serializable position data', () => {
      const mockRect = {
        top: 100,
        bottom: 150,
        left: 200,
        right: 400,
        width: 200,
        height: 50,
        x: 200,
        y: 100,
        toJSON: () => ({}),
      } as DOMRect;
      
      useHUDStore.getState().updateCursorPosition(mockRect);
      
      const state = useHUDStore.getState();
      expect(state.cursorPosition).toEqual({
        top: 100,
        bottom: 150,
        left: 200,
        right: 400,
        centerX: 300,
        centerY: 125,
      });
    });

    it('updateCursorPosition handles null', () => {
      useHUDStore.getState().updateCursorPosition(null);
      expect(useHUDStore.getState().cursorPosition).toBe(null);
    });
  });
});
