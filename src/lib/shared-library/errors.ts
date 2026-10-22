/**
 * Shared Library error contract.
 *
 * All failures in the shared-library boundary travel as structured
 * `SharedLibraryError`-shaped objects so the UI can render a code-based
 * summary instead of a raw stack trace. The payload shape matches the API
 * error envelope defined in the shared design (section 13).
 */

export const SHARED_LIBRARY_ERROR_CODES = [
  "INVALID_INPUT",
  "VALIDATION_FAILED",
  "ANNOTATION_TARGET_INVALID",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PERMISSION_DENIED",
  "SYNC_CONFLICT",
  "DUPLICATE_OPERATION",
  "QUOTA_EXCEEDED",
  "UPLOAD_HASH_MISMATCH",
  "UPLOAD_EXPIRED",
  "UPLOAD_INCOMPLETE",
  "UNSUPPORTED_KIND",
  "NOT_IMPLEMENTED",
  "NETWORK_ERROR",
  "DATABASE_ERROR",
  "STORAGE_UNAVAILABLE",
] as const;
export type SharedLibraryErrorCode = (typeof SHARED_LIBRARY_ERROR_CODES)[number];

export function isKnownSharedLibraryErrorCode(value: unknown): value is SharedLibraryErrorCode {
  return (
    typeof value === "string" &&
    (SHARED_LIBRARY_ERROR_CODES as readonly string[]).includes(value)
  );
}

export interface SharedLibraryErrorDetails {
  code: SharedLibraryErrorCode;
  message: string;
  /** Whether the caller may retry the same request. Defaults to false. */
  retryable?: boolean;
  /** Optional entity the error is attached to (e.g. "item"). */
  entityType?: string;
  /** Optional stable entity id. Never a file path. */
  entityId?: string;
  /** Correlating request id returned by the API. */
  requestId?: string;
  /** Optional HTTP-ish status used by transport layers. */
  status?: number;
  /** Original error for diagnostics; never logged verbatim. */
  originalError?: unknown;
}

export class SharedLibraryError extends Error {
  readonly code: SharedLibraryErrorCode;
  readonly retryable: boolean;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly requestId?: string;
  readonly status?: number;
  readonly originalError?: unknown;

  constructor(details: SharedLibraryErrorDetails) {
    super(details.message);
    this.name = "SharedLibraryError";
    this.code = details.code;
    this.retryable = details.retryable ?? false;
    this.entityType = details.entityType;
    this.entityId = details.entityId;
    this.requestId = details.requestId;
    this.status = details.status;
    this.originalError = details.originalError;
  }

  /** Serializes into the API error envelope defined by the shared design. */
  toApiPayload(): {
    error: {
      code: SharedLibraryErrorCode;
      message: string;
      retryable: boolean;
      entityType?: string;
      entityId?: string;
      requestId?: string;
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.entityType ? { entityType: this.entityType } : {}),
        ...(this.entityId ? { entityId: this.entityId } : {}),
        ...(this.requestId ? { requestId: this.requestId } : {}),
      },
    };
  }
}

export function isSharedLibraryError(value: unknown): value is SharedLibraryError {
  return value instanceof SharedLibraryError;
}

/**
 * Coerces any thrown value into a SharedLibraryError so callers always see a
 * structured contract. The original stack is kept for diagnostics but never
 * rendered to the user.
 */
export function asSharedLibraryError(
  error: unknown,
  fallbackCode: SharedLibraryErrorCode = "INVALID_INPUT",
): SharedLibraryError {
  if (isSharedLibraryError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return new SharedLibraryError({
      code: fallbackCode,
      message: error.message,
      retryable: false,
      originalError: error,
    });
  }
  return new SharedLibraryError({
    code: fallbackCode,
    message: String(error),
    retryable: false,
    originalError: error,
  });
}
