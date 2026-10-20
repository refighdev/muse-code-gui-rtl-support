import { ArrowSquareOutIcon, ArrowsClockwiseIcon, CaretRightIcon, CodeIcon, EyeIcon, FileAudioIcon, FileCodeIcon, FileIcon, FileImageIcon, FileTextIcon, FileTxtIcon, FileVideoIcon, FolderIcon, FolderOpenIcon, MagnifyingGlassIcon, TreeViewIcon, XIcon } from "../ui/icons.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { shallowEqual, useApp, useController } from "../../app/context.js";
import { useImeGuard } from "../../app/ime.js";
import { useOverlayDragProps } from "../../app/frame.js";
import { errorKind, errorMessage } from "../../client.js";
import { basenameOf, dirnameOf, fileKey, fileTarget, formatFileSize, isMarkdownPath, type LineRange } from "../../model/files.js";
import { DEFAULT_FILES_WIDTH } from "../../model/store.js";
import type { FileContent, FileEntry } from "../../types.js";
import { FileLinksContext, Markdown, languageFromPath, type FileLinks } from "../ui/Markdown.js";
import { Tip } from "../ui/overlays.js";
import { Button, IconButton, Spinner, cn } from "../ui/primitives.js";
import { highlight } from "sugar-high";

/** Past this, source is shown as plain lines: highlighting a huge file would freeze the thread beside it. */
const HIGHLIGHT_LIMIT = 300_000;

function iconFor(name: string): ReactNode {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (isMarkdownPath(name) || ext === "txt") {
    return <FileTextIcon size={14} />;
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp"].includes(ext)) {
    return <FileImageIcon size={14} />;
  }
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(ext)) {
    return <FileVideoIcon size={14} />;
  }
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) {
    return <FileAudioIcon size={14} />;
  }
  if (ext === "pdf") {
    return <FileTxtIcon size={14} />;
  }
  return languageFromPath(name) ? <FileCodeIcon size={14} /> : <FileIcon size={14} />;
}

