export interface TextViewerContent {
  kind: "text";
  text: string;
}

export interface BufferViewerContent {
  kind: "buffer";
  data: ArrayBuffer;
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
