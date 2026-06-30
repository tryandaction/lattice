import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigateLinkWithFeedback } from "../navigate-link-with-feedback";

const navigateLinkMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("../navigate-link", () => ({
  navigateLink: navigateLinkMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

describe("navigateLinkWithFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true without toast when navigation succeeds", async () => {
    navigateLinkMock.mockResolvedValueOnce(true);

    await expect(navigateLinkWithFeedback("notes/demo.md")).resolves.toBe(true);

    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("shows a toast when navigation cannot resolve the target", async () => {
    navigateLinkMock.mockResolvedValueOnce(false);

    await expect(navigateLinkWithFeedback("missing.md")).resolves.toBe(false);

    expect(toastErrorMock).toHaveBeenCalledWith(
      "无法打开链接",
      expect.objectContaining({
        description: expect.stringContaining("missing.md"),
      }),
    );
  });

  it("shows a toast when navigation throws", async () => {
    navigateLinkMock.mockRejectedValueOnce(new Error("boom"));

    await expect(navigateLinkWithFeedback("bad.md")).resolves.toBe(false);

    expect(toastErrorMock).toHaveBeenCalledWith(
      "无法打开链接",
      expect.objectContaining({
        description: expect.stringContaining("bad.md"),
      }),
    );
  });
});
