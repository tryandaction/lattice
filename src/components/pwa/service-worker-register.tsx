"use client";

/**
 * Service Worker Registration - DISABLED
 *
 * The service worker was causing critical issues with Next.js static export:
 * - "Failed to convert value to 'Response'" errors
 * - Chunk loading failures (ERR_FAILED)
 * - Network errors blocking application startup
 *
 * PWA offline support is not critical for this application.
 * Service worker has been removed to restore functionality.
 */
export function ServiceWorkerRegister() {
  // Service worker registration disabled - see comment above
  return null;
}
