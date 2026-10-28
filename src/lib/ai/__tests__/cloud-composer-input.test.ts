import { describe, expect, it } from "vitest";
import { cloudComposerInput, withCloudComposerQuestion, withoutCloudComposerSource } from "../cloud-composer-input";

describe("cloud composer question projection", () => {
  it("keeps valid file and folder mentions out of the visible question", () => {
    expect(cloudComposerInput("@cloud:library:paper @cloud-folder:library:folder Explain both"))
      .toEqual({ question: "Explain both", mentions: ["@cloud:library:paper", "@cloud-folder:library:folder"] });
  });

  it("retains unparseable cloud mentions and all ordinary local text", () => {
    const text = "Compare @local.md\n@cloud:library: @cloud:bad%:item";
    expect(cloudComposerInput(text)).toEqual({ question: text, mentions: [] });
    expect(withCloudComposerQuestion(text, "My pasted text\n@local.md")).toBe("My pasted text\n@local.md");
  });

  it("keeps a manually typed trailing source token editable until a separator closes it", () => {
    expect(cloudComposerInput("@cloud:library:p")).toEqual({ question: "@cloud:library:p", mentions: [] });
    expect(cloudComposerInput("@cloud:library:paper-001")).toEqual({ question: "@cloud:library:paper-001", mentions: [] });
    expect(cloudComposerInput("@cloud:library:paper-001 ")).toEqual({ question: "", mentions: ["@cloud:library:paper-001"] });
  });

  it("preserves the selected identities while the user replaces or clears the visible question", () => {
    const draft = "@cloud:lib%3Aone:item%2Ftwo Old question";
    expect(withCloudComposerQuestion(draft, "New question\nsecond line")).toBe("@cloud:lib%3Aone:item%2Ftwo New question\nsecond line");
    expect(withCloudComposerQuestion(draft, "")).toBe("@cloud:lib%3Aone:item%2Ftwo ");
  });

  it("keeps surrounding punctuation and paragraph layout when extracting mentions", () => {
    expect(cloudComposerInput("Compare @cloud:lib:paper， then explain\n\nDetails"))
      .toEqual({ question: "Compare ， then explain\n\nDetails", mentions: ["@cloud:lib:paper"] });
  });

  it("removes the matching source regardless of percent-encoding case without leaving its separator in the question", () => {
    expect(withoutCloudComposerSource("@cloud:lib%3aone:paper @cloud-folder:lib:folder Explain both", { kind: "file", libraryId: "lib:one", itemId: "paper" }))
      .toBe("@cloud-folder:lib:folder Explain both");
    expect(withoutCloudComposerSource("@cloud:lib:paper Explain it", { kind: "file", libraryId: "lib", itemId: "paper" })).toBe("Explain it");
  });
});
