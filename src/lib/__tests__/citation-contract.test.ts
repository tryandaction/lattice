import { describe, expect, it } from "vitest";
import { parseLinkTarget } from "@/lib/link-router/parse-link-target";
import type { EvidenceRef } from "@/lib/ai/types";
import {
  buildCitationContract,
  buildCitationContracts,
  canonicalCitationPath,
  classifyStrictAiLink,
  citationNavigationHref,
  dedupeCitationContracts,
  groupCitationContracts,
} from "../ai/citation-contract";

function pdfRef(page: number, quote: string): EvidenceRef {
  return {
    kind: "pdf_page",
    label: "papers/quantum.pdf",
    locator: `papers/quantum.pdf#page=${page}`,
    preview: quote,
    anchor: { page, snippet: quote },
  };
}

describe("citation contract", () => {
  it.each(['notes.txt', 'analysis.py', 'results.csv', 'config.json', 'main.tex'])("binds an exact source quote in %s", (path) => {
    const [ref] = buildCitationContracts([{ kind: 'file', label: path, locator: path, preview: 'Before\nmeasured_field = 58\nAfter' }]);
    expect(classifyStrictAiLink(`citation:${ref.stableId}?quote=measured_field%20%3D%2058`, [ref])).toMatchObject({ kind: 'citation', citation: { navigationTarget: { type: 'workspace_text', path, snippet: 'measured_field = 58' } } });
  });

  it('binds a subquote in a supplied code chunk without reusing its earlier line anchor', () => {
    const [ref] = buildCitationContracts([{ kind: 'code_line', label: 'analysis.py', locator: 'analysis.py#line=40', preview: 'baseline = 1\nmeasured_field = 58', anchor: { lineStart: 40 } }]);
    expect(classifyStrictAiLink(`citation:${ref.stableId}?quote=measured_field%20%3D%2058`, [ref])).toMatchObject({ kind: 'citation', citation: { navigationTarget: { type: 'workspace_text', snippet: 'measured_field = 58' } } });
  });
  it("never borrows the first available quote for a bare file or page link", () => {
    const refs = buildCitationContracts([pdfRef(3, "First unrelated passage"), pdfRef(3, "Second supporting passage")]);
    expect(classifyStrictAiLink("papers/quantum.pdf", refs)).toEqual({ kind: "plain_text" });
    expect(classifyStrictAiLink("papers/quantum.pdf#page=3", refs)).toEqual({ kind: "plain_text" });
  });

  it("does not merge distinct case-sensitive workspace paths", () => {
    const refs = buildCitationContracts(["A.pdf", "a.pdf"].map(name => ({ kind: "pdf_page" as const, label: name, locator: `papers/${name}#page=2`, anchor: { page: 2, snippet: "Same original passage" } })));
    expect(refs).toHaveLength(2);
    expect(refs[0].stableId).not.toBe(refs[1].stableId);
  });

  it("never promotes a whole-page preview into a precise anchor", () => {
    const context = buildCitationContract({ kind: "pdf_page", label: "p", locator: "paper.pdf#page=2", preview: "Unselected page text" });
    expect(context.navigationTarget).toEqual({ type: "pdf_page", path: "paper.pdf", page: 2 });
    expect(classifyStrictAiLink(`citation:${context.stableId}`, [context])).toEqual({ kind: "plain_text" });
  });

  it("keeps scientifically distinct case and long excerpts as independent passage identities", () => {
    const prefix = "Common sentence. ".repeat(20);
    expect(buildCitationContracts([pdfRef(3, "58 G"), pdfRef(3, "58 g"), pdfRef(3, `${prefix}first`), pdfRef(3, `${prefix}second`)])).toHaveLength(4);
    const cases = buildCitationContracts([pdfRef(3, "58 G"), pdfRef(3, "58 g")]);
    expect(classifyStrictAiLink(`citation:${cases[1].stableId}`, cases)).toMatchObject({ kind: "citation", citation: { evidenceRef: { anchor: { snippet: "58 g" } } } });
    expect(classifyStrictAiLink(`citation:${cases[0].legacyStableId}`, cases)).toEqual({ kind: "plain_text" });
  });

  it("binds an actual Markdown passage instead of treating the whole file as a citation", () => {
    const [context] = buildCitationContracts([{ kind: "file", label: "note.md", locator: "notes/note.md", preview: "Introduction. The measured field is 58 G. Other content." }]);
    expect(classifyStrictAiLink(`citation:${context.stableId}`, [context])).toEqual({ kind: "plain_text" });
    expect(classifyStrictAiLink(`citation:${context.stableId}?quote=${encodeURIComponent("The measured field is 58 G.")}`, [context])).toMatchObject({ kind: "citation", citation: { navigationTarget: { type: "workspace_text", path: "notes/note.md", snippet: "The measured field is 58 G." } } });
    expect(classifyStrictAiLink(`citation:${context.stableId}?quote=${encodeURIComponent("The measured field is 58 g.")}`, [context])).toEqual({ kind: "plain_text" });
  });

  it("rejects ambiguous repeated passages instead of picking an arbitrary occurrence", () => {
    const [context] = buildCitationContracts([{ kind: "pdf_page", label: "paper.pdf", locator: "paper.pdf#page=2", anchor: { page: 2 }, preview: "A repeated phrase. Another repeated phrase." }]);
    expect(classifyStrictAiLink(`citation:${context.stableId}?quote=repeated%20phrase`, [context])).toEqual({ kind: "plain_text" });
    const pages = buildCitationContracts([2, 3].map(page => ({ kind: "pdf_page" as const, label: "paper.pdf", locator: `paper.pdf#page=${page}`, anchor: { page }, preview: "The same sentence." })));
    expect(classifyStrictAiLink("paper.pdf#text=The%20same%20sentence.", pages)).toEqual({ kind: "plain_text" });
  });

  it("requires a verified passage for a page-only context citation", () => {
    const [context] = buildCitationContracts([{ kind: "pdf_page", label: "paper.pdf", locator: "paper.pdf#page=3", anchor: { page: 3 }, preview: "The magnetic field is 58 G during the measurement." }]);
    expect(classifyStrictAiLink(`citation:${context.stableId}`, [context])).toEqual({ kind: "plain_text" });
    expect(classifyStrictAiLink("paper.pdf#page=3", [context])).toEqual({ kind: "plain_text" });
    const quote = "magnetic field is 58 G";
    const resolved = classifyStrictAiLink(`citation:${context.stableId}?quote=${encodeURIComponent(quote)}`, [context]);
    expect(resolved).toMatchObject({ kind: "citation", citation: { navigationTarget: { page: 3, snippet: quote }, evidenceRef: { anchor: { page: 3, snippet: quote } } } });
    expect(classifyStrictAiLink(`citation:${context.stableId}?quote=unsupported`, [context])).toEqual({ kind: "plain_text" });
  });

  it("does not validate a quote against text anchored on a conflicting page", () => {
    const contracts = buildCitationContracts([{ kind: "pdf_page", label: "paper", locator: "paper.pdf#page=3", anchor: { page: 12, snippet: "Wrong page quote" } }]);
    expect(classifyStrictAiLink("paper.pdf#page=3&text=Wrong%20page%20quote", contracts)).toEqual({ kind: "plain_text" });
  });

  it("resolves safe PDF typography to the actual original source passage", () => {
    const original = "The ampli-\ntude devi\u00adations affect the ﬁeld.";
    const context = buildCitationContract({ kind: "pdf_page", label: "paper", locator: "paper.pdf#page=3", anchor: { page: 3 }, preview: `Before. ${original} After.` });
    const result = classifyStrictAiLink(`citation:${context.stableId}?quote=${encodeURIComponent("The amplitude deviations affect the field.")}`, [context]);
    expect(result).toMatchObject({ kind: "citation", citation: { evidenceRef: { preview: original, anchor: { page: 3, snippet: original } }, navigationTarget: { page: 3, snippet: original } } });
  });

  it("does not turn formula rewrites, repeated normalized text, or wrong-page quotes into valid citations", () => {
    for (const [source, quote] of [["|ψ⟩ = 0", "|ψ > = 0"], ["devi-\nations and deviations", "deviations"], ["Logical performance improves.", "The pulses trade sensitivity for decay."]]) {
      const context = buildCitationContract({ kind: "pdf_page", label: "paper", locator: "paper.pdf#page=8", anchor: { page: 8 }, preview: source });
      expect(classifyStrictAiLink(`citation:${context.stableId}?quote=${encodeURIComponent(quote)}`, [context])).toEqual({ kind: "plain_text" });
    }
  });

  it("binds different inline quotes on the same page independently", () => {
    const contracts = buildCitationContracts([pdfRef(3, "First passage"), pdfRef(3, "Second passage")]);
    const result = classifyStrictAiLink("papers/quantum.pdf#page=3&text=Second%20passage", contracts);
    expect(result).toMatchObject({ kind: "workspace_file", citation: { stableId: contracts[1].stableId } });
  });

  it("locates a verified subquote within page evidence without copying its old geometry", () => {
    const contracts = buildCitationContracts([{ ...pdfRef(4, "The magnetic field is 58 G during detection."), anchor: { page: 4 } }]);
    const result = classifyStrictAiLink("papers/quantum.pdf#page=4&text=magnetic%20field%20is%2058%20G", contracts);
    expect(result).toMatchObject({ kind: "workspace_file", citation: { navigationTarget: { page: 4, snippet: "magnetic field is 58 G" }, evidenceRef: { anchor: { page: 4, snippet: "magnetic field is 58 G" } } } });
    expect(classifyStrictAiLink("papers/quantum.pdf#page=4&text=fabricated%20quote", contracts)).toEqual({ kind: "plain_text" });
    expect(classifyStrictAiLink("papers/quantum.pdf#page=12", contracts)).toEqual({ kind: "plain_text" });
  });

  it("exports an exact PDF quote that still locates the same passage when reopened", () => {
    const citation = buildCitationContract({ kind: "pdf_page", label: "paper.pdf", locator: "papers/paper.pdf", anchor: { page: 3, snippet: "A+B & C" } });
    expect(parseLinkTarget(citationNavigationHref(citation)!).target).toEqual(citation.navigationTarget);
  });

  it("binds absolute desktop evidence to the same PDF page contract", () => {
    expect(buildCitationContract({ kind: "pdf_page", label: "paper.pdf", locator: "C:/Research/paper.pdf#page=2" })).toMatchObject({
      navigationTarget: { type: "pdf_page", path: "C:/Research/paper.pdf", page: 2 },
    });
  });

  it("resolves an exact quote from a file URL to a canonical desktop path", () => {
    const context = buildCitationContract({ kind: "pdf_page", label: "paper.pdf", locator: "file:///C:/Research/paper.pdf#page=2", preview: "The magnetic field is 58 G." });
    expect(context.canonicalPath).toBe("C:/Research/paper.pdf");
    const citation = classifyStrictAiLink(`citation:${context.stableId}?quote=${encodeURIComponent("magnetic field is 58 G")}`, [context]);
    expect(citation).toMatchObject({ kind: "citation", citation: { navigationTarget: { path: "C:/Research/paper.pdf", page: 2, snippet: "magnetic field is 58 G" } } });
    // Saved answers emitted this id before file URLs were canonicalized.
    expect(classifyStrictAiLink(`citation:citation-v2-1c3nh6i?quote=${encodeURIComponent("magnetic field is 58 G")}`, [context]))
      .toMatchObject({ kind: "citation", citation: { canonicalPath: "C:/Research/paper.pdf" } });
  });

  it("canonicalizes query, fragment, repeated separators and dot prefixes", () => {
    expect(canonicalCitationPath("./papers//paper.pdf?download=1#page=3")).toBe("papers/paper.pdf");
  });

  it("keeps top-level location fields and groups passages by source", () => {
    const first = buildCitationContract({
      kind: "code_line",
      label: "analysis.ts",
      locator: "src/analysis.ts#line=4",
      anchor: { lineStart: 4, snippet: "const a = 1" },
    });
    const second = buildCitationContract({
      kind: "code_line",
      label: "analysis.ts",
      locator: "src/analysis.ts#line=7",
      anchor: { lineStart: 7, snippet: "const b = 2" },
    });

    expect(first).toMatchObject({ line: 4 });
    expect(second.stableId).not.toBe(first.stableId);
    expect(second.sourceGroupId).toBe(first.sourceGroupId);
    expect(groupCitationContracts([first, second])).toHaveLength(1);
  });
  it("normalizes source identity and creates deterministic passage ids", () => {
    const [citation] = buildCitationContracts([pdfRef(3, "The encoded qubit survives detection.")]);

    expect(citation).toMatchObject({
      stableId: expect.stringMatching(/^citation-v2-[a-z0-9]+$/),
      sourceGroupId: expect.stringMatching(/^source-[a-z0-9]+$/),
      canonicalPath: "papers/quantum.pdf",
      displayTitle: "quantum.pdf",
      targetType: "pdf_page",
      location: { page: 3 },
      boundedQuote: "The encoded qubit survives detection.",
      resolutionStatus: "bound",
    });
    expect(citation?.navigationTarget).toMatchObject({
      type: "pdf_page",
      path: "papers/quantum.pdf",
      page: 3,
    });
    expect(buildCitationContracts([pdfRef(3, "The encoded qubit survives detection.")])[0]?.stableId)
      .toBe(citation?.stableId);
  });

  it("turns file evidence snippets into navigable workspace text targets", () => {
    const [citation] = buildCitationContracts([{
      kind: "file",
      label: "notes/demo.md",
      locator: "notes/demo.md",
      anchor: { snippet: "quoted evidence" },
    }]);

    expect(citation).toMatchObject({
      targetType: "workspace_text",
      navigationTarget: {
        type: "workspace_text",
        path: "notes/demo.md",
        snippet: "quoted evidence",
      },
    });
    expect(citationNavigationHref(citation!)).toBe("notes/demo.md#text=quoted%20evidence");
  });

  it("groups twelve passages from one PDF into one source group", () => {
    const contracts = buildCitationContracts(
      Array.from({ length: 12 }, (_, index) => pdfRef(index + 1, `Passage ${index + 1} from the paper.`)),
    );

    const groups = groupCitationContracts(contracts);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      sourceGroupId: contracts[0]?.sourceGroupId,
      canonicalPath: "papers/quantum.pdf",
      displayTitle: "quantum.pdf",
      passageCount: 12,
    });
    expect(groups[0]?.passages).toHaveLength(12);
  });

  it("deduplicates whitespace while preserving scientific case and punctuation", () => {
    const contracts = buildCitationContracts([
      pdfRef(2, "Same quote with   spacing."),
      pdfRef(2, "Same quote with spacing."),
      pdfRef(2, "A different quote on the same page."),
    ]);

    expect(dedupeCitationContracts(contracts)).toHaveLength(2);
  });

  it("only allows verified AI links or explicit citation tokens", () => {
    const contracts = buildCitationContracts([pdfRef(3, "Verified passage")]);
    const stableId = contracts[0]!.stableId;

    expect(classifyStrictAiLink("4,2,2", contracts)).toEqual({ kind: "plain_text" });
    expect(classifyStrictAiLink("missing.pdf", contracts)).toEqual({ kind: "plain_text" });
    expect(classifyStrictAiLink("https://example.com/paper", contracts)).toEqual({
      kind: "external_url",
      href: "https://example.com/paper",
    });
    expect(classifyStrictAiLink("papers/quantum.pdf#page=3&text=Verified%20passage", contracts)).toMatchObject({
      kind: "workspace_file",
      citation: expect.objectContaining({ stableId }),
    });
    expect(classifyStrictAiLink(`citation:${stableId}`, contracts)).toMatchObject({
      kind: "citation",
      citation: expect.objectContaining({ stableId }),
    });
  });
});
