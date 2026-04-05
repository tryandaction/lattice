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

export type ViewerContent =
  | TextViewerContent
  | BufferViewerContent
  | DesktopUrlViewerContent;

export type BinaryViewerContent = BufferViewerContent | DesktopUrlViewerContent;