/** The file viewer beside a thread: open files as tabs, or the project's tree to find one. */
export function FilesPanel(props: { sessionId: string; cwd: string }) {
  const controller = useController();
  const width = useApp((s) => s.prefs.filesWidth);
  const panel = useApp((s) => s.filePanels[props.sessionId] ?? null, shallowEqual);
  const drafts = useApp((s) => s.fileDrafts);
  const drag = useOverlayDragProps();
  const noDrag = useOverlayDragProps("off");
  const tabs = panel?.tabs ?? [];
  const active = panel?.active ?? null;
  const showTree = !panel || panel.tree || !active;
  const close = (path: string) => {
    const dirty = drafts[fileKey(props.cwd, path)];
    if (dirty && !window.confirm(`Discard your unsaved changes to ${basenameOf(path)}?`)) {
      return;
    }
    controller.closeFile(props.sessionId, path);
  };
  return (
    <aside
      aria-label="Files"
      className="relative flex h-full shrink-0 flex-col border-l border-line bg-bg"
      style={{ width: `min(${width}px, 70%)` }}
    >
      <ResizeHandle />
      <header data-drag-region {...drag} className="flex h-12 shrink-0 items-center gap-1 border-b border-line pr-2 pl-2">
        <Tip label={showTree ? "Back to the open file" : "Show files"}>
          <IconButton
            label={showTree ? "Back to the open file" : "Show files"}
            active={showTree}
            disabled={showTree && !active}
            onClick={() => controller.showFileTree(props.sessionId, !showTree)}
            {...noDrag}
          >
            <TreeViewIcon size={15} />
          </IconButton>
        </Tip>
        <div role="tablist" aria-label="Open files" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" {...noDrag}>
          {tabs.map((path) => {
            const selected = path === active && !showTree;
            const dirty = Boolean(drafts[fileKey(props.cwd, path)]);
            return (
              <div
                key={path}
                role="tab"
                aria-selected={selected}
                title={path}
                className={cn(
                  "group/tab flex h-7 max-w-[200px] shrink-0 items-center gap-1 rounded-md pr-0.5 pl-2 text-xs transition-colors duration-100",
                  selected ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1.5"
                  onClick={() => controller.activateFile(props.sessionId, path)}
                >
                  <span className="shrink-0 text-subtle">{iconFor(path)}</span>
                  <span className="truncate">{basenameOf(path)}</span>
                </button>
                <button
                  type="button"
                  aria-label={dirty ? `${basenameOf(path)} has unsaved changes. Close` : `Close ${basenameOf(path)}`}
                  onClick={() => close(path)}
                  className="flex size-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-hover hover:text-fg"
                >
                  {dirty ? <span className="size-1.5 rounded-full bg-accent group-hover/tab:hidden" /> : null}
                  <XIcon size={12} className={cn(dirty && "hidden group-hover/tab:block")} />
                </button>
              </div>
            );
          })}
        </div>
        <Tip label="Close files">
          <IconButton label="Close files" onClick={() => controller.toggleFiles(false)} {...noDrag}>
            <XIcon size={15} />
          </IconButton>
        </Tip>
      </header>
      <div className="min-h-0 flex-1">
        {showTree ? (
          <FileTree sessionId={props.sessionId} cwd={props.cwd} />
        ) : active ? (
          <FileView key={active} sessionId={props.sessionId} cwd={props.cwd} path={active} line={panel?.line ?? null} />
        ) : null}
      </div>
    </aside>
  );
}

function ResizeHandle() {
  const controller = useController();
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = controller.store.get().prefs.filesWidth;
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    // The panel sits on the right, so dragging left widens it.
    const move = (e: globalThis.PointerEvent) => controller.setFilesWidth(startWidth - (e.clientX - startX));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize files"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => controller.setFilesWidth(DEFAULT_FILES_WIDTH)}
      onKeyDown={(e) => {
        const width = controller.store.get().prefs.filesWidth;
        if (e.key === "ArrowLeft") {
          controller.setFilesWidth(width + 16);
        } else if (e.key === "ArrowRight") {
          controller.setFilesWidth(width - 16);
        }
      }}
      className="absolute top-0 left-[-3px] z-[var(--z-resize)] h-full w-1.5 cursor-col-resize transition-colors duration-150 hover:bg-accent/35 focus-visible:bg-accent/35 focus-visible:outline-none"
    />
  );
}

// ---------------------------------------------------------------- tree

function FileTree(props: { sessionId: string; cwd: string }) {
  const ime = useImeGuard();
  const controller = useController();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const words = query.trim();
    if (!words) {
      setResults(null);
      return;
    }
    let live = true;
    setSearching(true);
    // A short pause, so a search runs once the typing stops rather than on every key.
    const timer = window.setTimeout(() => {
      controller
        .searchFiles(props.cwd, words)
        .then((found) => live && setResults(found))
        .catch(() => live && setResults([]))
        .finally(() => live && setSearching(false));
    }, 160);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [controller, props.cwd, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-sunken px-2 text-sm shadow-[0_0_0_1px_var(--border)] focus-within:shadow-[0_0_0_1px_var(--accent)]">
          {searching ? <Spinner size={12} className="shrink-0" /> : <MagnifyingGlassIcon size={13} className="shrink-0 text-subtle" />}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyUp={ime.onKeyUp}
            onKeyDown={(event) => {
              if (ime.isImeKey(event)) {
                return;
              }
              if (event.key === "Escape") {
                setQuery("");
              } else if (event.key === "Enter" && results?.[0]) {
                controller.openFile(props.sessionId, results[0].path);
              }
            }}
            placeholder="Find a file"
            aria-label="Find a file"
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-subtle"
          />
        </label>
        <Tip label="Refresh">
          <IconButton size="sm" label="Refresh files" onClick={() => setReload((n) => n + 1)}>
            <ArrowsClockwiseIcon size={13} />
          </IconButton>
        </Tip>
      </div>
      <div role="tree" aria-label="Project files" className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {results ? (
          results.length === 0 && !searching ? (
            <p className="px-3 py-6 text-center text-sm text-muted">No files match.</p>
          ) : (
            results.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => controller.openFile(props.sessionId, entry.path)}
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-hover"
              >
                <span className="shrink-0 text-subtle">{iconFor(entry.name)}</span>
                <span className="min-w-0 truncate text-fg">{entry.name}</span>
                <span className="min-w-0 truncate text-xs text-subtle">{dirnameOf(entry.path)}</span>
              </button>
            ))
          )
        ) : (
          <TreeFolder key={reload} sessionId={props.sessionId} cwd={props.cwd} path="" depth={0} />
        )}
      </div>
    </div>
  );
}

