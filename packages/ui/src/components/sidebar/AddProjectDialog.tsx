import { ArrowElbowLeftUpIcon, ArrowLeftIcon, FolderIcon, FolderPlusIcon, LinkIcon, TerminalWindowIcon } from "../ui/icons.js";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useApp, useController } from "../../app/context.js";
import { useImeGuard } from "../../app/ime.js";
import { errorMessage } from "../../client.js";
import { cloneUrl, isFullPath, isSshPath, parentFolder, parseSshHost, repoName, sameFolder, splitBrowsePath, withTrailingSeparator } from "../../model/paths.js";
import type { DirectoryListing } from "../../types.js";
import { Modal } from "../ui/overlays.js";
import { Kbd, MOD, Spinner, cn } from "../ui/primitives.js";

type Provider = "git" | "github";

type SourceId = "local" | "ssh" | Provider;

type View =
  | { kind: "sources" }
  | { kind: "browse"; initial?: string }
  | { kind: "remote"; provider: Provider }
  | { kind: "ssh" }
  | { kind: "destination"; url: string; name: string };

const INPUT = "h-11 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle";

/**
 * Add a project: pick a source, then type or browse to a folder.
 * via T3 Code's add-project picker (github.com/pingdotgg/t3code), MIT (c) 2026 T3 Tools Inc.
 * Adapted: the box always holds a full path and the text after its last separator filters that
 * folder's subfolders; Enter adds the typed path unless a row is highlighted, which Enter opens.
 */
export function AddProjectDialog() {
  const controller = useController();
  const open = useApp((s) => s.addProjectOpen);
  return (
    <Modal
      open={open}
      onOpenChange={(next) => controller.setAddProjectOpen(next)}
      title="Add a project"
      hideTitle
      bare
      className="top-[12vh] w-[min(640px,calc(100vw-32px))] overflow-hidden"
    >
      {open ? <ProjectPicker /> : null}
    </Modal>
  );
}

