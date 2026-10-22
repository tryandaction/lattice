/**
 * Shared Library input/response validators.
 *
 * These validators are pure and deterministic; they never touch React state,
 * the filesystem, or the network. They throw `SharedLibraryError` with stable
 * codes so the transport, repository, and sync layers can rely on one error
 * contract.
 */

import {
  ANNOTATION_LOCATOR_TYPES,
  isAnnotationLocatorType,
  isItemKind,
  isLibraryRole,
  type ItemKind,
  type LibraryRole,
  type SharedAnnotationTarget,
  type SharedLocatorValue,
} from "./domain";
import { SharedLibraryError } from "./errors";

const FORBIDDEN_TARGET_KEYS = new Set([
  "viewportX",
  "viewportY",
  "viewportWidth",
  "viewportHeight",
  "clientX",
  "clientY",
  "offsetX",
  "offsetY",
  "screenX",
  "screenY",
  "pageX",
  "pageY",
  "pixelX",
  "pixelY",
  "cssX",
  "cssY",
  "domRect",
  "boundingClientRect",
  "rect",
]);

const LOCATOR_FIELDS = [
  "page",
  "heading",
  "line",
  "cell",
  "paragraph",
  "slide",
  "rects",
  "path",
  "offset",
  "quote",
] as const;

function isLocatorValue(value: unknown): value is SharedLocatorValue {
  if (typeof value === "string") {
    return true;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return true;
  }
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

/**
 * Validates and normalizes a shared annotation target.
 *
 * Rejects any target that smuggles viewport/CSS-pixel or DOMRect coordinates;
 * PDF targets must carry a positive integer `page` (either inside `locator`
 * or as a top-level field).
 */
export function parseAnnotationTarget(value: unknown): SharedAnnotationTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SharedLibraryError({
      code: "ANNOTATION_TARGET_INVALID",
      message: "Annotation target must be an object with a locatorType and locator",
    });
  }

  const input = value as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (FORBIDDEN_TARGET_KEYS.has(key)) {
      throw new SharedLibraryError({
        code: "ANNOTATION_TARGET_INVALID",
        message:
          "Annotation target must use normalized page-local coordinates, not viewport or CSS pixels",
      });
    }
  }

  const locatorType = input.locatorType;
  if (!isAnnotationLocatorType(locatorType)) {
    throw new SharedLibraryError({
      code: "ANNOTATION_TARGET_INVALID",
      message: `Annotation target locatorType must be one of: ${ANNOTATION_LOCATOR_TYPES.join(", ")}`,
    });
  }

  const locator: Record<string, SharedLocatorValue> = {};
  const providedLocator = input.locator;
  if (providedLocator !== undefined && providedLocator !== null) {
    if (typeof providedLocator !== "object" || Array.isArray(providedLocator)) {
      throw new SharedLibraryError({
        code: "ANNOTATION_TARGET_INVALID",
        message: "Annotation target locator must be an object",
      });
    }
    for (const [key, entry] of Object.entries(providedLocator as Record<string, unknown>)) {
      if (isLocatorValue(entry)) {
        locator[key] = entry;
      }
    }
  }

  for (const field of LOCATOR_FIELDS) {
    if (!(field in input)) {
      continue;
    }
    const fieldValue = input[field];
    if (isLocatorValue(fieldValue) && !(field in locator)) {
      locator[field] = fieldValue;
    }
  }

  if (locatorType === "pdf-page") {
    const page = locator.page;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1) {
      throw new SharedLibraryError({
        code: "ANNOTATION_TARGET_INVALID",
        message: "pdf-page annotation target requires a positive integer page",
      });
    }
  }

  return { locatorType, locator };
}

export function parseIdempotencyKey(
  value: string,
): { deviceId: string; clientSequence: number } {
  if (typeof value !== "string") {
    throw new SharedLibraryError({
      code: "INVALID_INPUT",
      message: "Idempotency key must be a string",
    });
  }

  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) {
    throw new SharedLibraryError({
      code: "INVALID_INPUT",
      message: "Idempotency key must follow the format <deviceId>:<clientSequence>",
    });
  }

  const deviceId = value.slice(0, separatorIndex);
  const sequenceText = value.slice(separatorIndex + 1);
  if (!/^\d+$/.test(sequenceText)) {
    throw new SharedLibraryError({
      code: "INVALID_INPUT",
      message: "Idempotency key client sequence must be a non-negative integer",
    });
  }

  return { deviceId, clientSequence: Number(sequenceText) };
}

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

export function parseLibraryRole(value: unknown): LibraryRole {
  if (!isLibraryRole(value)) {
    throw new SharedLibraryError({
      code: "VALIDATION_FAILED",
      message: `Invalid library role: ${String(value)}`,
    });
  }
  return value;
}

export function parseItemKind(value: unknown): ItemKind {
  if (!isItemKind(value)) {
    throw new SharedLibraryError({
      code: "VALIDATION_FAILED",
      message: `Invalid item kind: ${String(value)}`,
    });
  }
  return value;
}