function TreeFolder(props: { sessionId: string; cwd: string; path: string; depth: number }) {
  const controller = useController();
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    let live = true;
    controller
      .listFiles(props.cwd, props.path)
      .then((listing) => {
        if (live) {
          setEntries(listing.entries);
          setTruncated(listing.truncated);
        }
      })
      .catch((failure: unknown) => live && setError(errorMessage(failure)));
    return () => {
      live = false;
    };
  }, [controller, props.cwd, props.path]);
  const indent = { paddingLeft: `${props.depth * 12 + 6}px` };
  if (error) {
    return (
      <p className="py-1 text-xs text-danger-text" style={indent}>
        {error}
      </p>
    );
  }
  if (!entries) {
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-subtle" style={indent}>
        <Spinner size={10} /> Loading
      </div>
    );
  }
  if (entries.length === 0 && props.depth === 0) {
    return <p className="px-3 py-6 text-center text-sm text-muted">This folder is empty.</p>;
  }
  return (
    <div role="group">
      {entries.map((entry) =>
        entry.kind === "dir" ? (
          <TreeDir key={entry.path} {...props} entry={entry} />
        ) : (
          <TreeFile key={entry.path} sessionId={props.sessionId} cwd={props.cwd} entry={entry} depth={props.depth} />
        ),
      )}
      {truncated ? (
        <p className="py-1 text-2xs text-subtle" style={indent}>
          More files here than the tree lists. Find one by name above.
        </p>
      ) : null}
    </div>
  );
}

function TreeDir(props: { sessionId: string; cwd: string; entry: FileEntry; depth: number }) {
  const controller = useController();
  const open = useApp((s) => (s.fileTreeOpen[props.cwd] ?? []).includes(props.entry.path));
  const Icon = open ? FolderOpenIcon : FolderIcon;
  return (
    <div role="treeitem" aria-expanded={open}>
      <button
        type="button"
        onClick={() => controller.toggleTreeFolder(props.cwd, props.entry.path)}
        className={cn(
          "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-sm hover:bg-hover",
          props.entry.name.startsWith(".") ? "text-subtle" : "text-fg",
        )}
        style={{ paddingLeft: `${props.depth * 12 + 4}px` }}
      >
        <CaretRightIcon size={12} className={cn("shrink-0 text-subtle transition-transform duration-150", open && "rotate-90")} />
        <Icon size={14} className="shrink-0 text-subtle" />
        <span className="truncate">{props.entry.name}</span>
      </button>
      {open ? <TreeFolder sessionId={props.sessionId} cwd={props.cwd} path={props.entry.path} depth={props.depth + 1} /> : null}
    </div>
  );
}

function TreeFile(props: { sessionId: string; cwd: string; entry: FileEntry; depth: number }) {
  const controller = useController();
  const current = useApp((s) => s.filePanels[props.sessionId]?.active === props.entry.path);
  return (
    <button
      type="button"
      role="treeitem"
      aria-current={current || undefined}
      onClick={() => controller.openFile(props.sessionId, props.entry.path)}
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-sm hover:bg-hover",
        current ? "bg-active text-fg" : props.entry.name.startsWith(".") ? "text-subtle" : "text-fg",
      )}
      style={{ paddingLeft: `${props.depth * 12 + 22}px` }}
    >
      <span className="shrink-0 text-subtle">{iconFor(props.entry.name)}</span>
      <span className="min-w-0 flex-1 truncate">{props.entry.name}</span>
      <span className="shrink-0 text-2xs text-subtle tabular-nums">{formatFileSize(props.entry.size)}</span>
    </button>
  );
}

// ---------------------------------------------------------------- one file

