import { describe, expect, it } from 'vitest';
import { shouldInsertNestedQuantumTemplate } from '../quantum-math-editing';

describe('quantum math editing keyboard policy', () => {
  it('does not consume plain structure keys while filling formula slots', () => {
    expect(shouldInsertNestedQuantumTemplate({
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBe(false);
  });

  it('uses Alt as the explicit nested-structure modifier inside MathLive', () => {
    expect(shouldInsertNestedQuantumTemplate({
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBe(true);
  });

  it('does not intercept system or variant chords inside MathLive', () => {
    expect(shouldInsertNestedQuantumTemplate({
      altKey: true,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    })).toBe(false);
    expect(shouldInsertNestedQuantumTemplate({
      altKey: true,
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
    })).toBe(false);
    expect(shouldInsertNestedQuantumTemplate({
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    })).toBe(false);
  });
});
