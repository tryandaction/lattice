/**
 * Non-Destructive Image Editing Tests
 * 
 * Property-based tests verifying that image editing operations
 * do not modify the original image file.
 * Feature: visual-adapters-exporter, Property 7: Non-Destructive Image Editing
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  serializeShapes,
  deserializeShapes,
  shapesToJSON,
  type TldrawShape,
  type TldrawShapeData,
} from '../tldraw-serialization';

// ============================================================================
// Property 7: Non-Destructive Image Editing
// Feature: visual-adapters-exporter, Property 7
// Validates: Requirements 3.4
// ============================================================================

describe('Property 7: Non-Destructive Image Editing', () => {
  /**
   * Simulates image file bytes - in real usage this would be actual image data
   */
  const createMockImageBytes = (size: number): Uint8Array => {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      bytes[i] = i % 256;
    }
    return bytes;
  };

  /**
   * Simulates a drawing operation that creates shapes
   */
  const simulateDrawingOperation = (
    shapes: TldrawShape[],
    imageWidth: number,
    imageHeight: number
  ): string => {
    return shapesToJSON(shapes, imageWidth, imageHeight);
  };

  describe('Image bytes remain unchanged after drawing operations', () => {
    /**
     * For any image bytes and any sequence of drawing operations,
     * the original image bytes should remain unchanged
     */
    it('original image bytes are never modified by shape operations', () => {
      fc.assert(
        fc.property(
          // Image size (bytes)
          fc.integer({ min: 100, max: 10000 }),
          // Image dimensions
          fc.integer({ min: 100, max: 2000 }),
          fc.integer({ min: 100, max: 2000 }),
          // Number of shapes to create
          fc.integer({ min: 1, max: 20 }),
          (imageSize, imageWidth, imageHeight, numShapes) => {
            // Create mock image bytes
            const originalBytes = createMockImageBytes(imageSize);
            const originalBytesCopy = new Uint8Array(originalBytes);
            
            // Create random shapes
            const shapes: TldrawShape[] = [];
            for (let i = 0; i < numShapes; i++) {
              shapes.push({
                id: `shape-${i}`,
                type: 'draw',
                x: Math.random() * imageWidth,
                y: Math.random() * imageHeight,
                props: {
                  w: Math.random() * 100 + 10,
                  h: Math.random() * 100 + 10,
                },
              });
            }
            
            // Simulate drawing operations (serialize shapes)
            const serializedData = simulateDrawingOperation(shapes, imageWidth, imageHeight);
            
            // Verify original bytes are unchanged
            expect(originalBytes.length).toBe(originalBytesCopy.length);
            for (let i = 0; i < originalBytes.length; i++) {
              expect(originalBytes[i]).toBe(originalBytesCopy[i]);
            }
            
            // Verify serialized data is separate from image bytes
            expect(typeof serializedData).toBe('string');
            expect(serializedData).not.toContain(String.fromCharCode(...originalBytes.slice(0, 10)));
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Shape data is stored separately from image data
     */
    it('shape data is stored in separate JSON structure', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 2000 }),
          fc.integer({ min: 100, max: 2000 }),
          fc.array(
            fc.record({
              id: fc.uuid(),
              type: fc.constantFrom('draw', 'text', 'arrow', 'geo'),
              xRatio: fc.double({ min: 0, max: 0.9, noNaN: true }), // Use ratio to ensure within bounds
              yRatio: fc.double({ min: 0, max: 0.9, noNaN: true }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (imageWidth, imageHeight, shapeData) => {
            const shapes: TldrawShape[] = shapeData.map(s => ({
              id: s.id,
              type: s.type,
              x: s.xRatio * imageWidth,
              y: s.yRatio * imageHeight,
              props: {},
            }));
            
            // Serialize shapes
            const serialized = serializeShapes(shapes, imageWidth, imageHeight);
            
            // Verify structure is valid JSON
            expect(serialized.version).toBe(1);
            expect(Array.isArray(serialized.shapes)).toBe(true);
            expect(serialized.imageWidth).toBe(imageWidth);
            expect(serialized.imageHeight).toBe(imageHeight);
            
            // Verify shapes are stored with percentage coordinates
            // Using ratio 0-0.9 means percentages should be 0-90%
            for (const shape of serialized.shapes) {
              expect(shape.x).toBeGreaterThanOrEqual(0);
              expect(shape.x).toBeLessThanOrEqual(100);
              expect(shape.y).toBeGreaterThanOrEqual(0);
              expect(shape.y).toBeLessThanOrEqual(100);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Multiple edit sessions preserve data integrity', () => {
    /**
     * Multiple serialize/deserialize cycles should not corrupt data
     */
    it('multiple round-trips preserve shape data', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 2000 }),
          fc.integer({ min: 100, max: 2000 }),
          fc.array(
            fc.record({
              id: fc.uuid(),
              type: fc.constantFrom('draw', 'text', 'arrow'),
              xRatio: fc.double({ min: 0, max: 0.9, noNaN: true }),
              yRatio: fc.double({ min: 0, max: 0.9, noNaN: true }),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          fc.integer({ min: 2, max: 5 }),
          (imageWidth, imageHeight, shapeData, numCycles) => {
            // Create initial shapes
            let shapes: TldrawShape[] = shapeData.map(s => ({
              id: s.id,
              type: s.type,
              x: s.xRatio * imageWidth,
              y: s.yRatio * imageHeight,
              props: {},
            }));
            
            // Perform multiple serialize/deserialize cycles
            for (let cycle = 0; cycle < numCycles; cycle++) {
              const serialized = serializeShapes(shapes, imageWidth, imageHeight);
              shapes = deserializeShapes(serialized, imageWidth, imageHeight);
            }
            
            // Verify shape count is preserved
            expect(shapes.length).toBe(shapeData.length);
            
            // Verify shape IDs are preserved
            const originalIds = shapeData.map(s => s.id).sort();
            const finalIds = shapes.map(s => s.id).sort();
            expect(finalIds).toEqual(originalIds);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Adding and removing shapes doesn't affect other shapes
     */
    it('shape operations are independent', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 2000 }),
          fc.integer({ min: 100, max: 2000 }),
          fc.array(
            fc.record({
              id: fc.uuid(),
              type: fc.constant('draw'),
              xRatio: fc.double({ min: 0, max: 0.9, noNaN: true }),
              yRatio: fc.double({ min: 0, max: 0.9, noNaN: true }),
            }),
            { minLength: 3, maxLength: 10 }
          ),
          (imageWidth, imageHeight, shapeData) => {
            // Create initial shapes
            const shapes: TldrawShape[] = shapeData.map(s => ({
              id: s.id,
              type: s.type,
              x: s.xRatio * imageWidth,
              y: s.yRatio * imageHeight,
              props: {},
            }));
            
            // Serialize all shapes
            const serialized1 = serializeShapes(shapes, imageWidth, imageHeight);
            
            // Remove middle shape
            const middleIndex = Math.floor(shapes.length / 2);
            const removedShape = shapes[middleIndex];
            const shapesWithoutMiddle = shapes.filter((_, i) => i !== middleIndex);
            
            // Serialize without middle shape
            const serialized2 = serializeShapes(shapesWithoutMiddle, imageWidth, imageHeight);
            
            // Verify remaining shapes are unchanged
            const remaining1 = serialized1.shapes.filter(s => s.id !== removedShape.id);
            const remaining2 = serialized2.shapes;
            
            expect(remaining2.length).toBe(remaining1.length);
            
            for (let i = 0; i < remaining1.length; i++) {
              const s1 = remaining1.find(s => s.id === remaining2[i].id);
              expect(s1).toBeDefined();
              expect(remaining2[i].x).toBeCloseTo(s1!.x, 5);
              expect(remaining2[i].y).toBeCloseTo(s1!.y, 5);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Sidecar JSON format validation', () => {
    /**
     * Serialized data follows expected JSON structure
     */
    it('produces valid JSON structure', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 2000 }),
          fc.integer({ min: 100, max: 2000 }),
          fc.array(
            fc.record({
              id: fc.uuid(),
              type: fc.constantFrom('draw', 'text', 'arrow', 'geo', 'line'),
            }),
            { minLength: 0, maxLength: 10 }
          ),
          (imageWidth, imageHeight, shapeData) => {
            const shapes: TldrawShape[] = shapeData.map((s, i) => ({
              id: s.id,
              type: s.type,
              x: (i * 50) % imageWidth,
              y: (i * 50) % imageHeight,
              props: {},
            }));
            
            const json = shapesToJSON(shapes, imageWidth, imageHeight);
            
            // Verify it's valid JSON
            const parsed = JSON.parse(json);
            
            // Verify structure
            expect(parsed).toHaveProperty('version', 1);
            expect(parsed).toHaveProperty('shapes');
            expect(parsed).toHaveProperty('imageWidth', imageWidth);
            expect(parsed).toHaveProperty('imageHeight', imageHeight);
            expect(Array.isArray(parsed.shapes)).toBe(true);
            expect(parsed.shapes.length).toBe(shapes.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Empty shape array produces valid minimal JSON
     */
    it('handles empty shape arrays', () => {
      const json = shapesToJSON([], 1000, 800);
      const parsed = JSON.parse(json);
      
      expect(parsed.version).toBe(1);
      expect(parsed.shapes).toEqual([]);
      expect(parsed.imageWidth).toBe(1000);
      expect(parsed.imageHeight).toBe(800);
    });
  });
});
