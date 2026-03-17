"use client";

import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import JSZip from "jszip";
import html2canvas from "html2canvas";
import { PDFDocument } from "pdf-lib";
import type { ComponentPropsWithoutRef, CSSProperties, JSX, ReactNode } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import type { PluggableList } from "unified";
import type { AnnotationItem, AnnotationTarget } from "@/types/universal-annotation";
import type { EvidenceRef } from "@/lib/ai/types";
import { exportFile, type ExportResult } from "@/lib/export-adapter";
import { loadAnnotationsFromDisk, generateFileId } from "@/lib/universal-annotation-storage";
import { KATEX_MACROS } from "@/lib/katex-config";

type MarkdownProps<T extends keyof JSX.IntrinsicElements> = ComponentPropsWithoutRef<T> & {
  node?: unknown;
};
type MarkdownCodeProps = MarkdownProps<"code"> & { inline?: boolean };

export type MarkdownExportFormat = "docx" | "pdf";
export type MarkdownExportAnnotationMode = "clean" | "appendix" | "study-note";
export type MarkdownExportVisualMode = "document" | "rendered";

export interface MarkdownExportOptions {
  format: MarkdownExportFormat;
  title?: string;
  fileName: string;
  filePath?: string;
  annotationMode: MarkdownExportAnnotationMode;
  includeAnnotations: boolean;
  visualMode: MarkdownExportVisualMode;
  annotations?: AnnotationItem[];
  evidenceRefs?: EvidenceRef[];
  rootHandle?: FileSystemDirectoryHandle | null;
}

interface ExportSourceEntry {
  id: string;
  kind: "annotation" | "evidence";
  title: string;
  locator: string;
  sourcePath: string;
  sourceLabel: string;
  excerpt?: string;
  note?: string;
  createdAt?: number;
}

interface ExportDocumentData {
  title: string;
  bodyHtml: string;
  css: string;
  entryCount: number;
  generatedAt: string;
}

const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];
const KATEX_OPTIONS = {
  macros: KATEX_MACROS,
  throwOnError: false,
  strict: false,
  trust: true,
};

const A4_PAGE_WIDTH_PX = 794;
const A4_PAGE_HEIGHT_PX = 1123;
const A4_PAGE_WIDTH_PT = 595.28;
const A4_PAGE_HEIGHT_PT = 841.89;

function formatExportTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeFileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || fileName;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function locatorPath(locator: string): string {
  const [path] = locator.split("#", 2);
  return path || locator;
}

function titleFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function dedupeEntries(entries: ExportSourceEntry[]): ExportSourceEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = [
      entry.kind,
      entry.locator,
      entry.title,
      entry.excerpt ?? "",
      entry.note ?? "",
    ].join("::");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function annotationTargetLabel(target: AnnotationTarget): string {
  switch (target.type) {
    case "pdf":
      return `PDF 第 ${target.page} 页`;
    case "code_line":
      return `代码第 ${target.line} 行`;
    case "image":
      return "图片区域";
    case "text_anchor":
      return `锚点 ${target.elementId}`;
    default:
      return "标注";
  }
}

function buildAnnotationLocator(filePath: string | undefined, target: AnnotationTarget): string {
  const base = filePath || "";
  switch (target.type) {
    case "pdf":
      return `${base}#page=${target.page}`;
    case "code_line":
      return `${base}#line=${target.line}`;
    case "image":
      return `${base}#region=${Math.round(target.x)}-${Math.round(target.y)}`;
    case "text_anchor":
      return `${base}#anchor=${target.elementId}`;
    default:
      return base;
  }
}

