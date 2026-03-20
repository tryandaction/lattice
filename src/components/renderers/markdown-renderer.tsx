"use client";

import "katex/dist/katex.min.css";
import { useState, useCallback, useEffect, useMemo, useRef, type ComponentPropsWithoutRef, type CSSProperties, type JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import type { Components } from "react-markdown";
import type { PluggableList } from "unified";
import { Check, Copy, Loader2, Play } from "lucide-react";
import { KATEX_MACROS } from "@/lib/katex-config";
import type { PaneId } from "@/types/layout";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import { dirname, resolveWorkspaceFilePath } from "@/lib/runner/path-utils";
import { getLanguagePreferenceKey, getRunnerDefinitionForLanguage, resolveRunnerExecutionRequest } from "@/lib/runner/preferences";
import { useExecutionRunner } from "@/hooks/use-execution-runner";
import { OutputArea } from "@/components/notebook/output-area";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface MarkdownRendererProps {
  content: string;
  fileName?: string;
  className?: string;
  paneId?: PaneId;
  filePath?: string;
  enableCodeExecution?: boolean;
}

type MarkdownProps<T extends keyof JSX.IntrinsicElements> = ComponentPropsWithoutRef<T> & {
  node?: unknown;
};

type MarkdownCodeProps = MarkdownProps<"code"> & { inline?: boolean };
type RehypeKatexPlugin = typeof import("rehype-katex").default;

/**
 * Copy button component for code blocks
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
      title={copied ? "Copied!" : "Copy code"}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
}

function RunnableCodeBlock({
  language,
  code,
  enableExecution,
  filePath,
  blockKey,
}: {
  language: string;
  code: string;
  enableExecution: boolean;
  filePath?: string;
  blockKey: string;
}) {
  const runnerDefinition = useMemo(() => getRunnerDefinitionForLanguage(language), [language]);
  const rootName = useWorkspaceStore((state) => state.rootHandle?.name ?? state.fileTree.root?.name ?? null);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const setRecentRunConfig = useWorkspaceStore((state) => state.setRecentRunConfig);
  const setRunnerPreferences = useWorkspaceStore((state) => state.setRunnerPreferences);
  const absoluteFilePath = useMemo(
    () => (filePath ? resolveWorkspaceFilePath(workspaceRootPath, filePath, rootName) : null),
    [workspaceRootPath, filePath, rootName],
  );
  const cwd = absoluteFilePath ? dirname(absoluteFilePath) : workspaceRootPath ?? undefined;
  const {
    outputs,
    panelMeta,
    run,
    clearOutputs,
    setPanelMeta,
    isRunning,
    isLoading,
  } = useExecutionRunner();

  const canExecute = enableExecution && Boolean(runnerDefinition?.supportsInlineCode);
  const hasPanel = outputs.length > 0 || panelMeta.diagnostics.length > 0;

  const handleRun = useCallback(async () => {
    if (!runnerDefinition) {
      return;
    }

    const resolved = await resolveRunnerExecutionRequest({
      runnerDefinition,
      mode: "inline",
      code,
      cwd,
      absoluteFilePath: absoluteFilePath ?? undefined,
      fileKey: blockKey,
      language,
      preferences: runnerPreferences,
    });

    clearOutputs();
    setPanelMeta({
      origin: resolved.meta.origin,
      diagnostics: resolved.meta.diagnostics,
    });

    if (!resolved.request) {
      return;
    }

    const result = await run(resolved.request);
    if (result.success) {
      setRecentRunConfig(blockKey, {
        runnerType: resolved.request.runnerType,
        command: resolved.request.command,
        args: resolved.request.args,
      });
      setRunnerPreferences({
        defaultLanguageRunners: {
          [getLanguagePreferenceKey(language)]: resolved.request.runnerType,
        },
        defaultPythonPath: resolved.request.runnerType === "python-local"
          ? resolved.request.command ?? runnerPreferences.defaultPythonPath
          : runnerPreferences.defaultPythonPath,
      });
    }
  }, [
    absoluteFilePath,
    blockKey,
    clearOutputs,
    code,
    cwd,
    language,
    run,
    runnerDefinition,
    runnerPreferences,
    setPanelMeta,
    setRecentRunConfig,
    setRunnerPreferences,
  ]);

  return (
    <div className="relative group my-4">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {canExecute ? (
          <button
            type="button"
            onClick={() => void handleRun()}
            className="inline-flex items-center gap-1 rounded bg-primary/90 px-2 py-1 text-[11px] text-primary-foreground hover:bg-primary"
            title="Run code block"
          >
            {isRunning || isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            <span>Run</span>
          </button>
        ) : null}
        <CopyButton text={code} />
      </div>

      <SyntaxHighlighter
        style={oneDark as Record<string, CSSProperties>}
        language={language}
        PreTag="div"
        className="rounded-lg text-sm !mt-0 !mb-0"
      >
        {code}
      </SyntaxHighlighter>

      {hasPanel ? (
        <div className="mt-2 not-prose">
          <OutputArea outputs={outputs} meta={panelMeta} variant="compact" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Custom components for ReactMarkdown
 */
const components: Components = {
  // Code blocks with syntax highlighting and copy button
  code({ inline, className, children, style: _style, node: _node, ...props }: MarkdownCodeProps) {
    const match = /language-([^\s]+)/.exec(className || "");
    const language = match ? match[1].toLowerCase() : "";
    const codeString = String(children).replace(/\n$/, "");

    if (!inline && language) {
      return (
        <div className="relative group my-4">
          <SyntaxHighlighter
            style={oneDark as Record<string, CSSProperties>}
            language={language}
            PreTag="div"
            className="rounded-lg text-sm !mt-0 !mb-0"
            {...props}
          >
            {codeString}
          </SyntaxHighlighter>
          <CopyButton text={codeString} />
        </div>
      );
    }

    if (!inline) {
      return (
        <div className="relative group my-4">
          <pre className="bg-muted rounded-lg p-4 overflow-x-auto">
            <code className={className} {...props}>
              {children}
            </code>
          </pre>
          <CopyButton text={codeString} />
        </div>
      );
    }

    return (
      <code className="bg-muted rounded px-1.5 py-0.5 text-sm font-mono" {...props}>
        {children}
      </code>
    );
  },
  
  // Tables
  table({ children, ...props }: MarkdownProps<"table">) {
    return (
      <div className="overflow-x-auto my-4">
        <table className="w-full border-collapse text-sm" {...props}>
          {children}
        </table>
      </div>
    );
  },
  
  thead({ children, ...props }: MarkdownProps<"thead">) {
    return (
      <thead className="bg-muted" {...props}>
        {children}
      </thead>
    );
  },
  
  th({ children, ...props }: MarkdownProps<"th">) {
    return (
      <th className="border border-border px-3 py-2 text-left font-semibold" {...props}>
        {children}
      </th>
    );
  },
  
  td({ children, ...props }: MarkdownProps<"td">) {
    return (
      <td className="border border-border px-3 py-2" {...props}>
        {children}
      </td>
    );
  },
  
  // Headings with proper styling
  h1({ children, ...props }: MarkdownProps<"h1">) {
    return (
      <h1 className="text-3xl font-bold mt-8 mb-4 pb-2 border-b border-border" {...props}>
        {children}
      </h1>
    );
  },
  
  h2({ children, ...props }: MarkdownProps<"h2">) {
    return (
      <h2 className="text-2xl font-bold mt-6 mb-3 pb-1 border-b border-border/50" {...props}>
        {children}
      </h2>
    );
  },
  
  h3({ children, ...props }: MarkdownProps<"h3">) {
    return (
      <h3 className="text-xl font-semibold mt-5 mb-2" {...props}>
        {children}
      </h3>
    );
  },
  
  h4({ children, ...props }: MarkdownProps<"h4">) {
    return (
      <h4 className="text-lg font-semibold mt-4 mb-2" {...props}>
        {children}
      </h4>
    );
  },

  h5({ children, ...props }: MarkdownProps<"h5">) {
    return (
      <h5 className="text-base font-semibold mt-3 mb-1" {...props}>
        {children}
      </h5>
    );
  },

  h6({ children, ...props }: MarkdownProps<"h6">) {
    return (
      <h6 className="text-sm font-semibold mt-3 mb-1 text-muted-foreground" {...props}>
        {children}
      </h6>
    );
  },
  
  // Blockquotes
  blockquote({ children, ...props }: MarkdownProps<"blockquote">) {
    return (
      <blockquote 
        className="border-l-4 border-primary/40 pl-4 my-4 italic text-muted-foreground bg-muted/30 py-2 pr-4 rounded-r"
        {...props}
      >
        {children}
      </blockquote>
    );
  },
  
  // Lists with better nesting support
  ul({ children, ...props }: MarkdownProps<"ul">) {
    return (
      <ul className="list-disc pl-6 my-3 space-y-1.5 [&_ul]:my-1.5 [&_ul]:space-y-1 [&_ol]:my-1.5 [&_ol]:space-y-1" {...props}>
        {children}
      </ul>
    );
  },

  ol({ children, ...props }: MarkdownProps<"ol">) {
    return (
      <ol className="list-decimal pl-6 my-3 space-y-1.5 [&_ul]:my-1.5 [&_ul]:space-y-1 [&_ol]:my-1.5 [&_ol]:space-y-1" {...props}>
        {children}
      </ol>
    );
  },

  li({ children, ...props }: MarkdownProps<"li">) {
    return (
      <li className="leading-relaxed" {...props}>
        {children}
      </li>
    );
  },
  
  // Paragraphs
  p({ children, ...props }: MarkdownProps<"p">) {
    return (
      <p className="my-3 leading-relaxed" {...props}>
        {children}
      </p>
    );
  },
  
  // Links
  a({ children, href, ...props }: MarkdownProps<"a">) {
    return (
      <a 
        href={href}
        className="text-primary underline underline-offset-2 hover:text-primary/80"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },
  
  // Horizontal rule
  hr({ ...props }: MarkdownProps<"hr">) {
    return <hr className="my-8 border-0 border-t border-border" {...props} />;
  },
  
  // Strong/Bold
  strong({ children, ...props }: MarkdownProps<"strong">) {
    return (
      <strong className="font-bold" {...props}>
        {children}
      </strong>
    );
  },
  
  // Emphasis/Italic
  em({ children, ...props }: MarkdownProps<"em">) {
    return (
      <em className="italic" {...props}>
        {children}
      </em>
    );
  },

  // Strikethrough
  del({ children, ...props }: MarkdownProps<"del">) {
    return (
      <del className="line-through text-muted-foreground" {...props}>
        {children}
      </del>
    );
  },

  // Images
  img({ src, alt, ...props }: MarkdownProps<"img">) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img 
        src={src}
        alt={alt || ""}
        className="rounded-lg my-4 max-w-full h-auto"
        loading="lazy"
        {...props}
      />
    );
  },

  // Pre element (for code blocks without language)
  pre({ children, ...props }: MarkdownProps<"pre">) {
    return (
      <pre className="bg-muted rounded-lg p-4 my-4 overflow-x-auto text-sm" {...props}>
        {children}
      </pre>
    );
  },
};