function FileView(props: { sessionId: string; cwd: string; path: string; line: LineRange | null }) {
  const controller = useController();
  const key = fileKey(props.cwd, props.path);
  const version = useApp((s) => s.fileVersions[key] ?? 0);
  const draft = useApp((s) => s.fileDrafts[key] ?? null);
  const saving = useApp((s) => Boolean(s.busy[`save:${key}`]));
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<{
    message: string;
    kind: string | null;
  } | null>(null);
  const markdown = isMarkdownPath(props.path);
  // Markdown opens as a preview unless there is an unsaved edit to get back to.
  const [source, setSource] = useState(() => !markdown || draft !== null);

  useEffect(() => {
    let live = true;
    setError(null);
    controller
      .readFile(props.cwd, props.path)
      .then((next) => live && setFile(next))
      .catch(
        (failure: unknown) =>
          live &&
          setError({
            message: errorMessage(failure),
            kind: errorKind(failure),
          }),
      );
    return () => {
      live = false;
    };
    // `version` moves when Muse edits the file or it is saved here, so the view reloads.
  }, [controller, props.cwd, props.path, version]);

  const save = () => void controller.saveFile(props.cwd, props.path);
  const links = useMemo<FileLinks>(
    () => ({
      resolve: (href) => fileTarget(href, props.cwd, dirnameOf(props.path)),
      open: (target) => controller.openFile(props.sessionId, target.path, target.line),
      imageUrl: (src) => {
        const target = fileTarget(src, props.cwd, dirnameOf(props.path));
        return target ? controller.fileUrl(props.cwd, target.path) : null;
      },
    }),
    [controller, props.cwd, props.path, props.sessionId],
  );

  const crumbs = props.path.split("/");
  const editable = markdown && file?.kind === "markdown" && !file.truncated;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-3">
        <nav aria-label="Path" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs text-subtle">
          {crumbs.map((crumb, index) => (
            <span
              key={index}
              className={cn("flex min-w-0 items-center gap-1", index === crumbs.length - 1 ? "shrink-0 text-fg" : "truncate")}
            >
              {index > 0 ? <span className="text-line-strong">/</span> : null}
              <span className="truncate">{crumb}</span>
            </span>
          ))}
        </nav>
        {draft ? (
          <Button size="sm" variant="accent" className="h-6 px-2 text-xs" loading={saving} onClick={save}>
            Save
          </Button>
        ) : null}
        {editable ? (
          <div role="radiogroup" aria-label="View" className="flex items-center rounded-md bg-sunken p-0.5">
            <ModeButton label="Preview" active={!source} onClick={() => setSource(false)}>
              <EyeIcon size={13} />
            </ModeButton>
            <ModeButton label="Source" active={source} onClick={() => setSource(true)}>
              <CodeIcon size={13} />
            </ModeButton>
          </div>
        ) : null}
        {file && file.kind !== "text" && file.kind !== "markdown" ? (
          <Tip label="Open in the default app">
            <IconButton size="sm" label="Open in the default app" onClick={() => void controller.openFileExternally(props.cwd, props.path)}>
              <ArrowSquareOutIcon size={13} />
            </IconButton>
          </Tip>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <FileProblem
            title={error.kind === null && /does not exist/.test(error.message) ? "This file is not there" : "Could not open this file"}
            detail={error.message}
            onRetry={() =>
              controller.store.set((s) => ({
                ...s,
                fileVersions: { ...s.fileVersions, [key]: version + 1 },
              }))
            }
          />
        ) : !file ? (
          <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted">
            <Spinner size={13} /> Opening
          </div>
        ) : (
          <FileBody
            file={file}
            cwd={props.cwd}
            line={props.line}
            source={source}
            draft={draft?.content ?? null}
            links={links}
            onEdit={(content) => controller.setFileDraft(props.cwd, props.path, content === file.content ? null : content, file.mtimeMs)}
            onSave={save}
          />
        )}
      </div>
    </div>
  );
}

function ModeButton(props: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tip label={props.label}>
      <button
        type="button"
        role="radio"
        aria-checked={props.active}
        aria-label={props.label}
        onClick={props.onClick}
        className={cn(
          "flex h-5 w-6 items-center justify-center rounded transition-colors duration-100",
          props.active ? "bg-raised text-fg shadow-btn" : "text-subtle hover:text-fg",
        )}
      >
        {props.children}
      </button>
    </Tip>
  );
}

function FileProblem(props: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-fg">{props.title}</p>
      <p className="max-w-[46ch] text-xs text-pretty text-muted">{props.detail}</p>
      {props.onRetry ? (
        <Button size="sm" variant="ghost" onClick={props.onRetry}>
          <ArrowsClockwiseIcon size={13} /> Try again
        </Button>
      ) : null}
    </div>
  );
}