function toExportEntries(
  annotations: AnnotationItem[],
  evidenceRefs: EvidenceRef[],
  filePath: string | undefined,
  fileName: string
): ExportSourceEntry[] {
  const annotationEntries = annotations.map<ExportSourceEntry>((annotation) => {
    const locator = buildAnnotationLocator(filePath, annotation.target);
    const sourcePath = locatorPath(locator) || filePath || fileName;
    return {
      id: annotation.id,
      kind: "annotation",
      title: annotationTargetLabel(annotation.target),
      locator,
      sourcePath,
      sourceLabel: titleFromPath(sourcePath || fileName),
      excerpt: annotation.content,
      note: annotation.comment,
      createdAt: annotation.createdAt,
    };
  });

  const evidenceEntries = evidenceRefs.map<ExportSourceEntry>((ref, index) => {
    const sourcePath = locatorPath(ref.locator);
    return {
      id: `evidence-${index}`,
      kind: "evidence",
      title: ref.label,
      locator: ref.locator,
      sourcePath,
      sourceLabel: titleFromPath(sourcePath),
      excerpt: ref.preview,
    };
  });

  return dedupeEntries([...annotationEntries, ...evidenceEntries]).sort((left, right) => {
    const leftTime = left.createdAt ?? 0;
    const rightTime = right.createdAt ?? 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.locator.localeCompare(right.locator);
  });
}

