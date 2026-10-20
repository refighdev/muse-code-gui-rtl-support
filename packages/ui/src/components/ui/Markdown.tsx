import { copyText } from "../../app/host.js";
import { CheckIcon, CopyIcon } from "./icons.js";
import { Children, createContext, isValidElement, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { looksLikeFilePath, type FileTarget } from "../../model/files.js";
import { prepareMath } from "../../model/math.js";
import { STREAM_SAMPLE_MS, streamRenderMode } from "../../model/streaming.js";
import { useSampledText } from "../../app/sampled.js";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlight } from "sugar-high";
import { cn } from "./primitives.js";
import { SwapIcon } from "./sourced.js";

export function useCopy(timeout = 1400): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );
  const copy = (text: string) => {
    void copyText(text).then(() => {
      setCopied(true);
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
      timer.current = window.setTimeout(() => setCopied(false), timeout);
    });
  };
  return [copied, copy];
}

export function CopyButton(props: { text: string; label?: string; className?: string }) {
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : (props.label ?? "Copy")}
      onClick={() => copy(props.text)}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md text-subtle transition-colors hover:bg-hover hover:text-fg",
        props.className,
      )}
    >
      <SwapIcon value={copied ? "copied" : "copy"}>
        {copied ? <CheckIcon size={13} className="text-ok" /> : <CopyIcon size={13} />}
      </SwapIcon>
    </button>
  );
}

const HIGHLIGHTABLE =
  /^(js|jsx|ts|tsx|javascript|typescript|json|jsonc|css|scss|html|xml|java|c|cpp|cs|go|rust|rs|swift|kotlin|php|py|python|rb|ruby|sh|bash|zsh|shell|ps1|powershell|sql|yaml|yml|toml|lua|dart)$/i;

/** What a file extension implies about its language, for colouring a diff the same way a code block is coloured. */
const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  mts: "ts",
  cts: "ts",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "cs",
  go: "go",
  rs: "rs",
  swift: "swift",
  kt: "kotlin",
  php: "php",
  py: "py",
  rb: "rb",
  sh: "sh",
  bash: "bash",
  zsh: "zsh",
  ps1: "ps1",
  sql: "sql",
  yaml: "yaml",
  yml: "yml",
  toml: "toml",
  lua: "lua",
  dart: "dart",
};

/** The language a path implies, or null when nothing here can colour it. */
export function languageFromPath(path: string | null | undefined): string | null {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path ?? "")?.[1]?.toLowerCase();
  const language = extension ? EXTENSION_LANGUAGE[extension] : undefined;
  return language && HIGHLIGHTABLE.test(language) ? language : null;
}

/** Highlighted HTML for a line or a block, or null when it is not worth colouring. */
export function highlightCode(code: string, language: string | null): string | null {
  if (!language || code.length === 0 || code.length > 2000) {
    return null;
  }
  try {
    return highlight(code);
  } catch {
    return null;
  }
}

export const CodeBlock = memo(function CodeBlock(props: { code: string; language: string | null; className?: string }) {
  const html = useMemo(() => {
    if (props.code.length > 60_000 || (props.language && !HIGHLIGHTABLE.test(props.language))) {
      return null;
    }
    try {
      return highlight(props.code);
    } catch {
      return null;
    }
  }, [props.code, props.language]);
  return (
    <div
      className={cn("code-surface group/code my-3 overflow-hidden rounded-xl bg-sunken shadow-[0_0_0_1px_var(--border)]", props.className)}
    >
      <div className="flex h-8 items-center justify-between pr-1 pl-3.5">
        <span className="font-mono text-2xs text-subtle">{props.language ?? "text"}</span>
        <CopyButton text={props.code} label="Copy code" className="opacity-60 group-hover/code:opacity-100 focus-visible:opacity-100" />
      </div>
      <pre dir="ltr" className="max-h-[480px] overflow-auto px-3.5 pb-3">
        {html !== null ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{props.code}</code>}
      </pre>
    </div>
  );
});

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

/**
 * Where paths in rendered markdown lead. Inside a thread they open in the file viewer; inside a previewed file they
 * resolve from that file's folder, and relative images load from the project. Without it, markdown renders as before.
 */
export interface FileLinks {
  resolve(href: string): FileTarget | null;
  open(target: FileTarget): void;
  /** A URL for a project image a preview embeds; null leaves the source as written. */
  imageUrl?(src: string): string | null;
}

export const FileLinksContext = createContext<FileLinks | null>(null);

function MarkdownLink(props: { href?: string; children?: ReactNode }) {
  const links = useContext(FileLinksContext);
  const target = links && props.href ? links.resolve(props.href) : null;
  if (links && target) {
    return (
      <a
        href={props.href}
        title={`Open ${target.path}`}
        onClick={(event) => {
          event.preventDefault();
          links.open(target);
        }}
      >
        {props.children}
      </a>
    );
  }
  return (
    <a href={props.href} target="_blank" rel="noreferrer noopener">
      {props.children}
    </a>
  );
}

/** Inline code naming a file, like `src/app.ts:12`, opens it; any other inline code is left alone. */
function InlineCode(props: { className?: string; children?: ReactNode }) {
  const links = useContext(FileLinksContext);
  const text = typeof props.children === "string" ? props.children : null;
  const target = links && text && !props.className && looksLikeFilePath(text) ? links.resolve(text) : null;
  if (links && target) {
    return (
      <code
        role="link"
        tabIndex={0}
        title={`Open ${target.path}`}
        className="cursor-pointer decoration-[color-mix(in_oklch,var(--accent-text)_45%,transparent)] underline-offset-2 hover:text-accent-text hover:underline"
        onClick={() => links.open(target)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            links.open(target);
          }
        }}
      >
        {text}
      </code>
    );
  }
  return <code className={props.className}>{props.children}</code>;
}

