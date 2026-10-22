import { describe, expect, it } from "vitest";
import { deriveVisiblePdfPages } from "../pdf-visible-pages";

describe("deriveVisiblePdfPages", () => {
  it("activates pages around the actual scroll viewport even without intersection callbacks", () => {
    const pages = [
      { pageNumber: 1, top: 0, bottom: 1000 },
      { pageNumber: 2, top: 1016, bottom: 2016 },
      { pageNumber: 3, top: 2032, bottom: 3032 },
      { pageNumber: 4, top: 3048, bottom: 4048 },
      { pageNumber: 5, top: 4064, bottom: 5064 },
      { pageNumber: 6, top: 5080, bottom: 6080 },
      { pageNumber: 7, top: 6096, bottom: 7096 },
    ];

    expect(deriveVisiblePdfPages(pages, 6200, 7000, 800)).toEqual(new Set([6, 7]));
  });

  it("falls back to the nearest page when the viewport is between estimated page bounds", () => {
    const pages = [
      { pageNumber: 1, top: 0, bottom: 1000 },
      { pageNumber: 2, top: 1016, bottom: 2016 },
    ];

    expect(deriveVisiblePdfPages(pages, 2500, 3000, 0)).toEqual(new Set([2]));
  });
});
