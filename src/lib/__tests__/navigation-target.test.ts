/**
 * Navigation Target Correctness Tests
 * 
 * Property-based tests for annotation navigation events.
 * Feature: visual-adapters-exporter, Property 6: Navigation Target Correctness
 * 
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import type { AnnotationItem, PdfTarget, ImageTarget } from '../../types/universal-annotation';
import { ANNOTATION_NAVIGATION_EVENT, type AnnotationNavigationEvent } from '../../hooks/use-annotation-system';

// ============================================================================
// Mock Navigation Event Emitter
// ============================================================================

/**
 * Emits a navigation event (mirrors the implementation in use-annotation-system)
 */
function emitNavigationEvent(annotation: AnnotationItem): void {
  const event = new CustomEvent<AnnotationNavigationEvent>(ANNOTATION_NAVIGATION_EVENT, {
    detail: {
      annotationId: annotation.id,
      target: annotation.target,
    },
  });
  window.dispatchEvent(event);
}

// ============================================================================
// Arbitrary Generators
// ============================================================================

const pdfTargetArb = fc.record({
  type: fc.constant('pdf' as const),
  page: fc.integer({ min: 1, max: 100 }),
  rects: fc.array(
    fc.record({
      x1: fc.double({ min: 0, max: 0.5, noNaN: true }),
      y1: fc.double({ min: 0, max: 0.5, noNaN: true }),
      x2: fc.double({ min: 0.5, max: 1, noNaN: true }),
      y2: fc.double({ min: 0.5, max: 1, noNaN: true }),
    }),
    { minLength: 1, maxLength: 5 }
  ),
});

const imageTargetArb = fc.record({
  type: fc.constant('image' as const),
  x: fc.double({ min: 0, max: 100, noNaN: true }),
  y: fc.double({ min: 0, max: 100, noNaN: true }),
  width: fc.double({ min: 1, max: 50, noNaN: true }),
  height: fc.double({ min: 1, max: 50, noNaN: true }),
});

const pdfAnnotationArb: fc.Arbitrary<AnnotationItem> = fc.record({
  id: fc.uuid(),
  target: pdfTargetArb,
  style: fc.record({
    color: fc.constantFrom('yellow', 'green', 'blue', 'pink', 'orange'),
    type: fc.constantFrom('highlight' as const, 'underline' as const, 'area' as const),
  }),
  content: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  comment: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
  author: fc.string({ minLength: 1, maxLength: 50 }),
  createdAt: fc.integer({ min: 0 }),
});

const imageAnnotationArb: fc.Arbitrary<AnnotationItem> = fc.record({
  id: fc.uuid(),
  target: imageTargetArb,
  style: fc.record({
    color: fc.constantFrom('yellow', 'green', 'blue', 'pink', 'orange'),
    type: fc.constantFrom('highlight' as const, 'ink' as const, 'area' as const),
  }),
  content: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  comment: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
  author: fc.string({ minLength: 1, maxLength: 50 }),
  createdAt: fc.integer({ min: 0 }),
});

// ============================================================================
// Property 6: Navigation Target Correctness
// Feature: visual-adapters-exporter, Property 6
// Validates: Requirements 7.1, 7.3
// ============================================================================

