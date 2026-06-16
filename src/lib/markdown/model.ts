export interface MarkdownPosition {
  line: number;
  col: number;
  offset: number;
}

export interface MarkdownRange {
  start: MarkdownPosition;
  end: MarkdownPosition;
}

export interface MarkdownHeading {
  text: string;
  level: number;
  range: MarkdownRange;
}

export type MarkdownLinkKind = "wiki" | "markdown";

export interface MarkdownLink {
  kind: MarkdownLinkKind;
  target: string;
  label?: string;
  embedded: boolean;
  range: MarkdownRange;
}

export interface MarkdownTag {
  tag: string;
  range: MarkdownRange;
}

export interface MarkdownTask {
  checked: boolean;
  text: string;
  range: MarkdownRange;
}

export interface MarkdownCallout {
  type: string;
  title?: string;
  fold?: "+" | "-";
  range: MarkdownRange;
}

export interface MarkdownEmbed {
  target: string;
  label?: string;
  kind: "wiki" | "image";
  range: MarkdownRange;
}

export interface MarkdownCodeBlock {
  language?: string;
  code: string;
  range: MarkdownRange;
}

export interface MarkdownDocumentModel {
  raw: string;
  body: string;
  frontmatter?: Record<string, unknown>;
  headings: MarkdownHeading[];
  links: MarkdownLink[];
  tags: MarkdownTag[];
  tasks: MarkdownTask[];
  callouts: MarkdownCallout[];
  embeds: MarkdownEmbed[];
  codeBlocks: MarkdownCodeBlock[];
}
