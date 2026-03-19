import { describe, expect, it } from 'vitest';
import { getCollapsedSidebarPercent, getCollapsedSidebarPixelWidth } from '../layout-sidebar';

describe('layout-sidebar', () => {
  it('keeps collapsed sidebar near a fixed pixel width on common desktop sizes', () => {
    expect(getCollapsedSidebarPixelWidth()).toBe(56);
    expect(getCollapsedSidebarPercent(1920)).toBeCloseTo(2.916, 2);
    expect(getCollapsedSidebarPercent(1440)).toBeCloseTo(3.888, 2);
    expect(getCollapsedSidebarPercent(1280)).toBeCloseTo(4.375, 2);
  });

  it('clamps collapsed sidebar percentage for very narrow and invalid widths', () => {
    expect(getCollapsedSidebarPercent(900)).toBe(4.5);
    expect(getCollapsedSidebarPercent(4000)).toBe(2.5);
    expect(getCollapsedSidebarPercent(0)).toBe(4.5);
  });
});
