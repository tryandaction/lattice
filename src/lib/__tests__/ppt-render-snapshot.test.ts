/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { createPptSlideSnapshot, measurePptSlideElement } from "../ppt-render-snapshot";

function createSlideElement(): HTMLElement {
  const slide = document.createElement("section");
  slide.style.width = "960px";
  slide.style.height = "540px";

  Object.defineProperty(slide, "offsetWidth", {
    configurable: true,
    value: 960,
  });
  Object.defineProperty(slide, "offsetHeight", {
    configurable: true,
    value: 540,
  });
  Object.defineProperty(slide, "scrollWidth", {
    configurable: true,
    value: 960,
  });
  Object.defineProperty(slide, "scrollHeight", {
    configurable: true,
    value: 540,
  });

  const title = document.createElement("div");
  title.textContent = "General Field Experiment";
  slide.appendChild(title);

  const body = document.createElement("div");
  body.textContent = "Randomization Timeline Planning";
  slide.appendChild(body);

  return slide;
}

describe("ppt-render-snapshot", () => {
  it("captures stable slide metrics from the rendered slide", () => {
    const slide = createSlideElement();

    const metrics = measurePptSlideElement(slide);

    expect(metrics.declaredWidth).toBe(960);
    expect(metrics.declaredHeight).toBe(540);
    expect(metrics.contentWidth).toBe(960);
    expect(metrics.contentHeight).toBe(540);
    expect(metrics.renderedTextContent).toContain("General Field Experiment");
    expect(metrics.renderedTextContent).toContain("Randomization Timeline Planning");
  });

  it("creates a detached snapshot that is not affected by later source mutations", () => {
    const slide = createSlideElement();

    const snapshot = createPptSlideSnapshot(slide);

    slide.textContent = "mutated";

    expect(snapshot.element.textContent).toContain("General Field Experiment");
    expect(snapshot.element.textContent).toContain("Randomization Timeline Planning");
    expect(snapshot.metrics.renderedTextContent).not.toBe("mutated");
  });
});
