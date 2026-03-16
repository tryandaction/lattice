export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type KernelMetadata = Record<string, unknown>;

export interface MimeData {
  'text/plain'?: string;
  'text/html'?: string;
  'text/markdown'?: string;
  'text/latex'?: string;
  'application/json'?: JsonValue;
  'application/javascript'?: string;
  'image/png'?: string;
  'image/jpeg'?: string;
  'image/svg+xml'?: string;
  'image/gif'?: string;
  'application/pdf'?: string;
  [mimeType: string]: string | JsonValue | undefined;
}