const katexOptions = {
  macros: KATEX_MACROS,
  throwOnError: false,
  strict: false,
  trust: true,
};

/**
 * High-quality Markdown renderer with:
 * - GitHub Flavored Markdown (tables, strikethrough, etc.)
 * - Math rendering via KaTeX
 * - Syntax highlighting for code blocks
 * - Responsive tables
 *
 * Note: HTML content should be converted to Markdown before reaching this component
 * via normalizeScientificText() in universal-file-viewer.tsx
 */
export function MarkdownRenderer({
  content,
  fileName = "document.md",
  className = "",
  paneId,
  filePath,
  enableCodeExecution = false,
}: MarkdownRendererProps) {
  // Content should already be normalized to Markdown by upstream (universal-file-viewer)
  // If HTML is still present, it will be handled by rehypeRaw plugin safely
  const [rehypeKatex, setRehypeKatex] = useState<RehypeKatexPlugin | null>(null);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { menuState: selectionMenuState, closeMenu: closeSelectionMenu } = useSelectionContextMenu(
    containerRef,
    ({ text }) => {
      if (!paneId) return null;
      return createSelectionContext({
        sourceKind: "markdown",
        paneId,
        fileName,
        filePath,
        selectedText: text,
        documentText: content,
      });
    }
  );

  useEffect(() => {
    let active = true;
    import("rehype-katex")
      .then((mod) => {
        if (!active) return;
        const plugin = (mod.default ?? mod) as RehypeKatexPlugin;
        setRehypeKatex(() => plugin);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const rehypePlugins = useMemo<PluggableList>(() => {
    const plugins: PluggableList = [rehypeRaw];
    if (rehypeKatex) {
      plugins.push([rehypeKatex, katexOptions]);
    }
    return plugins;
  }, [rehypeKatex]);

  let blockIndex = 0;
  const markdownComponents: Components = {
    ...components,
    code({ inline, className, children, style: _style, node: _node, ...props }: MarkdownCodeProps) {
      const match = /language-([^\s]+)/.exec(className || "");
      const language = match ? match[1].toLowerCase() : "";
      const codeString = String(children).replace(/\n$/, "");

      if (!inline && language) {
        const currentIndex = blockIndex;
        blockIndex += 1;
        return (
          <RunnableCodeBlock
            language={language}
            code={codeString}
            enableExecution={enableCodeExecution}
            filePath={filePath}
            blockKey={`${filePath ?? fileName}#block:${currentIndex}:${language}`}
          />
        );
      }

      if (!inline) {
        return (
          <div className="relative group my-4">
            <pre className="bg-muted rounded-lg p-4 overflow-x-auto">
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
            <CopyButton text={codeString} />
          </div>
        );
      }

      return (
        <code className="bg-muted rounded px-1.5 py-0.5 text-sm font-mono" {...props}>
          {children}
        </code>
      );
    },
  };
  
  return (
    <div ref={containerRef} className={`prose prose-lattice dark:prose-invert max-w-none ${className}`}>
      <SelectionContextMenu
        state={selectionMenuState}
        onClose={closeSelectionMenu}
        onOpenHub={(context, mode, returnFocusTo) => setSelectionHubState({ context, mode, returnFocusTo })}
      />
      <SelectionAiHub
        context={selectionHubState?.context ?? null}
        initialMode={selectionHubState?.mode ?? "chat"}
        returnFocusTo={selectionHubState?.returnFocusTo}
        onClose={() => setSelectionHubState(null)}
      />
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
