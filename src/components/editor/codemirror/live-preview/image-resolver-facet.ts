/**
 * CodeMirror Facet for resolving local image paths to displayable URLs.
 *
 * The host component (LivePreviewEditor) provides a resolver function via this
 * Facet. ImageWidget reads it at render time to convert relative/absolute local
 * paths into blob: URLs using the File System Access API.
 */

import { Facet } from '@codemirror/state';

/**
 * A function that takes a raw image URL from markdown and returns a
 * displayable URL (blob: URL for local files, or the original URL for
 * external/data URLs).  Returns null if the URL cannot be resolved.
 */
export type ImageUrlResolver = (url: string) => Promise<string | null>;

/**
 * Facet that stores the image URL resolver for the current editor instance.
 * Defaults to null (no resolver — images are rendered as-is).
 */
export const imageResolverFacet = Facet.define<ImageUrlResolver, ImageUrlResolver | null>({
  combine: (values) => values[0] ?? null,
});
