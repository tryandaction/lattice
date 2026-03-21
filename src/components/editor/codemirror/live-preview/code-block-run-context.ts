import { Facet } from "@codemirror/state";

export interface LivePreviewCodeBlockRunContext {
  filePath?: string;
}

export const codeBlockRunContextFacet = Facet.define<LivePreviewCodeBlockRunContext, LivePreviewCodeBlockRunContext>({
  combine(values) {
    return values[0] ?? {};
  },
});