function MarkdownImage(props: { src?: string | Blob; alt?: string }) {
  const links = useContext(FileLinksContext);
  const raw = typeof props.src === "string" ? props.src : undefined;
  const src = raw && links?.imageUrl ? (links.imageUrl(raw) ?? raw) : raw;
  return <img src={src} alt={props.alt ?? ""} loading="lazy" className="max-w-full rounded-lg" />;
}

const COMPONENTS: Components = {
  // dir="auto": each block takes its direction from its own first strong character, so Persian/Arabic/Hebrew
  // prose is right-to-left and English stays left-to-right, block by block.
  p: ({ children }) => <p dir="auto">{children}</p>,
  h1: ({ children }) => <h1 dir="auto">{children}</h1>,
  h2: ({ children }) => <h2 dir="auto">{children}</h2>,
  h3: ({ children }) => <h3 dir="auto">{children}</h3>,
  h4: ({ children }) => <h4 dir="auto">{children}</h4>,
  h5: ({ children }) => <h5 dir="auto">{children}</h5>,
  h6: ({ children }) => <h6 dir="auto">{children}</h6>,
  ul: ({ children }) => <ul dir="auto">{children}</ul>,
  ol: ({ children, start }) => (
    <ol dir="auto" start={start}>
      {children}
    </ol>
  ),
  li: ({ children }) => <li dir="auto">{children}</li>,
  blockquote: ({ children }) => <blockquote dir="auto">{children}</blockquote>,
  th: ({ children }) => <th dir="auto">{children}</th>,
  td: ({ children }) => <td dir="auto">{children}</td>,
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  code: ({ className, children }) => <InlineCode className={className}>{children}</InlineCode>,
  img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
  pre: ({ children }) => {
    const child = Children.toArray(children)[0];
    if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
      const language = /language-([\w+#-]+)/.exec(child.props.className ?? "")?.[1] ?? null;
      return <CodeBlock code={textOf(child.props.children).replace(/\n$/, "")} language={language} />;
    }
    return <pre>{children}</pre>;
  },
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

const PLUGINS = [remarkGfm];

type MathKit = typeof import("./mathPlugins.js");
let mathKit: MathKit | null = null;
let mathLoad: Promise<void> | null = null;

/** The math plugins, once loaded; null until a message with a formula asks for them (and when the chunk fails to load). */
function useMathKit(wanted: boolean): MathKit | null {
  const [kit, setKit] = useState(mathKit);
  useEffect(() => {
    if (!wanted || kit) {
      return;
    }
    let live = true;
    mathLoad ??= import("./mathPlugins.js").then((loaded) => {
      mathKit = loaded;
    });
    mathLoad.then(
      () => live && setKit(mathKit),
      () => {
        mathLoad = null;
      },
    );
    return () => {
      live = false;
    };
  }, [wanted, kit]);
  return wanted ? (kit ?? mathKit) : null;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * Wraps each word of prose in a span while text is still streaming, so a word that just arrived can fade in
 * on its own. Word positions never shift as text is appended, so React keeps the old spans and only the new
 * ones mount and animate. Code keeps its own markup.
 */
function rehypeWords() {
  const walk = (node: HastNode): void => {
    const classes = node.properties?.["className"];
    // Typeset math is markup of its own; wrapping its text would break it.
    if (
      !node.children ||
      node.tagName === "pre" ||
      node.tagName === "code" ||
      (Array.isArray(classes) && classes.some((c) => String(c).startsWith("katex")))
    ) {
      return;
    }
    const next: HastNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && child.value) {
        for (const part of child.value.split(/(\s+)/)) {
          if (!part) {
            continue;
          }
          next.push(
            /^\s+$/.test(part)
              ? { type: "text", value: part }
              : { type: "element", tagName: "span", properties: { className: ["tok"] }, children: [{ type: "text", value: part }] },
          );
        }
        continue;
      }
      walk(child);
      next.push(child);
    }
    node.children = next;
  };
  return (tree: HastNode) => walk(tree);
}

const STREAM_PLUGINS = [rehypeWords];

/**
 * Agent prose: GitHub-flavored markdown with highlighted code blocks. `stream` fades in each new
 * word while the text is short; a huge stream renders plain, then from a throttled snapshot, so
 * it cannot cost a full re-parse on every flush.
 */
export const Markdown = memo(function Markdown(props: { text: string; className?: string; stream?: boolean }) {
  const mode = streamRenderMode(props.text.length, props.stream ?? false);
  const sampled = useSampledText(props.text, mode === "sampled", STREAM_SAMPLE_MS);
  const math = useMemo(() => prepareMath(sampled), [sampled]);
  const kit = useMathKit(math.hasMath);
  const remark = kit ? [...PLUGINS, ...kit.MATH_REMARK] : PLUGINS;
  const words = mode === "words" ? STREAM_PLUGINS : [];
  const rehype = kit ? [...kit.MATH_REHYPE, ...words] : words;
  return (
    <div className={cn("prose-musegui", props.className)}>
      <ReactMarkdown remarkPlugins={remark} rehypePlugins={rehype} components={COMPONENTS}>
        {kit ? math.text : sampled}
      </ReactMarkdown>
    </div>
  );
});
