export interface TextViewerContent {
  kind: "text";
  text: string;
}

export interface BufferViewerContent {
  kind: "buffer";
  data: ArrayBuffer;
  /** Revision of the File snapshot that produced these bytes, never a later stat. */
  sourceRevision?: string;
}

export interface DesktopUrlViewerContent {
  kind: "desktop-url";
  url: string;
  mimeType?: string | null;
}

export interface WebUrlViewerContent {
  kind: "web-url";
  url: string;
  title?: string | null;
}

export type ViewerContent =
  | TextViewerContent
  | BufferViewerContent
  | DesktopUrlViewerContent
  | WebUrlViewerContent;

export type BinaryViewerContent = BufferViewerContent | DesktopUrlViewerContent;
