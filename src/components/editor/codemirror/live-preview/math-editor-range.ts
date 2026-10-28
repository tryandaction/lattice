import { Facet } from '@codemirror/state';

/** Optional editors can claim a formula range while rendering their own input. */
export const activeMathEditorRange = Facet.define<{ from: number; to: number } | null, { from: number; to: number } | null>({
  combine: ranges => ranges.find(range => range !== null) ?? null,
});