function splitEntriesBySource(entries: ExportSourceEntry[]): Array<{
  path: string;
  label: string;
  entries: ExportSourceEntry[];
}> {
  const grouped = new Map<string, ExportSourceEntry[]>();
  entries.forEach((entry) => {
    const current = grouped.get(entry.sourcePath) ?? [];
    grouped.set(entry.sourcePath, [...current, entry]);
  });

  return Array.from(grouped.entries())
    .map(([path, values]) => ({
      path,
      label: titleFromPath(path),
      entries: values,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function renderEntryCards(entries: ExportSourceEntry[]): ReactNode {
  return entries.map((entry, index) => (
    <article key={`${entry.id}-${index}`} className="lattice-export-note">
      <div className="lattice-export-note-meta">
        <span className="lattice-export-note-kind">{entry.kind === "annotation" ? "标注" : "证据"}</span>
        <span>{entry.title}</span>
        {entry.createdAt ? <span>{formatExportTime(entry.createdAt)}</span> : null}
      </div>
      <div className="lattice-export-note-source">
        <strong>{entry.sourceLabel}</strong>
        <code>{entry.locator}</code>
      </div>
      {entry.excerpt ? <blockquote className="lattice-export-note-block">{entry.excerpt}</blockquote> : null}
      {entry.note ? (
        <div className="lattice-export-note-comment">
          <span className="lattice-export-note-label">笔记</span>
          <p>{entry.note}</p>
        </div>
      ) : null}
    </article>
  ));
}

function ExportMetadata({
  title,
  fileName,
  filePath,
  entryCount,
  annotationMode,
  generatedAt,
}: {
  title: string;
  fileName: string;
  filePath?: string;
  entryCount: number;
  annotationMode: MarkdownExportAnnotationMode;
  generatedAt: string;
}) {
  return (
    <header className="lattice-export-header">
      <div className="lattice-export-overline">Lattice Markdown Export</div>
      <h1>{title}</h1>
      <dl className="lattice-export-meta-grid">
        <div>
          <dt>文件</dt>
          <dd>{fileName}</dd>
        </div>
        {filePath ? (
          <div>
            <dt>路径</dt>
            <dd>{filePath}</dd>
          </div>
        ) : null}
        <div>
          <dt>导出时间</dt>
          <dd>{generatedAt}</dd>
        </div>
        <div>
          <dt>标注模式</dt>
          <dd>{annotationMode}</dd>
        </div>
        <div>
          <dt>来源条目</dt>
          <dd>{entryCount}</dd>
        </div>
      </dl>
    </header>
  );
}

function StudyNoteSection({ entries }: { entries: ExportSourceEntry[] }) {
  const grouped = splitEntriesBySource(entries);
  return (
    <section className="lattice-export-study-note">
      <h2>Study Note Digest</h2>
      <p className="lattice-export-lead">
        当前导出将文档正文与已收集的标注/证据整理为学习与科研笔记视图，便于后续复盘与引用。
      </p>
      <div className="lattice-export-study-grid">
        <div className="lattice-export-panel">
          <h3>来源索引</h3>
          <ul className="lattice-export-source-list">
            {grouped.map((group) => (
              <li key={group.path}>
                <strong>{group.label}</strong>
                <span>{group.entries.length} 条</span>
                <code>{group.path}</code>
              </li>
            ))}
          </ul>
        </div>
        <div className="lattice-export-panel">
          <h3>标注摘要</h3>
          <div className="lattice-export-note-list">{renderEntryCards(entries)}</div>
        </div>
      </div>
    </section>
  );
}

function AppendixSection({ entries }: { entries: ExportSourceEntry[] }) {
  return (
    <section className="lattice-export-appendix">
      <h2>Annotation Appendix</h2>
      <p className="lattice-export-lead">
        正文保持纯净呈现，来源标注与证据引用按附录方式集中保留，适合科研归档与分享。
      </p>
      <div className="lattice-export-note-list">{renderEntryCards(entries)}</div>
    </section>
  );
}

function MarkdownContent({ content, rehypePlugins }: { content: string; rehypePlugins: PluggableList }) {
  const markdownComponents = {
    code({ inline, className, children, style: _style, node: _node, ...props }: MarkdownCodeProps) {
      const match = /language-([^\s]+)/.exec(className || "");
      const language = match ? match[1].toLowerCase() : "";
      const codeString = String(children).replace(/\n$/, "");

      if (!inline && language) {
        return (
          <div className="lattice-export-code-block">
            <SyntaxHighlighter
              style={oneDark as Record<string, CSSProperties>}
              language={language}
              PreTag="div"
              className="!m-0 !rounded-xl"
              customStyle={{ margin: 0, borderRadius: "0.875rem" }}
              {...props}
            >
              {codeString}
            </SyntaxHighlighter>
          </div>
        );
      }

      if (!inline) {
        return (
          <pre className="lattice-export-pre" {...props}>
            <code className={className}>{children}</code>
          </pre>
        );
      }

      return (
        <code className="lattice-export-inline-code" {...props}>
          {children}
        </code>
      );
    },
    table({ children, ...props }: MarkdownProps<"table">) {
      return (
        <div className="lattice-export-table-scroll">
          <table className="lattice-export-table" {...props}>
            {children}
          </table>
        </div>
      );
    },
    thead({ children, ...props }: MarkdownProps<"thead">) {
      return <thead className="lattice-export-thead" {...props}>{children}</thead>;
    },
    th({ children, ...props }: MarkdownProps<"th">) {
      return <th className="lattice-export-th" {...props}>{children}</th>;
    },
    td({ children, ...props }: MarkdownProps<"td">) {
      return <td className="lattice-export-td" {...props}>{children}</td>;
    },
    h1({ children, ...props }: MarkdownProps<"h1">) {
      return <h1 className="lattice-export-h1" {...props}>{children}</h1>;
    },
    h2({ children, ...props }: MarkdownProps<"h2">) {
      return <h2 className="lattice-export-h2" {...props}>{children}</h2>;
    },
    h3({ children, ...props }: MarkdownProps<"h3">) {
      return <h3 className="lattice-export-h3" {...props}>{children}</h3>;
    },
    h4({ children, ...props }: MarkdownProps<"h4">) {
      return <h4 className="lattice-export-h4" {...props}>{children}</h4>;
    },
    h5({ children, ...props }: MarkdownProps<"h5">) {
      return <h5 className="lattice-export-h5" {...props}>{children}</h5>;
    },
    h6({ children, ...props }: MarkdownProps<"h6">) {
      return <h6 className="lattice-export-h6" {...props}>{children}</h6>;
    },
    blockquote({ children, ...props }: MarkdownProps<"blockquote">) {
      return <blockquote className="lattice-export-blockquote" {...props}>{children}</blockquote>;
    },
    p({ children, ...props }: MarkdownProps<"p">) {
      return <p className="lattice-export-p" {...props}>{children}</p>;
    },
    ul({ children, ...props }: MarkdownProps<"ul">) {
      return <ul className="lattice-export-ul" {...props}>{children}</ul>;
    },
    ol({ children, ...props }: MarkdownProps<"ol">) {
      return <ol className="lattice-export-ol" {...props}>{children}</ol>;
    },
    li({ children, ...props }: MarkdownProps<"li">) {
      return <li className="lattice-export-li" {...props}>{children}</li>;
    },
    a({ children, href, ...props }: MarkdownProps<"a">) {
      return (
        <a className="lattice-export-link" href={href} {...props}>
          {children}
        </a>
      );
    },
    hr({ ...props }: MarkdownProps<"hr">) {
      return <hr className="lattice-export-hr" {...props} />;
    },
    strong({ children, ...props }: MarkdownProps<"strong">) {
      return <strong className="lattice-export-strong" {...props}>{children}</strong>;
    },
    em({ children, ...props }: MarkdownProps<"em">) {
      return <em className="lattice-export-em" {...props}>{children}</em>;
    },
    del({ children, ...props }: MarkdownProps<"del">) {
      return <del className="lattice-export-del" {...props}>{children}</del>;
    },
    img({ src, alt, ...props }: MarkdownProps<"img">) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img className="lattice-export-img" src={src} alt={alt || ""} {...props} />;
    },
    input({ type, checked, ...props }: MarkdownProps<"input">) {
      if (type === "checkbox") {
        return <input className="lattice-export-checkbox" type="checkbox" checked={checked} readOnly {...props} />;
      }
      return <input type={type} {...props} />;
    },
  };

  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
}

function ExportDocumentView({
  title,
  fileName,
  filePath,
  content,
  entries,
  annotationMode,
  includeAnnotations,
  rehypePlugins,
  generatedAt,
}: {
  title: string;
  fileName: string;
  filePath?: string;
  content: string;
  entries: ExportSourceEntry[];
  annotationMode: MarkdownExportAnnotationMode;
  includeAnnotations: boolean;
  rehypePlugins: PluggableList;
  generatedAt: string;
}) {
  const showAppendix = includeAnnotations && annotationMode === "appendix" && entries.length > 0;
  const showStudyNote = includeAnnotations && annotationMode === "study-note" && entries.length > 0;

  return (
    <main className="lattice-export-root">
      <ExportMetadata
        title={title}
        fileName={fileName}
        filePath={filePath}
        entryCount={entries.length}
        annotationMode={annotationMode}
        generatedAt={generatedAt}
      />

      {showStudyNote ? <StudyNoteSection entries={entries} /> : null}

      <section className="lattice-export-document">
        <MarkdownContent content={content} rehypePlugins={rehypePlugins} />
      </section>

      {showAppendix ? <AppendixSection entries={entries} /> : null}
    </main>
  );
}

function resolveWorkspacePath(currentFilePath: string, targetPath: string): string {
  if (targetPath.startsWith("/")) {
    return targetPath.slice(1);
  }

  const baseParts = currentFilePath.replace(/\\/g, "/").split("/");
  baseParts.pop();

  const resolved = [...baseParts];
  const targetParts = targetPath.replace(/\\/g, "/").split("/");
  for (const part of targetParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  return resolved.join("/");
}

async function resolveFileHandleFromRoot(
  root: FileSystemDirectoryHandle,
  filePath: string
): Promise<FileSystemFileHandle> {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const startIndex = parts[0] === root.name ? 1 : 0;
  let current: FileSystemDirectoryHandle | FileSystemFileHandle = root;

  for (let index = startIndex; index < parts.length; index += 1) {
    const isLast = index === parts.length - 1;
    current = isLast
      ? await (current as FileSystemDirectoryHandle).getFileHandle(parts[index])
      : await (current as FileSystemDirectoryHandle).getDirectoryHandle(parts[index]);
  }

  return current as FileSystemFileHandle;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

async function inlineLocalImages(
  bodyHtml: string,
  rootHandle: FileSystemDirectoryHandle | null | undefined,
  filePath: string | undefined
): Promise<string> {
  if (!rootHandle || !filePath) {
    return bodyHtml;
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<body>${bodyHtml}</body>`, "text/html");
  const images = Array.from(parsed.querySelectorAll("img"));

  await Promise.all(
    images.map(async (image) => {
      const source = image.getAttribute("src");
      if (!source || /^(https?:|data:|blob:)/i.test(source)) {
        return;
      }

      try {
        const resolvedPath = resolveWorkspacePath(filePath, source);
        const fileHandle = await resolveFileHandleFromRoot(rootHandle, resolvedPath);
        const file = await fileHandle.getFile();
        image.setAttribute("src", await blobToDataUrl(file));
      } catch (error) {
        console.warn("Failed to inline markdown export image:", source, error);
      }
    })
  );

  return parsed.body.innerHTML;
}

function collectMatchingCss(ruleMatcher: (ruleText: string) => boolean): string {
  const collected: string[] = [];

  for (const styleSheet of Array.from(document.styleSheets)) {
    try {
      const matchingRules = Array.from(styleSheet.cssRules ?? [])
        .map((rule) => rule.cssText)
        .filter((cssText) => ruleMatcher(cssText));

      if (matchingRules.length > 0) {
        collected.push(matchingRules.join("\n"));
      }
    } catch {
      continue;
    }
  }

  return collected.join("\n");
}

function getKaTeXCss(): string {
  return collectMatchingCss((cssText) => cssText.includes(".katex"));
}

async function getMarkdownRehypePlugins(): Promise<PluggableList> {
  const rehypeKatexModule = await import("rehype-katex").catch(() => null);
  const rehypeKatex = rehypeKatexModule?.default;
  const plugins: PluggableList = [rehypeRaw];

  if (rehypeKatex) {
    plugins.push([rehypeKatex, KATEX_OPTIONS]);
  }

  return plugins;
}

function getExportCss(visualMode: MarkdownExportVisualMode): string {
  const rendered = visualMode === "rendered";
  const accent = rendered ? "#a24d2a" : "#2458d6";
  const panel = rendered ? "#fbfaf7" : "#fafafa";
  const border = rendered ? "#d8d1c2" : "#dedede";
  const surface = rendered ? "#f4f4f1" : "#ffffff";
  const blockquote = rendered ? "#faf3eb" : "#f6f7fb";
  const fontFamily = rendered ? "'Segoe UI', 'PingFang SC', sans-serif" : "'Georgia', 'Times New Roman', serif";

  return `
    :root{color-scheme:light;--page-width:${A4_PAGE_WIDTH_PX}px;--accent:${accent};--panel:${panel};--border:${border};--surface:${surface};--blockquote:${blockquote};--text:#171717;--muted:#5f5b53;--code:#171717}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:var(--surface);color:var(--text);font-family:${fontFamily};line-height:1.7;-webkit-font-smoothing:antialiased}
    .lattice-export-root{width:var(--page-width);margin:0 auto;padding:72px 64px;background:#fff}
    .lattice-export-header{border-bottom:1px solid var(--border);padding-bottom:24px;margin-bottom:40px}
    .lattice-export-overline{font:600 12px/1 'Segoe UI',sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin-bottom:12px}
    .lattice-export-header h1,.lattice-export-document .lattice-export-h1:first-child{margin:0;font-size:34px;line-height:1.2}
    .lattice-export-meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 24px;margin-top:22px}
    .lattice-export-meta-grid dt,.lattice-export-note-label{font:700 12px/1.4 'Segoe UI',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
    .lattice-export-meta-grid dd{margin:0;font-size:14px;word-break:break-word}
    .lattice-export-study-note,.lattice-export-appendix{margin-bottom:40px;padding:24px;background:var(--panel);border:1px solid var(--border);border-radius:18px}
    .lattice-export-study-note h2,.lattice-export-appendix h2{margin:0 0 10px;font-size:24px;line-height:1.3}
    .lattice-export-lead{margin:0 0 16px;color:var(--muted);font-size:15px}
    .lattice-export-study-grid{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:20px}
    .lattice-export-panel,.lattice-export-note{background:#fff;border:1px solid var(--border);border-radius:14px;padding:18px}
    .lattice-export-panel h3{margin:0 0 12px;font:600 16px/1.4 'Segoe UI',sans-serif}
    .lattice-export-source-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}
    .lattice-export-source-list li{display:grid;gap:4px;font-size:13px}
    .lattice-export-source-list code,.lattice-export-note-source code{display:inline-block;font-family:'Cascadia Code','Consolas',monospace;background:rgba(0,0,0,.05);border-radius:8px;padding:6px 8px;white-space:pre-wrap;word-break:break-word;font-size:12px}
    .lattice-export-note-list{display:grid;gap:14px}
    .lattice-export-note{padding:16px 18px;break-inside:avoid}
    .lattice-export-note-meta{display:flex;flex-wrap:wrap;gap:8px 12px;font:12px/1.5 'Segoe UI',sans-serif;color:var(--muted);margin-bottom:10px}
    .lattice-export-note-kind{color:var(--accent);font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .lattice-export-note-source{display:grid;gap:6px;margin-bottom:10px}
    .lattice-export-note-block{margin:0;padding:12px 14px;border-left:3px solid var(--accent);background:rgba(36,88,214,.08);border-radius:10px;white-space:pre-wrap}
    .lattice-export-note-comment{margin-top:12px;display:grid;gap:6px}
    .lattice-export-h1{margin:40px 0 16px;font-size:30px;line-height:1.25;border-bottom:1px solid var(--border);padding-bottom:8px}
    .lattice-export-h2{margin:32px 0 14px;font-size:24px}.lattice-export-h3{margin:24px 0 12px;font-size:20px}.lattice-export-h4,.lattice-export-h5,.lattice-export-h6{margin:18px 0 10px;font-family:'Segoe UI',sans-serif}.lattice-export-h4{font-size:18px}.lattice-export-h5{font-size:16px}.lattice-export-h6{font-size:14px;color:var(--muted)}
    .lattice-export-p{margin:14px 0;font-size:15px;white-space:pre-wrap;word-break:break-word}
    .lattice-export-ul,.lattice-export-ol{margin:12px 0;padding-left:24px;display:grid;gap:6px}
    .lattice-export-link{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
    .lattice-export-inline-code{background:rgba(0,0,0,.07);border-radius:6px;padding:.15rem .35rem;font:0.9em 'Cascadia Code','Consolas',monospace}
    .lattice-export-pre{margin:16px 0;padding:18px;border-radius:16px;background:var(--code);color:#f5f5f5;font-family:'Cascadia Code','Consolas',monospace;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
    .lattice-export-code-block{margin:16px 0;overflow:hidden;border-radius:16px;background:var(--code)}
    .lattice-export-table-scroll{margin:18px 0;overflow-x:auto;border:1px solid var(--border);border-radius:16px}
    .lattice-export-table{width:100%;border-collapse:collapse;font-size:14px}.lattice-export-thead{background:rgba(0,0,0,.04)}.lattice-export-th,.lattice-export-td{padding:12px 14px;border:1px solid var(--border);text-align:left;vertical-align:top}
    .lattice-export-blockquote{margin:18px 0;padding:14px 18px;border-left:4px solid var(--accent);background:var(--blockquote);border-radius:12px}
    .lattice-export-hr{margin:28px 0;border:0;border-top:1px solid var(--border)}
    .lattice-export-img{display:block;max-width:100%;height:auto;margin:18px auto;border-radius:16px;break-inside:avoid}
    .lattice-export-checkbox{width:14px;height:14px;margin-right:8px;vertical-align:middle}
    .katex-display{overflow-x:auto;overflow-y:hidden;padding:10px 0}
  `;
}

async function buildExportDocument(
  markdown: string,
  options: MarkdownExportOptions
): Promise<ExportDocumentData> {
  const title = options.title || normalizeFileStem(options.fileName);
  const generatedAt = formatExportTime(Date.now());
  const annotationEntries = options.includeAnnotations
    ? toExportEntries(options.annotations ?? [], options.evidenceRefs ?? [], options.filePath, options.fileName)
    : [];

  const rehypePlugins = await getMarkdownRehypePlugins();

  let bodyHtml = renderToStaticMarkup(
    <ExportDocumentView
      title={title}
      fileName={options.fileName}
      filePath={options.filePath}
      content={markdown}
      entries={annotationEntries}
      annotationMode={options.annotationMode}
      includeAnnotations={options.includeAnnotations}
      rehypePlugins={rehypePlugins}
      generatedAt={generatedAt}
    />
  );
  bodyHtml = await inlineLocalImages(bodyHtml, options.rootHandle, options.filePath);

  return {
    title,
    bodyHtml,
    css: `${getExportCss(options.visualMode)}\n${getKaTeXCss()}`,
    entryCount: annotationEntries.length,
    generatedAt,
  };
}

function createHtmlDocument(documentData: ExportDocumentData): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(documentData.title)}</title>
    <style>${documentData.css}</style>
  </head>
  <body>${documentData.bodyHtml}</body>
</html>`;
}

function createDocxBytes(htmlDocument: string): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="html" ContentType="text/html"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:altChunk r:id="htmlChunk"/>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`
  );

  zip.folder("word")?.folder("_rels")?.file(
    "document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="htmlChunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="afchunk/export.html"/>
</Relationships>`
  );

  zip.folder("word")?.folder("afchunk")?.file("export.html", htmlDocument);
  return zip.generateAsync({ type: "uint8array" });
}

async function waitForImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }

          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        })
    )
  );
}

async function createPdfBytes(documentData: ExportDocumentData): Promise<Uint8Array> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-20000px";
  host.style.top = "0";
  host.style.width = `${A4_PAGE_WIDTH_PX}px`;
  host.style.zIndex = "-1";
  host.style.pointerEvents = "none";
  host.innerHTML = `<style>${documentData.css}</style>${documentData.bodyHtml}`;
  document.body.appendChild(host);

  const contentRoot = host.querySelector(".lattice-export-root") as HTMLElement | null;
  if (!contentRoot) {
    document.body.removeChild(host);
    throw new Error("Failed to create export preview");
  }

  await waitForImages(contentRoot);
  if ("fonts" in document && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const totalHeight = Math.max(contentRoot.scrollHeight, A4_PAGE_HEIGHT_PX);
  const pageCount = Math.max(1, Math.ceil(totalHeight / A4_PAGE_HEIGHT_PX));
  const pdf = await PDFDocument.create();

  try {
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const offsetY = pageIndex * A4_PAGE_HEIGHT_PX;
      const viewport = document.createElement("div");
      viewport.style.position = "relative";
      viewport.style.width = `${A4_PAGE_WIDTH_PX}px`;
      viewport.style.height = `${A4_PAGE_HEIGHT_PX}px`;
      viewport.style.overflow = "hidden";
      viewport.style.background = "#ffffff";

      const clone = contentRoot.cloneNode(true) as HTMLElement;
      clone.style.position = "absolute";
      clone.style.left = "0";
      clone.style.top = `-${offsetY}px`;
      clone.style.margin = "0";
      viewport.appendChild(clone);
      host.appendChild(viewport);

      const canvas = await html2canvas(viewport, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });

      host.removeChild(viewport);

      const imageBytes = await new Promise<Uint8Array>((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob) {
            reject(new Error("Failed to rasterize export page"));
            return;
          }
          const buffer = await blob.arrayBuffer();
          resolve(new Uint8Array(buffer));
        }, "image/png");
      });

      const embedded = await pdf.embedPng(imageBytes);
      const page = pdf.addPage([A4_PAGE_WIDTH_PT, A4_PAGE_HEIGHT_PT]);
      page.drawImage(embedded, {
        x: 0,
        y: 0,
        width: A4_PAGE_WIDTH_PT,
        height: A4_PAGE_HEIGHT_PT,
      });
    }

    return pdf.save();
  } finally {
    document.body.removeChild(host);
  }
}