function FileBody(props: {
  file: FileContent;
  cwd: string;
  line: LineRange | null;
  source: boolean;
  draft: string | null;
  links: FileLinks;
  onEdit: (content: string) => void;
  onSave: () => void;
}) {
  const controller = useController();
  const { file } = props;
  const url = controller.fileUrl(props.cwd, file.path);
  switch (file.kind) {
    case "markdown":
      if (props.source) {
        return file.truncated ? (
          <SourceView text={file.content ?? ""} path={file.path} line={props.line} truncated />
        ) : (
          <SourceEditor value={props.draft ?? file.content ?? ""} onChange={props.onEdit} onSave={props.onSave} />
        );
      }
      return (
        <div className="px-6 py-5">
          <FileLinksContext.Provider value={props.links}>
            <Markdown text={props.draft ?? file.content ?? ""} className="mx-auto max-w-[72ch]" />
          </FileLinksContext.Provider>
        </div>
      );
    case "text":
      return <SourceView text={file.content ?? ""} path={file.path} line={props.line} truncated={file.truncated} />;
    case "image":
      return (
        <div className="file-checker flex min-h-full items-center justify-center p-6">
          <img src={url} alt={file.name} className="max-h-full max-w-full object-contain shadow-card" />
        </div>
      );
    case "video":
      return (
        <div className="flex min-h-full items-center justify-center bg-black p-4">
          <video src={url} controls preload="metadata" className="max-h-full max-w-full" />
        </div>
      );
    case "audio":
      return (
        <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6">
          <FileAudioIcon size={28} className="text-subtle" />
          <audio src={url} controls preload="metadata" className="w-full max-w-md" />
        </div>
      );
    case "pdf":
      return <iframe src={url} title={file.name} className="h-full w-full border-0 bg-white" />;
    default:
      return (
        <FileProblem
          title="No preview for this file"
          detail={`${file.name} is a ${formatFileSize(file.size)} binary file. Open it in the app your system uses for it.`}
        />
      );
  }
}

/** Source with line numbers and colour, scrolled to and marking the lines a link pointed at. */
function SourceView(props: { text: string; path: string; line: LineRange | null; truncated?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [wrap, setWrap] = useState(false);
  const html = useMemo(() => {
    const language = languageFromPath(props.path);
    // A file's final newline ends its last line; it is not a line of its own.
    const text = props.text.endsWith("\n") ? props.text.slice(0, -1) : props.text;
    if (language && text.length <= HIGHLIGHT_LIMIT) {
      try {
        // Each line is already a block, so the newlines between them would render as blank lines inside <pre>.
        return highlight(text).replace(/<\/span>\n<span class="sh__line">/g, '</span><span class="sh__line">');
      } catch {
        /* falls through to plain lines */
      }
    }
    return text
      .split("\n")
      .map((line) => `<span class="sh__line">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>`)
      .join("");
  }, [props.text, props.path]);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) {
      return;
    }
    const lines = root.querySelectorAll<HTMLElement>(".sh__line");
    lines.forEach((node) => node.removeAttribute("data-marked"));
    if (!props.line) {
      return;
    }
    for (let index = props.line.start - 1; index < Math.min(props.line.end, lines.length); index += 1) {
      lines[index]?.setAttribute("data-marked", "");
    }
    lines[props.line.start - 1]?.scrollIntoView({ block: "center" });
  }, [html, props.line]);
  return (
    <div className="relative min-h-full">
      <div className="sticky top-0 z-[1] flex justify-end px-2 pt-1.5">
        <button
          type="button"
          onClick={() => setWrap((v) => !v)}
          aria-pressed={wrap}
          className="rounded bg-sunken/90 px-1.5 py-0.5 text-2xs text-subtle backdrop-blur hover:text-fg"
        >
          {wrap ? "No wrap" : "Wrap"}
        </button>
      </div>
      <pre className="-mt-6 overflow-x-auto pt-1 pb-6">
        <code ref={ref} className={cn("file-code block font-mono", wrap && "wrap")} dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      {props.truncated ? (
        <p className="border-t border-line px-4 py-2 text-xs text-subtle">This file is large, so only its start is shown.</p>
      ) : null}
    </div>
  );
}

/** Markdown source, editable. Cmd/Ctrl+S saves; Tab indents instead of leaving the editor. */
function SourceEditor(props: { value: string; onChange: (value: string) => void; onSave: () => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = navigator.platform.toLowerCase().includes("mac") ? event.metaKey : event.ctrlKey;
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      props.onSave();
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && !mod && !event.altKey) {
      event.preventDefault();
      const target = event.currentTarget;
      const { selectionStart, selectionEnd, value } = target;
      const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      props.onChange(next);
      requestAnimationFrame(() => target.setSelectionRange(selectionStart + 2, selectionStart + 2));
    }
  };
  return (
    <textarea
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={onKeyDown}
      spellCheck={false}
      aria-label="Markdown source"
      className="block h-full min-h-full w-full resize-none bg-bg px-5 py-4 font-mono text-[12.5px] leading-[1.6] text-fg outline-none"
    />
  );
}
