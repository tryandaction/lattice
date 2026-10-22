/**
 * Web snapshot state machine for URL-only shared-library items.
 *
 * A URL item starts `url-only` and is independently promoted through the
 * snapshot pipeline. The pipeline is deliberately safe: SSRF targets (private
 * IPs, loopback, link-local, internal names), dangerous protocols and active
 * HTML are all blocked, and a failed snapshot never destroys the URL-only
 * item — the URL remains readable while the richer snapshot is retried.
 */

export type WebItemSnapshotState =
  | "url-only"
  | "snapshot-pending"
  | "snapshot-ready"
  | "snapshot-failed";

export interface WebItemSnapshot {
  state: WebItemSnapshotState;
  url: string;
  capturedAt?: string;
  snapshotKey?: string;
  title?: string;
  errorReason?: string;
}

export interface SnapshotUrlValidation {
  allowed: boolean;
  reason?: string;
  normalizedUrl?: string;
}

const ALLOWED_SNAPSHOT_PROTOCOLS = new Set(["http:", "https:"]);

export function isDangerousProtocol(protocol: string): boolean {
  return !ALLOWED_SNAPSHOT_PROTOCOLS.has(String(protocol).toLowerCase());
}

export function isPrivateOrLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) {
    return true;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
    return true;
  }
  if (
    host === "::" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:0" ||
    host === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 10 || a === 127) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 100 && b >= 64 && b <= 127) {
      return true;
    }
  }

  return false;
}

export function validateSnapshotUrl(rawUrl: string): SnapshotUrlValidation {
  if (!rawUrl || !rawUrl.trim()) {
    return { allowed: false, reason: "empty-url" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "invalid-url" };
  }

  if (isDangerousProtocol(parsed.protocol)) {
    return { allowed: false, reason: `blocked-protocol:${parsed.protocol}` };
  }
  if (isPrivateOrLoopbackHostname(parsed.hostname)) {
    return { allowed: false, reason: "blocked-private-host" };
  }

  return { allowed: true, normalizedUrl: parsed.toString() };
}

/**
 * Strips active content (scripts, styles, iframes, event handlers,
 * `javascript:` URLs) from a captured page while preserving readable text and
 * structure.
 */
export function sanitizeSnapshotHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<base[^>]*>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    .replace(/\s(href|src|action)\s*=\s*(["']?)\s*javascript:[^"'\s>]*/gi, "")
    .replace(/javascript:/gi, "");
}

export type WebItemSnapshotEvent =
  | { type: "capture-start" }
  | { type: "capture-succeeded"; snapshotKey: string; capturedAt?: string; title?: string }
  | { type: "capture-failed"; reason: string };

export function transitionWebItemSnapshot(
  snapshot: WebItemSnapshot,
  event: WebItemSnapshotEvent,
): WebItemSnapshot {
  switch (event.type) {
    case "capture-start":
      if (snapshot.state === "snapshot-ready") {
        return snapshot;
      }
      return { ...snapshot, state: "snapshot-pending", errorReason: undefined };
    case "capture-succeeded":
      return {
        ...snapshot,
        state: "snapshot-ready",
        snapshotKey: event.snapshotKey,
        capturedAt: event.capturedAt ?? new Date().toISOString(),
        title: event.title ?? snapshot.title,
        errorReason: undefined,
      };
    case "capture-failed":
      return { ...snapshot, state: "snapshot-failed", errorReason: event.reason };
  }
}

/**
 * A URL-only item must survive a failed snapshot attempt — this reconstructs
 * the URL-only state for the item after `snapshot-failed`.
 */
export function keepUrlOnlyItemOnSnapshotFailure(input: {
  url: string;
  errorReason?: string;
}): WebItemSnapshot {
  return { state: "url-only", url: input.url, errorReason: input.errorReason };
}
