/**
 * Tldraw Serialization Tests
 * 
 * Property-based tests for Tldraw store serialization round-trips.
 * Feature: visual-adapters-exporter, Property 3: Tldraw Store Serialization Round-Trip
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  serializeShapes,
  deserializeShapes,
  shapeToPercentage,
  shapeToAbsolute,
  shapesToJSON,
  jsonToShapes,
  isValidTldrawShapeData,
  isValidSerializedShape,
  calculateShapesBoundingBox,
  type TldrawShape,
  type SerializedShape,
  type TldrawShapeData,
} from '../tldraw-serialization';

// ============================================================================
// Arbitrary Generators
// ============================================================================

const shapeTypeArb = fc.constantFrom('draw', 'text', 'arrow', 'geo', 'line', 'note');

const shapePropsArb = fc.record({
  w: fc.option(fc.double({ min: 10, max: 500, noNaN: true }), { nil: undefined }),
  h: fc.option(fc.double({ min: 10, max: 500, noNaN: true }), { nil: undefined }),
  color: fc.option(fc.constantFrom('black', 'red', 'blue', 'green'), { nil: undefined }),
  size: fc.option(fc.constantFrom('s', 'm', 'l', 'xl'), { nil: undefined }),
});

const tldrawShapeArb = (maxX: number, maxY: number): fc.Arbitrary<TldrawShape> => 
  fc.record({
    id: fc.uuid(),
    type: shapeTypeArb,
    x: fc.double({ min: 0, max: maxX, noNaN: true }),
    y: fc.double({ min: 0, max: maxY, noNaN: true }),
    props: shapePropsArb,
    rotation: fc.option(fc.double({ min: 0, max: 360, noNaN: true }), { nil: undefined }),
    isLocked: fc.option(fc.boolean(), { nil: undefined }),
    opacity: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  });

const imageDimensionsArb = fc.record({
  width: fc.double({ min: 100, max: 4000, noNaN: true }),
  height: fc.double({ min: 100, max: 4000, noNaN: true }),
});

// ============================================================================
// Property 3: Tldraw Store Serialization Round-Trip
// Feature: visual-adapters-exporter, Property 3
// Validates: Requirements 3.5, 3.6
// ============================================================================

describe('Property 3: Tldraw Store Serialization Round-Trip', () => {
  describe('Single Shape Round-Trip', () => {
    /**
     * For any Tldraw shape, converting to percentage and back should
     * preserve position within tolerance
     */
    it('shape -> percentage -> absolute preserves position', () => {
      fc.assert(
        fc.property(
          imageDimensionsArb,
          fc.double({ min: 0, max: 0.9, noNaN: true }),
          fc.double({ min: 0, max: 0.9, noNaN: true }),
          shapeTypeArb,
          fc.uuid(),
          (dims, xRatio, yRatio, type, id) => {
            const originalShape: TldrawShape = {
              id,
              type,
              x: xRatio * dims.width,
              y: yRatio * dims.height,
              props: {},
            };
            
            const serialized = shapeToPercentage(originalShape, dims.width, dims.height);
            const restored = shapeToAbsolute(serialized, dims.width, dims.height);
            
            // Position should be preserved within tolerance
            const tolerance = Math.max(dims.width, dims.height) * 0.0001;
            expect(Math.abs(restored.x - originalShape.x)).toBeLessThan(tolerance);
            expect(Math.abs(restored.y - originalShape.y)).toBeLessThan(tolerance);
            
            // Other properties should be identical
            expect(restored.id).toBe(originalShape.id);
            expect(restored.type).toBe(originalShape.type);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Serialized shapes should have percentage coordinates in valid range
     */
    it('serialized shapes have valid percentage coordinates', () => {
      fc.assert(
        fc.property(
          imageDimensionsArb,
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (dims, xRatio, yRatio) => {
            const shape: TldrawShape = {
              id: 'test',
              type: 'draw',
              x: xRatio * dims.width,
              y: yRatio * dims.height,
              props: {},
            };
            
            const serialized = shapeToPercentage(shape, dims.width, dims.height);
            
            expect(serialized.x).toBeGreaterThanOrEqual(0);
            expect(serialized.x).toBeLessThanOrEqual(100);
            expect(serialized.y).toBeGreaterThanOrEqual(0);
            expect(serialized.y).toBeLessThanOrEqual(100);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Multiple Shapes Round-Trip', () => {
    /**
     * For any array of shapes, serializing and deserializing should
     * preserve all shapes with their positions
     */
    it('serialize -> deserialize preserves all shapes', () => {
      fc.assert(
        fc.property(
          imageDimensionsArb,
          fc.array(
            fc.tuple(
              fc.double({ min: 0, max: 0.9, noNaN: true }),
              fc.double({ min: 0, max: 0.9, noNaN: true }),
              shapeTypeArb,
              fc.uuid()
            ),
            { minLength: 1, maxLength: 10 }
          ),
          (dims, shapeData) => {
            const originalShapes: TldrawShape[] = shapeData.map(([xRatio, yRatio, type, id]) => ({
              id,
              type,
              x: xRatio * dims.width,
              y: yRatio * dims.height,
              props: {},
            }));
            
            const serialized = serializeShapes(originalShapes, dims.width, dims.height);
            const restored = deserializeShapes(serialized, dims.width, dims.height);
            
            // Same number of shapes
            expect(restored.length).toBe(originalShapes.length);
            
            // Each shape preserved
            const tolerance = Math.max(dims.width, dims.height) * 0.0001;
            for (let i = 0; i < originalShapes.length; i++) {
              expect(restored[i].id).toBe(originalShapes[i].id);
              expect(restored[i].type).toBe(originalShapes[i].type);
              expect(Math.abs(restored[i].x - originalShapes[i].x)).toBeLessThan(tolerance);
              expect(Math.abs(restored[i].y - originalShapes[i].y)).toBeLessThan(tolerance);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Serialization preserves shape order
     */
    it('preserves shape order', () => {
      fc.assert(
        fc.property(
          imageDimensionsArb,
          fc.array(fc.uuid(), { minLength: 2, maxLength: 10 }),
          (dims, ids) => {
            const shapes: TldrawShape[] = ids.map((id, i) => ({
              id,
              type: 'draw',
              x: i * 10,
              y: i * 10,
              props: {},
            }));
            
            const serialized = serializeShapes(shapes, dims.width, dims.height);
            const restored = deserializeShapes(serialized, dims.width, dims.height);
            
            for (let i = 0; i < ids.length; i++) {
              expect(restored[i].id).toBe(ids[i]);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('JSON Round-Trip', () => {
    /**
     * JSON serialization and parsing should preserve all data
     */
    it('shapesToJSON -> jsonToShapes preserves shapes', () => {
      fc.assert(
        fc.property(
          imageDimensionsArb,
          fc.array(
            fc.tuple(
              fc.double({ min: 0, max: 0.9, noNaN: true }),
              fc.double({ min: 0, max: 0.9, noNaN: true }),
              shapeTypeArb,
              fc.uuid()
            ),
            { minLength: 0, maxLength: 5 }
          ),
          (dims, shapeData) => {
            const originalShapes: TldrawShape[] = shapeData.map(([xRatio, yRatio, type, id]) => ({
              id,
              type,
              x: xRatio * dims.width,
              y: yRatio * dims.height,
              props: {},
            }));
            
            const json = shapesToJSON(originalShapes, dims.width, dims.height);
            const restored = jsonToShapes(json, dims.width, dims.height);
            
            expect(restored).not.toBeNull();
            expect(restored!.length).toBe(originalShapes.length);
            
            const tolerance = Math.max(dims.width, dims.height) * 0.0001;
            for (let i = 0; i < originalShapes.length; i++) {
              expect(restored![i].id).toBe(originalShapes[i].id);
              expect(Math.abs(restored![i].x - originalShapes[i].x)).toBeLessThan(tolerance);
              expect(Math.abs(restored![i].y - originalShapes[i].y)).toBeLessThan(tolerance);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Invalid JSON returns null
     */
    it('returns null for invalid JSON', () => {
      expect(jsonToShapes('not json', 100, 100)).toBeNull();
      expect(jsonToShapes('{}', 100, 100)).toBeNull();
      expect(jsonToShapes('{"version": 2}', 100, 100)).toBeNull();
    });
  });

  describe('Dimension Properties', () => {
    /**
     * Width and height in props should also be converted
     */
    it('converts width/height props to percentages', () => {
      const shape: TldrawShape = {
        id: 'test',
        type: 'geo',
        x: 100,
        y: 100,
        props: { w: 200, h: 150 },
      };
      
      const serialized = shapeToPercentage(shape, 1000, 1000);
      
      expect(serialized.props.w).toBe(20); // 200/1000 * 100
      expect(serialized.props.h).toBe(15); // 150/1000 * 100
    });

    it('converts percentage props back to absolute', () => {
      const serialized: SerializedShape = {
        id: 'test',
        type: 'geo',
        x: 10,
        y: 10,
        props: { w: 20, h: 15 },
      };
      
      const restored = shapeToAbsolute(serialized, 1000, 1000);
      
      expect(restored.props.w).toBe(200);
      expect(restored.props.h).toBe(150);
    });

    it('dimension props round-trip correctly', () => {
      fc.assert(
        fc.property(
          imageDimensionsArb,
          fc.double({ min: 10, max: 500, noNaN: true }),
          fc.double({ min: 10, max: 500, noNaN: true }),
          (dims, w, h) => {
            const shape: TldrawShape = {
              id: 'test',
              type: 'geo',
              x: 100,
              y: 100,
              props: { w, h },
            };
            
            const serialized = shapeToPercentage(shape, dims.width, dims.height);
            const restored = shapeToAbsolute(serialized, dims.width, dims.height);
            
            const tolerance = Math.max(dims.width, dims.height) * 0.0001;
            expect(Math.abs((restored.props.w as number) - w)).toBeLessThan(tolerance);
            expect(Math.abs((restored.props.h as number) - h)).toBeLessThan(tolerance);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Optional Properties', () => {
    /**
     * Optional properties should be preserved
     */
    it('preserves rotation, isLocked, and opacity', () => {
      fc.assert(
        fc.property(
          imageDimensionsArb,
          fc.double({ min: 0, max: 360, noNaN: true }),
          fc.boolean(),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (dims, rotation, isLocked, opacity) => {
            const shape: TldrawShape = {
              id: 'test',
              type: 'draw',
              x: 100,
              y: 100,
              props: {},
              rotation,
              isLocked,
              opacity,
            };
            
            const serialized = shapeToPercentage(shape, dims.width, dims.height);
            const restored = shapeToAbsolute(serialized, dims.width, dims.height);
            
            expect(restored.rotation).toBe(rotation);
            expect(restored.isLocked).toBe(isLocked);
            expect(restored.opacity).toBe(opacity);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe('Validation Functions', () => {
  describe('isValidTldrawShapeData', () => {
    it('accepts valid data', () => {
      const validData: TldrawShapeData = {
        version: 1,
        shapes: [
          { id: 'test', type: 'draw', x: 50, y: 50, props: {} },
        ],
        imageWidth: 1000,
        imageHeight: 800,
      };
      
      expect(isValidTldrawShapeData(validData)).toBe(true);
    });

    it('rejects invalid version', () => {
      expect(isValidTldrawShapeData({ version: 2, shapes: [], imageWidth: 100, imageHeight: 100 })).toBe(false);
    });

    it('rejects missing fields', () => {
      expect(isValidTldrawShapeData({})).toBe(false);
      expect(isValidTldrawShapeData({ version: 1 })).toBe(false);
      expect(isValidTldrawShapeData({ version: 1, shapes: [] })).toBe(false);
    });

    it('rejects invalid dimensions', () => {
      expect(isValidTldrawShapeData({ version: 1, shapes: [], imageWidth: 0, imageHeight: 100 })).toBe(false);
      expect(isValidTldrawShapeData({ version: 1, shapes: [], imageWidth: 100, imageHeight: -1 })).toBe(false);
    });
  });

  describe('isValidSerializedShape', () => {
    it('accepts valid shapes', () => {
      expect(isValidSerializedShape({ id: 'test', type: 'draw', x: 50, y: 50, props: {} })).toBe(true);
    });

    it('rejects out-of-range coordinates', () => {
      expect(isValidSerializedShape({ id: 'test', type: 'draw', x: -1, y: 50, props: {} })).toBe(false);
      expect(isValidSerializedShape({ id: 'test', type: 'draw', x: 101, y: 50, props: {} })).toBe(false);
    });

    it('rejects missing fields', () => {
      expect(isValidSerializedShape({ id: 'test', type: 'draw', x: 50 })).toBe(false);
      expect(isValidSerializedShape({ type: 'draw', x: 50, y: 50, props: {} })).toBe(false);
    });
  });
});

// ============================================================================
// Bounding Box Tests
// ============================================================================

describe('calculateShapesBoundingBox', () => {
  it('returns null for empty array', () => {
    expect(calculateShapesBoundingBox([])).toBeNull();
  });

  it('calculates correct bounding box for single shape', () => {
    const shapes: SerializedShape[] = [
      { id: 'test', type: 'geo', x: 10, y: 20, props: { w: 30, h: 40 } },
    ];
    
    const bbox = calculateShapesBoundingBox(shapes);
    
    expect(bbox).not.toBeNull();
    expect(bbox!.x).toBe(10);
    expect(bbox!.y).toBe(20);
    expect(bbox!.width).toBe(30);
    expect(bbox!.height).toBe(40);
  });

  it('calculates correct bounding box for multiple shapes', () => {
    const shapes: SerializedShape[] = [
      { id: '1', type: 'geo', x: 10, y: 10, props: { w: 20, h: 20 } },
      { id: '2', type: 'geo', x: 50, y: 50, props: { w: 30, h: 30 } },
    ];
    
    const bbox = calculateShapesBoundingBox(shapes);
    
    expect(bbox).not.toBeNull();
    expect(bbox!.x).toBe(10);
    expect(bbox!.y).toBe(10);
    expect(bbox!.width).toBe(70); // 50 + 30 - 10
    expect(bbox!.height).toBe(70); // 50 + 30 - 10
  });
});