function ProjectPicker() {
  const projects = useApp((s) => s.projects);
  const [view, setView] = useState<View>({ kind: "sources" });
  // Browsing starts next to the most recent local project; SSH projects live on
  // another machine, so they never seed the local browse start or clone target.
  const [base] = useState(() => {
    const local = projects.find((p) => !isSshPath(p.cwd));
    return (local ? parentFolder(local.cwd) : null) ?? "~/";
  });
  const clone = (url: string) => setView({ kind: "destination", url, name: repoName(url) });
  if (view.kind === "sources") {
    return (
      <Sources
        onPick={(id) => setView(id === "local" ? { kind: "browse" } : id === "ssh" ? { kind: "ssh" } : { kind: "remote", provider: id })}
        onPath={(path) => setView({ kind: "browse", initial: path })}
        onClone={clone}
      />
    );
  }
  if (view.kind === "remote") {
    return <RemoteInput provider={view.provider} onBack={() => setView({ kind: "sources" })} onContinue={clone} />;
  }
  if (view.kind === "ssh") {
    return (
      <SshInput
        onBack={() => setView({ kind: "sources" })}
        onContinue={(host) => setView({ kind: "browse", initial: `ssh://${host}/~/` })}
      />
    );
  }
  if (view.kind === "destination") {
    return <FolderBrowser key="destination" initial={`${base}${view.name}`} clone={view.url} onBack={() => setView({ kind: "sources" })} />;
  }
  return <FolderBrowser key="browse" initial={view.initial ?? base} clone={null} onBack={() => setView({ kind: "sources" })} />;
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="currentColor">
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

const SOURCES: { id: SourceId; label: string; description: string; icon: ReactNode }[] = [
  { id: "local", label: "Local folder", description: "Browse a folder on disk", icon: <FolderPlusIcon size={17} /> },
  { id: "ssh", label: "SSH host", description: "Browse folders on a remote host", icon: <TerminalWindowIcon size={17} /> },
  { id: "git", label: "Git URL", description: "Clone from a remote URL", icon: <LinkIcon size={17} /> },
  { id: "github", label: "GitHub repository", description: "Clone GitHub owner/repo", icon: <GitHubMark /> },
];

/**
 * The first step takes a folder path or a Git URL directly: a full path switches straight to
 * browsing, a URL or `owner/repo` offers to clone, and the source rows cover the rest.
 */
function Sources(props: { onPick: (id: SourceId) => void; onPath: (path: string) => void; onClone: (url: string) => void }) {
  const ime = useImeGuard();
  const windows = useApp((s) => s.env?.platform === "win32");
  // SSH projects run `ssh` where the server runs; without a client the option would only fail later.
  const sshMissing = useApp((s) => s.env?.sshFound === false);
  const [value, setValue] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const url = value.trim() ? cloneUrl(value) : null;
  const rows: { id: SourceId | "clone"; label: string; description: string; icon: ReactNode }[] = url
    ? [{ id: "clone", label: `Clone ${url}`, description: "Next, pick where to clone it", icon: <LinkIcon size={17} /> }]
    : SOURCES.filter((source) => !(sshMissing && source.id === "ssh"));
  const active = Math.min(highlight, rows.length - 1);
  const pick = (id: (typeof rows)[number]["id"]) => {
    if (id === "clone") {
      if (url) {
        props.onClone(url);
      }
    } else {
      props.onPick(id);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (ime.isImeKey(event)) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight(Math.min(rows.length - 1, active + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(Math.max(0, active - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[active];
      if (row) {
        pick(row.id);
      }
    }
  };
  return (
    <>
      <Header icon={<FolderPlusIcon size={17} />}>
        <input
          autoFocus
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder={windows ? "Type a folder path like D:\\Projects, or paste a Git URL" : "Type a folder path like ~/code, or paste a Git URL"}
          aria-label="Folder path or Git URL"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={rows[active] ? `${listId}-${rows[active]?.id}` : undefined}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (isFullPath(next)) {
              props.onPath(next);
              return;
            }
            setValue(next);
            setHighlight(0);
          }}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyUp={ime.onKeyUp}
          onKeyDown={onKeyDown}
          className={INPUT}
        />
      </Header>
      <div className="p-1.5">
        <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-subtle">{url ? "Repository" : "Sources"}</p>
        <ul id={listId} role="listbox" aria-label={url ? "Repository" : "Sources"}>
          {rows.map((row, index) => (
            <li
              key={row.id}
              id={`${listId}-${row.id}`}
              role="option"
              aria-selected={index === active}
              onMouseMove={() => setHighlight(index)}
              onClick={() => pick(row.id)}
              className={cn("flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2", index === active && "bg-hover")}
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-muted">{row.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{row.label}</span>
                <span className="block text-xs text-muted">{row.description}</span>
              </span>
            </li>
          ))}
        </ul>
        {value.trim() && !url ? (
          <p className="px-2.5 py-2 text-xs text-muted">
            {windows ? "Start with a drive like D:\\ or with ~/ to browse folders." : "Start with / or ~/ to browse folders."}
          </p>
        ) : null}
      </div>
      <Footer
        hints={[
          { keys: ["↑", "↓"], label: "Navigate" },
          { keys: ["Enter"], label: "Select" },
          { keys: ["Esc"], label: "Close" },
        ]}
      />
    </>
  );
}

function RemoteInput(props: { provider: Provider; onBack: () => void; onContinue: (url: string) => void }) {
  const ime = useImeGuard();
  const [value, setValue] = useState("");
  const [tried, setTried] = useState(false);
  const url = cloneUrl(value);
  const github = props.provider === "github";
  const submit = () => {
    setTried(true);
    if (url) {
      props.onContinue(url);
    }
  };
  return (
    <>
      <Header onBack={props.onBack} action={<ActionButton label="Continue" keys={["Enter"]} disabled={!url} onClick={submit} />}>
        <input
          autoFocus
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-label={github ? "GitHub repository" : "Git URL"}
          placeholder={github ? "owner/repo" : "https://github.com/owner/repo.git"}
          onChange={(event) => setValue(event.currentTarget.value)}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyUp={ime.onKeyUp}
          onKeyDown={(event) => {
            if (ime.isImeKey(event)) {
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Backspace" && value === "") {
              event.preventDefault();
              props.onBack();
            }
          }}
          className={INPUT}
        />
      </Header>
      <div className="px-4 py-5 text-sm">
        {tried && !url ? (
          <p className="text-danger-text">{github ? "Type the repository as owner/repo." : "That does not look like a Git URL or owner/repo."}</p>
        ) : (
          <p className="text-muted">
            {github
              ? "Type the repository as owner/repo. Private repositories use your Git credentials."
              : "Paste an HTTPS or SSH URL, or GitHub owner/repo. Next, pick where to clone it."}
          </p>
        )}
        {url ? <p className="mt-1.5 truncate font-mono text-xs text-subtle">{url}</p> : null}
      </div>
      <Footer
        hints={[
          { keys: ["Enter"], label: "Continue" },
          { keys: ["Backspace"], label: "Back" },
          { keys: ["Esc"], label: "Close" },
        ]}
      />
    </>
  );
}

function SshInput(props: { onBack: () => void; onContinue: (host: string) => void }) {
  const ime = useImeGuard();
  const windows = useApp((s) => s.env?.platform === "win32");
  const [value, setValue] = useState("");
  const [tried, setTried] = useState(false);
  const host = parseSshHost(value);
  const submit = () => {
    setTried(true);
    if (host) {
      props.onContinue(host);
    }
  };
  return (
    <>
      <Header onBack={props.onBack} action={<ActionButton label="Continue" keys={["Enter"]} disabled={!host} onClick={submit} />}>
        <input
          autoFocus
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-label="SSH hostname"
          placeholder="devbox.example.com or deploy@db1"
          onChange={(event) => setValue(event.currentTarget.value)}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyUp={ime.onKeyUp}
          onKeyDown={(event) => {
            if (ime.isImeKey(event)) {
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Backspace" && value === "") {
              event.preventDefault();
              props.onBack();
            }
          }}
          className={INPUT}
        />
      </Header>
      <div className="px-4 py-5 text-sm">
        {tried && !host ? (
          <p className="text-danger-text">That does not look like a hostname. Use host or user@host.</p>
        ) : (
          <p className="text-muted">
            Passwordless SSH only: <span className="font-mono">ssh {value.trim() || "<host>"}</span> must already work without
            a password. Port and key come from your SSH config.
            {windows ? (
              <>
                {" "}
                Muse Code GUI uses Windows' own <span className="font-mono">ssh.exe</span>, so keys and config come from{" "}
                <span className="font-mono">%USERPROFILE%\.ssh</span>, not from WSL.
              </>
            ) : null}
          </p>
        )}
        {host ? <p className="mt-1.5 truncate font-mono text-xs text-subtle">ssh://{host}/</p> : null}
      </div>
      <Footer
        hints={[
          { keys: ["Enter"], label: "Continue" },
          { keys: ["Backspace"], label: "Back" },
          { keys: ["Esc"], label: "Close" },
        ]}
      />
    </>
  );
}

type Row = { kind: "up"; path: string } | { kind: "folder"; name: string };

/** Lists one folder, remembering every folder already listed while the picker is open. */
function useListing(directory: string): { data: DirectoryListing | null; error: string | null; loading: boolean } {
  const controller = useController();
  const cache = useRef(new Map<string, DirectoryListing>());
  const [state, setState] = useState<{ key: string; data: DirectoryListing | null; error: string | null }>({ key: "", data: null, error: null });
  useEffect(() => {
    if (!directory) {
      return;
    }
    const cached = cache.current.get(directory);
    if (cached) {
      setState({ key: directory, data: cached, error: null });
      return;
    }
    let live = true;
    controller.listDirectory(directory).then(
      (data) => {
        cache.current.set(directory, data);
        if (live) {
          setState({ key: directory, data, error: null });
        }
      },
      (error: unknown) => {
        if (live) {
          setState({ key: directory, data: null, error: errorMessage(error) });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [directory, controller]);
  const current = state.key === directory;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: Boolean(directory) && !current };
}

function FolderBrowser(props: { initial: string; clone: string | null; onBack: () => void }) {
  const ime = useImeGuard();
  const controller = useController();
  const projects = useApp((s) => s.projects);
  const platform = useApp((s) => s.env?.platform ?? "");
  const busy = useApp((s) => Boolean(s.busy[props.clone ? "cloneProject" : "addProject"]));
  const [input, setInput] = useState(props.initial);
  const [highlight, setHighlight] = useState(-1);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const windows = platform === "win32";
  const { directory, leaf, separator } = splitBrowsePath(input);
  const browsing = isFullPath(input);
  const listing = useListing(browsing ? directory : "");
  const data = listing.data;

  const rows = useMemo<Row[]>(() => {
    if (!data) {
      return [];
    }
    const needle = leaf.toLowerCase();
    const folders = data.entries
      .filter((entry) => (leaf.startsWith(".") || !entry.name.startsWith(".")) && entry.name.toLowerCase().startsWith(needle))
      .map((entry): Row => ({ kind: "folder", name: entry.name }));
    return data.parent && !leaf ? [{ kind: "up", path: withTrailingSeparator(data.parent, data.separator) }, ...folders] : folders;
  }, [data, leaf]);

  // What Enter acts on: the listed folder itself, or the child the filter names, existing or not.
  const target = useMemo(() => {
    if (!data) {
      return null;
    }
    if (!leaf) {
      return { path: data.directory, exists: data.exists };
    }
    const match = data.entries.find((entry) => (windows ? entry.name.toLowerCase() === leaf.toLowerCase() : entry.name === leaf));
    return { path: withTrailingSeparator(data.directory, data.separator) + (match?.name ?? leaf), exists: Boolean(match) };
  }, [data, leaf, windows]);

  const existing = !props.clone && target ? (projects.find((p) => sameFolder(p.cwd, target.path)) ?? null) : null;

  // Typing carries on where it left off when the first step hands over a path.
  useEffect(() => {
    const element = inputRef.current;
    if (element) {
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }, []);

  useEffect(() => {
    if (highlight >= rows.length) {
      setHighlight(rows.length - 1);
    }
  }, [rows.length, highlight]);

  useEffect(() => {
    if (highlight >= 0) {
      listRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }, [highlight]);

  const openRow = (row: Row) => {
    setInput(row.kind === "up" ? row.path : `${directory}${row.name}${separator}`);
    setHighlight(-1);
    inputRef.current?.focus();
  };

  const submit = () => {
    if (!target || busy) {
      return;
    }
    if (props.clone) {
      void controller.cloneProject(props.clone, target.path);
    } else if (existing) {
      controller.setAddProjectOpen(false);
      controller.newThread(existing.cwd);
    } else {
      void controller.addProject(target.path, { create: !target.exists });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (ime.isImeKey(event)) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(rows.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(-1, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = highlight >= 0 ? rows[highlight] : undefined;
      if (row && !(event.metaKey || event.ctrlKey)) {
        openRow(row);
      } else {
        submit();
      }
    } else if (event.key === "Tab" && !event.shiftKey) {
      // Tab completes into the highlighted folder, or the first one the filter matches.
      const row = highlight >= 0 ? rows[highlight] : leaf ? rows.find((r) => r.kind === "folder") : undefined;
      if (row) {
        event.preventDefault();
        openRow(row);
      }
    } else if (event.key === "Backspace" && input === "") {
      event.preventDefault();
      props.onBack();
    }
  };

  const action = props.clone ? "Clone" : existing ? "Open" : target && !target.exists ? "Create & Add" : "Add";
  const highlighted = highlight >= 0;
  const reveal = windows ? "Open in File Explorer" : platform === "darwin" ? "Open in Finder" : "Open in Files";

  let note: ReactNode = null;
  if (!browsing) {
    note = windows ? "Type a full path, like D:\\Projects or ~/code." : "Type a full path, like ~/code or /srv/app.";
  } else if (listing.error) {
    note = <span className="text-danger-text">{listing.error}</span>;
  } else if (listing.loading) {
    note = (
      <span className="flex items-center gap-2">
        <Spinner size={12} /> Loading folders
      </span>
    );
  } else if (data && !data.exists) {
    note = props.clone ? "This folder does not exist yet. Cloning creates it." : "This folder does not exist yet. Press Enter to create it and add it.";
  } else if (data && rows.length === 0) {
    note = leaf
      ? props.clone
        ? `Cloning creates ${leaf} here.`
        : `No folder starts with “${leaf}”. Press Enter to create it.`
      : "No folders here.";
  }

  return (
    <>
      <Header
        onBack={props.onBack}
        action={<ActionButton label={action} keys={highlighted ? [MOD, "Enter"] : ["Enter"]} busy={busy} disabled={!target} onClick={submit} />}
      >
        <input
          ref={inputRef}
          autoFocus
          value={input}
          spellCheck={false}
          autoComplete="off"
          aria-label={props.clone ? "Folder to clone into" : "Folder path"}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlighted ? `${listId}-${highlight}` : undefined}
          placeholder={windows ? "D:\\Projects\\my-app" : "~/code/my-app"}
          onChange={(event) => {
            setInput(event.currentTarget.value);
            setHighlight(-1);
          }}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyUp={ime.onKeyUp}
          onKeyDown={onKeyDown}
          className={INPUT}
        />
      </Header>
      <div className="h-[min(22rem,55vh)] overflow-y-auto p-1.5">
        <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-subtle">{props.clone ? "Clone into" : "Folders"}</p>
        <ul ref={listRef} id={listId} role="listbox" aria-label="Folders">
          {rows.map((row, index) => (
            <li
              key={row.kind === "up" ? ".." : row.name}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === highlight}
              onMouseMove={() => setHighlight(index)}
              onClick={() => openRow(row)}
              className={cn("flex h-9 cursor-default items-center gap-3 rounded-lg px-2.5 text-sm text-fg", index === highlight && "bg-hover")}
            >
              {row.kind === "up" ? (
                <>
                  <ArrowElbowLeftUpIcon size={16} className="shrink-0 text-muted" />
                  <span className="text-muted">..</span>
                </>
              ) : (
                <>
                  <FolderIcon size={16} className="shrink-0 text-muted" />
                  <span className="truncate">
                    <span className="font-semibold">{row.name.slice(0, leaf.length)}</span>
                    {row.name.slice(leaf.length)}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        {note ? <p className="px-2.5 py-3 text-sm text-muted">{note}</p> : null}
      </div>
      <Footer
        hints={[
          { keys: ["↑", "↓"], label: "Navigate" },
          { keys: ["Enter"], label: highlighted ? "Open folder" : action },
          { keys: ["Backspace"], label: "Back" },
          { keys: ["Esc"], label: "Close" },
        ]}
        right={
          data?.exists && !data.directory.startsWith("ssh://") ? (
            <button
              type="button"
              onClick={() => void controller.revealPath(data.directory)}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              {reveal}
            </button>
          ) : null
        }
      />
    </>
  );
}

function Header(props: { onBack?: () => void; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-line pr-3 pl-2">
      {/* The leading slot is the same width in every step, so the input never jumps between them. */}
      {props.icon && !props.onBack ? (
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center text-subtle">
          {props.icon}
        </span>
      ) : props.onBack ? (
        <button
          type="button"
          aria-label="Back"
          onClick={props.onBack}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <ArrowLeftIcon size={17} />
        </button>
      ) : (
        <span className="w-2" />
      )}
      {props.children}
      {props.action}
    </div>
  );
}

function ActionButton(props: { label: string; keys: string[]; onClick: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled || props.busy}
      className="flex h-8 shrink-0 items-stretch overflow-hidden rounded-lg text-xs font-medium shadow-btn transition-opacity disabled:opacity-50"
    >
      <span className="flex items-center gap-1.5 bg-raised px-2.5 text-fg">
        {props.busy ? <Spinner size={11} /> : null}
        {props.label}
      </span>
      <span className="flex items-center border-l border-line bg-sunken px-2 text-muted">{props.keys.join(" ")}</span>
    </button>
  );
}

function Footer(props: { hints: { keys: string[]; label: string }[]; right?: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-sunken px-4 py-2 text-xs text-muted">
      {props.hints.map((hint) => (
        <span key={hint.label} className="flex items-center gap-1.5">
          <span className="flex gap-0.5">
            {hint.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
          {hint.label}
        </span>
      ))}
      <span className="flex-1" />
      {props.right}
    </div>
  );
}