function getExportDefaultName(fileName: string, format: MarkdownExportFormat): string {
  return `${normalizeFileStem(fileName)}.${format}`;
}

export async function loadMarkdownExportAnnotations(
  rootHandle: FileSystemDirectoryHandle | null | undefined,
  filePath: string | undefined,
  fileName: string
): Promise<AnnotationItem[]> {
  if (!rootHandle) {
    return [];
  }

  const fileId = generateFileId(filePath || fileName);
  const annotationFile = await loadAnnotationsFromDisk(fileId, rootHandle);
  return annotationFile.annotations;
}

export async function exportMarkdownDocument(
  markdown: string,
  options: MarkdownExportOptions
): Promise<ExportResult> {
  const documentData = await buildExportDocument(markdown, options);
  const payload = options.format === "docx"
    ? await createDocxBytes(createHtmlDocument(documentData))
    : await createPdfBytes(documentData);

  return exportFile(payload, {
    defaultFileName: getExportDefaultName(options.fileName, options.format),
    filters: [
      {
        name: options.format === "docx" ? "Word Document" : "PDF Document",
        extensions: [options.format],
      },
    ],
  });
}

export async function buildMarkdownExportPreview(
  markdown: string,
  options: MarkdownExportOptions
): Promise<{ html: string; entryCount: number }> {
  const documentData = await buildExportDocument(markdown, options);
  return {
    html: createHtmlDocument(documentData),
    entryCount: documentData.entryCount,
  };
}

export const markdownExportInternals = {
  toExportEntries,
  createHtmlDocument,
  createDocxBytes,
  buildAnnotationLocator,
};