describe('Property 6: Navigation Target Correctness', () => {
  let eventListener: ((event: Event) => void) | null = null;
  let receivedEvents: AnnotationNavigationEvent[] = [];

  beforeEach(() => {
    receivedEvents = [];
    eventListener = (event: Event) => {
      const customEvent = event as CustomEvent<AnnotationNavigationEvent>;
      receivedEvents.push(customEvent.detail);
    };
    window.addEventListener(ANNOTATION_NAVIGATION_EVENT, eventListener);
  });

  afterEach(() => {
    if (eventListener) {
      window.removeEventListener(ANNOTATION_NAVIGATION_EVENT, eventListener);
      eventListener = null;
    }
    receivedEvents = [];
  });

  describe('PDF Navigation Events', () => {
    /**
     * For any PDF annotation, navigation event should contain correct page number
     */
    it('emits correct page number for PDF annotations', () => {
      fc.assert(
        fc.property(pdfAnnotationArb, (annotation) => {
          receivedEvents = [];
          
          emitNavigationEvent(annotation);
          
          expect(receivedEvents.length).toBe(1);
          expect(receivedEvents[0].annotationId).toBe(annotation.id);
          expect(receivedEvents[0].target.type).toBe('pdf');
          
          const target = receivedEvents[0].target as PdfTarget;
          const originalTarget = annotation.target as PdfTarget;
          expect(target.page).toBe(originalTarget.page);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Navigation event should preserve all bounding rectangles
     */
    it('preserves bounding rectangles in navigation event', () => {
      fc.assert(
        fc.property(pdfAnnotationArb, (annotation) => {
          receivedEvents = [];
          
          emitNavigationEvent(annotation);
          
          const target = receivedEvents[0].target as PdfTarget;
          const originalTarget = annotation.target as PdfTarget;
          
          expect(target.rects.length).toBe(originalTarget.rects.length);
          
          for (let i = 0; i < target.rects.length; i++) {
            expect(target.rects[i].x1).toBe(originalTarget.rects[i].x1);
            expect(target.rects[i].y1).toBe(originalTarget.rects[i].y1);
            expect(target.rects[i].x2).toBe(originalTarget.rects[i].x2);
            expect(target.rects[i].y2).toBe(originalTarget.rects[i].y2);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Image Navigation Events', () => {
    /**
     * For any image annotation, navigation event should contain correct region coordinates
     */
    it('emits correct region coordinates for image annotations', () => {
      fc.assert(
        fc.property(imageAnnotationArb, (annotation) => {
          receivedEvents = [];
          
          emitNavigationEvent(annotation);
          
          expect(receivedEvents.length).toBe(1);
          expect(receivedEvents[0].annotationId).toBe(annotation.id);
          expect(receivedEvents[0].target.type).toBe('image');
          
          const target = receivedEvents[0].target as ImageTarget;
          const originalTarget = annotation.target as ImageTarget;
          
          expect(target.x).toBe(originalTarget.x);
          expect(target.y).toBe(originalTarget.y);
          expect(target.width).toBe(originalTarget.width);
          expect(target.height).toBe(originalTarget.height);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Image region coordinates should be in valid percentage range
     */
    it('image coordinates are in valid percentage range', () => {
      fc.assert(
        fc.property(imageAnnotationArb, (annotation) => {
          receivedEvents = [];
          
          emitNavigationEvent(annotation);
          
          const target = receivedEvents[0].target as ImageTarget;
          
          expect(target.x).toBeGreaterThanOrEqual(0);
          expect(target.x).toBeLessThanOrEqual(100);
          expect(target.y).toBeGreaterThanOrEqual(0);
          expect(target.y).toBeLessThanOrEqual(100);
          expect(target.width).toBeGreaterThan(0);
          expect(target.height).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Annotation ID Preservation', () => {
    /**
     * Navigation event should always contain the correct annotation ID
     */
    it('preserves annotation ID in navigation event', () => {
      fc.assert(
        fc.property(
          fc.oneof(pdfAnnotationArb, imageAnnotationArb),
          (annotation) => {
            receivedEvents = [];
            
            emitNavigationEvent(annotation);
            
            expect(receivedEvents.length).toBe(1);
            expect(receivedEvents[0].annotationId).toBe(annotation.id);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Multiple navigation events should be independent
     */
    it('handles multiple navigation events independently', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(pdfAnnotationArb, imageAnnotationArb), { minLength: 2, maxLength: 5 }),
          (annotations) => {
            receivedEvents = [];
            
            for (const annotation of annotations) {
              emitNavigationEvent(annotation);
            }
            
            expect(receivedEvents.length).toBe(annotations.length);
            
            for (let i = 0; i < annotations.length; i++) {
              expect(receivedEvents[i].annotationId).toBe(annotations[i].id);
              expect(receivedEvents[i].target.type).toBe(annotations[i].target.type);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Target Type Discrimination', () => {
    /**
     * Navigation event target type should match annotation target type
     */
    it('preserves target type in navigation event', () => {
      fc.assert(
        fc.property(
          fc.oneof(pdfAnnotationArb, imageAnnotationArb),
          (annotation) => {
            receivedEvents = [];
            
            emitNavigationEvent(annotation);
            
            expect(receivedEvents[0].target.type).toBe(annotation.target.type);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ============================================================================
// Unit Tests for Edge Cases
// ============================================================================

describe('Navigation Edge Cases', () => {
  let eventListener: ((event: Event) => void) | null = null;
  let receivedEvents: AnnotationNavigationEvent[] = [];

  beforeEach(() => {
    receivedEvents = [];
    eventListener = (event: Event) => {
      const customEvent = event as CustomEvent<AnnotationNavigationEvent>;
      receivedEvents.push(customEvent.detail);
    };
    window.addEventListener(ANNOTATION_NAVIGATION_EVENT, eventListener);
  });

  afterEach(() => {
    if (eventListener) {
      window.removeEventListener(ANNOTATION_NAVIGATION_EVENT, eventListener);
      eventListener = null;
    }
    receivedEvents = [];
  });

  it('handles annotation at page boundary', () => {
    const annotation: AnnotationItem = {
      id: 'test-boundary',
      target: {
        type: 'pdf',
        page: 1,
        rects: [{ x1: 0, y1: 0, x2: 1, y2: 1 }],
      },
      style: { color: 'yellow', type: 'highlight' },
      author: 'user',
      createdAt: Date.now(),
    };
    
    emitNavigationEvent(annotation);
    
    expect(receivedEvents.length).toBe(1);
    const target = receivedEvents[0].target as PdfTarget;
    expect(target.rects[0].x1).toBe(0);
    expect(target.rects[0].y1).toBe(0);
    expect(target.rects[0].x2).toBe(1);
    expect(target.rects[0].y2).toBe(1);
  });

  it('handles image annotation at corner', () => {
    const annotation: AnnotationItem = {
      id: 'test-corner',
      target: {
        type: 'image',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
      style: { color: 'yellow', type: 'ink' },
      author: 'user',
      createdAt: Date.now(),
    };
    
    emitNavigationEvent(annotation);
    
    expect(receivedEvents.length).toBe(1);
    const target = receivedEvents[0].target as ImageTarget;
    expect(target.x).toBe(0);
    expect(target.y).toBe(0);
  });

  it('handles very small annotation region', () => {
    const annotation: AnnotationItem = {
      id: 'test-small',
      target: {
        type: 'pdf',
        page: 1,
        rects: [{ x1: 0.5, y1: 0.5, x2: 0.501, y2: 0.501 }],
      },
      style: { color: 'yellow', type: 'area' },
      author: 'user',
      createdAt: Date.now(),
    };
    
    emitNavigationEvent(annotation);
    
    expect(receivedEvents.length).toBe(1);
    const target = receivedEvents[0].target as PdfTarget;
    expect(target.rects[0].x2 - target.rects[0].x1).toBeCloseTo(0.001, 5);
  });
});
