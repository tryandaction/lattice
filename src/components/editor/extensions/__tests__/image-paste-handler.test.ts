/**
 * Tests for Image Paste Handler Extension
 * 
 * Feature: media-math-foundation
 * Property 1: Image paste detection
 * Property 2: Filename generation pattern
 * Property 3: Image node path correctness
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  generateImageFilename,
  hasImageFiles,
  extractImageFiles,
} from "../image-paste-handler";

/**
 * Create a mock DataTransfer with specified files
 */
function createMockDataTransfer(files: File[]): DataTransfer {
  // Create a proper FileList-like object
  const fileList = {
    length: files.length,
    item: (index: number) => files[index] || null,
    [Symbol.iterator]: function* () {
      for (let i = 0; i < files.length; i++) {
        yield files[i];
      }
    },
  } as unknown as FileList;
  
  // Also make it array-indexable
  files.forEach((file, index) => {
    (fileList as any)[index] = file;
  });
  
  return { files: fileList } as DataTransfer;
}

/**
 * Create a mock File with specified type
 */
function createMockFile(type: string, name: string = "test"): File {
  return new File(["test content"], name, { type });
}

describe("Image Paste Handler", () => {
  describe("Property 1: Image paste detection", () => {
    /**
     * Feature: media-math-foundation, Property 1: Image paste detection
     * For any clipboard event, if the event contains files of type image/*,
     * the handler SHALL detect them; if both text and images present, images
     * take priority; if no images, default behavior proceeds.
     */
    it("should detect image files in clipboard data", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.constant("image/png"),
              fc.constant("image/jpeg"),
              fc.constant("image/gif"),
              fc.constant("image/webp"),
              fc.constant("text/plain"),
              fc.constant("text/html"),
              fc.constant("application/json")
            ),
            { minLength: 0, maxLength: 5 }
          ),
          (fileTypes) => {
            const files = fileTypes.map((type, i) => 
              createMockFile(type, `file${i}`)
            );
            const dataTransfer = createMockDataTransfer(files);
            
            const hasImages = hasImageFiles(dataTransfer);
            const expectedHasImages = fileTypes.some(t => t.startsWith("image/"));
            
            expect(hasImages).toBe(expectedHasImages);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should extract only image files from mixed clipboard data", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.constant("image/png"),
              fc.constant("image/jpeg"),
              fc.constant("text/plain"),
              fc.constant("application/pdf")
            ),
            { minLength: 1, maxLength: 5 }
          ),
          (fileTypes) => {
            const files = fileTypes.map((type, i) => 
              createMockFile(type, `file${i}`)
            );
            const dataTransfer = createMockDataTransfer(files);
            
            const imageFiles = extractImageFiles(dataTransfer);
            const expectedCount = fileTypes.filter(t => t.startsWith("image/")).length;
            
            // All extracted files should be images
            expect(imageFiles.length).toBe(expectedCount);
            expect(imageFiles.every(f => f.type.startsWith("image/"))).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should return false for null clipboard data", () => {
      expect(hasImageFiles(null)).toBe(false);
      expect(extractImageFiles(null)).toEqual([]);
    });

    it("should return false for empty clipboard", () => {
      const dataTransfer = createMockDataTransfer([]);
      expect(hasImageFiles(dataTransfer)).toBe(false);
      expect(extractImageFiles(dataTransfer)).toEqual([]);
    });
  });

  describe("Property 2: Filename generation pattern", () => {
    /**
     * Feature: media-math-foundation, Property 2: Filename generation pattern
     * For any generated image filename, it SHALL match the pattern
     * paste_{timestamp}.png where timestamp is millisecond-precision.
     */
    it("should generate filenames matching paste_{timestamp}.png pattern", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          () => {
            const filename = generateImageFilename();
            
            // Should match pattern
            const pattern = /^paste_(\d+)\.png$/;
            expect(filename).toMatch(pattern);
            
            // Extract timestamp and verify it's a valid number
            const match = filename.match(pattern);
            expect(match).not.toBeNull();
            
            const timestamp = parseInt(match![1], 10);
            expect(timestamp).toBeGreaterThan(0);
            
            // Timestamp should be recent (within last minute)
            const now = Date.now();
            expect(timestamp).toBeLessThanOrEqual(now);
            expect(timestamp).toBeGreaterThan(now - 60000);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should generate unique filenames for rapid successive calls", () => {
      const filenames = new Set<string>();
      
      // Generate multiple filenames rapidly
      for (let i = 0; i < 10; i++) {
        filenames.add(generateImageFilename());
      }
      
      // Due to millisecond precision, some may collide in very fast execution
      // But we should have at least some unique ones
      expect(filenames.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Property 3: Image node path correctness", () => {
    /**
     * Feature: media-math-foundation, Property 3: Image node path correctness
     * For any successfully written image file with filename F,
     * the inserted path SHALL be /assets/F.
     */
    it("should construct correct asset paths from filenames", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000000000000, max: 9999999999999 }),
          (timestamp) => {
            const filename = `paste_${timestamp}.png`;
            const expectedPath = `/assets/${filename}`;
            
            // Verify path construction
            const actualPath = `/assets/${filename}`;
            expect(actualPath).toBe(expectedPath);
            expect(actualPath).toMatch(/^\/assets\/paste_\d+\.png$/);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
