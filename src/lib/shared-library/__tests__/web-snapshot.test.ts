import { describe, expect, it } from "vitest";
import {
  isDangerousProtocol,
  keepUrlOnlyItemOnSnapshotFailure,
  sanitizeSnapshotHtml,
  transitionWebItemSnapshot,
  validateSnapshotUrl,
  type WebItemSnapshot,
} from "../web-snapshot";
import {
  advanceSharedLibraryJob,
  isSharedLibraryJobDue,
  upsertSharedLibraryJob,
  type SharedLibraryJob,
} from "../job-state";

describe("validateSnapshotUrl", () => {
  it("allows public https URLs", () => {
    expect(validateSnapshotUrl("https://arxiv.org/abs/2506.15633").allowed).toBe(true);
  });

  it("blocks dangerous protocols", () => {
    expect(validateSnapshotUrl("javascript:alert(1)").allowed).toBe(false);
    expect(validateSnapshotUrl("file:///etc/passwd").allowed).toBe(false);
    expect(validateSnapshotUrl("data:text/html,<b>x</b>").allowed).toBe(false);
    expect(validateSnapshotUrl("vbscript:msgbox(1)").allowed).toBe(false);
  });

  it("blocks private and loopback hosts (SSRF)", () => {
    const blocked = [
      "http://localhost/",
      "http://127.0.0.1/admin",
      "http://10.0.0.1/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://0.0.0.0/",
      "http://[::1]/",
      "http://metadata.google.internal/",
    ];
    for (const url of blocked) {
      expect(validateSnapshotUrl(url).allowed, url).toBe(false);
    }
  });

  it("allows public hostnames and normalizes the URL", () => {
    const result = validateSnapshotUrl("https://example.com/a?b=1");
    expect(result.allowed).toBe(true);
    expect(result.normalizedUrl).toBe("https://example.com/a?b=1");
  });

  it("rejects malformed and empty URLs", () => {
    expect(validateSnapshotUrl("not a url").allowed).toBe(false);
    expect(validateSnapshotUrl("").allowed).toBe(false);
  });
});

describe("isDangerousProtocol", () => {
  it("flags everything except http(s)", () => {
    expect(isDangerousProtocol("ftp:")).toBe(true);
    expect(isDangerousProtocol("HTTP:")).toBe(false);
    expect(isDangerousProtocol("https:")).toBe(false);
  });
});

describe("sanitizeSnapshotHtml", () => {
  it("strips active content from snapshot HTML", () => {
    const dirty = [
      "<html><head>",
      "<script>alert(1)</script>",
      "<style>body{color:red}</style>",
      '<meta name="x" content="y">',
      '<base href="https://evil.example/">',
      "</head><body>",
      '<img src="x" onerror="alert(2)">',
      '<a href="javascript:void(0)">x</a>',
      '<iframe src="https://evil.example"></iframe>',
      '<p onclick="go()">hi</p>ok',
      "</body></html>",
    ].join("");

    const clean = sanitizeSnapshotHtml(dirty);

    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("<style");
    expect(clean).not.toContain("<meta");
    expect(clean).not.toContain("<base");
    expect(clean).toContain("ok");
  });
});

describe("web item snapshot state machine", () => {
  it("moves url-only -> snapshot-pending -> snapshot-ready", () => {
    const urlOnly: WebItemSnapshot = { state: "url-only", url: "https://example.com/" };
    const pending = transitionWebItemSnapshot(urlOnly, { type: "capture-start" });
    expect(pending.state).toBe("snapshot-pending");

    const ready = transitionWebItemSnapshot(pending, {
      type: "capture-succeeded",
      snapshotKey: "k1",
    });
    expect(ready.state).toBe("snapshot-ready");
    expect(ready.snapshotKey).toBe("k1");
    expect(ready.capturedAt).toBeTruthy();
  });

  it("records failures but the URL-only item survives", () => {
    const urlOnly: WebItemSnapshot = { state: "url-only", url: "https://example.com/" };
    const failed = transitionWebItemSnapshot(urlOnly, { type: "capture-failed", reason: "timeout" });
    expect(failed.state).toBe("snapshot-failed");
    expect(failed.errorReason).toBe("timeout");

    const kept = keepUrlOnlyItemOnSnapshotFailure({
      url: "https://example.com/",
      errorReason: "timeout",
    });
    expect(kept.state).toBe("url-only");
    expect(kept.url).toBe("https://example.com/");
    expect(kept.errorReason).toBe("timeout");
  });

  it("does not re-enter capture once ready (idempotent)", () => {
    const ready: WebItemSnapshot = {
      state: "snapshot-ready",
      url: "https://example.com/",
      snapshotKey: "k1",
    };
    const again = transitionWebItemSnapshot(ready, { type: "capture-start" });
    expect(again.state).toBe("snapshot-ready");
    expect(again.snapshotKey).toBe("k1");
  });
});

describe("shared library job state machine", () => {
  function job(overrides: Partial<SharedLibraryJob> = {}): SharedLibraryJob {
    return {
      id: "job-1",
      kind: "snapshot-url",
      targetItemId: "item-1",
      payload: {},
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
      ...overrides,
    };
  }

  it("records reason, attempts and nextRetryAt on failure", () => {
    const failed = advanceSharedLibraryJob(
      job(),
      { type: "fail", reason: "fetch-timeout", nextRetryAt: "2026-08-20T00:01:00.000Z" },
      "2026-08-20T00:00:30.000Z",
    );
    expect(failed.status).toBe("pending");
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe("fetch-timeout");
    expect(failed.nextRetryAt).toBe("2026-08-20T00:01:00.000Z");
  });

  it("marks a job failed once attempts are exhausted", () => {
    const first = advanceSharedLibraryJob(job(), { type: "fail", reason: "r1" });
    const second = advanceSharedLibraryJob(first, { type: "fail", reason: "r2" });
    const third = advanceSharedLibraryJob(second, { type: "fail", reason: "r3" });
    expect(third.status).toBe("failed");
    expect(third.attempts).toBe(3);
  });

  it("is idempotent over succeeded jobs", () => {
    const succeeded = advanceSharedLibraryJob(job(), { type: "succeed", result: { ok: true } });
    const again = advanceSharedLibraryJob(succeeded, { type: "start" });
    expect(again.status).toBe("succeeded");
  });

  it("schedules an automatic retry delay on failure", () => {
    const failed = advanceSharedLibraryJob(
      job(),
      { type: "fail", reason: "boom" },
      "2026-08-20T00:00:00.000Z",
    );
    expect(failed.nextRetryAt).toBeTruthy();
    expect(Date.parse(failed.nextRetryAt ?? "")).toBeGreaterThan(
      Date.parse("2026-08-20T00:00:00.000Z"),
    );
  });

  it("upserts by job id and gates retries by nextRetryAt", () => {
    const first = job();
    const list = upsertSharedLibraryJob(upsertSharedLibraryJob([], first), {
      ...first,
      status: "running",
    });
    expect(list.length).toBe(1);
    expect(list[0].status).toBe("running");

    const due = job();
    const notDue = { ...job(), nextRetryAt: "2026-08-20T01:00:00.000Z" };
    const now = "2026-08-20T00:00:00.000Z";
    expect(isSharedLibraryJobDue(due, now)).toBe(true);
    expect(isSharedLibraryJobDue(notDue, now)).toBe(false);
    expect(isSharedLibraryJobDue({ ...job(), status: "succeeded" }, now)).toBe(false);
  });
});
