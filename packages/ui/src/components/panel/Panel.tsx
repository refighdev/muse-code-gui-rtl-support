import { ArchiveIcon, ArrowsInIcon, ChartBarIcon, ClockCounterClockwiseIcon, DotsThreeIcon, GearSixIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, XIcon } from "../ui/icons.js";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { useImeGuard } from "../../app/ime.js";
import { postToHost } from "../../app/host.js";
import { inFolder, usePanel } from "../../app/panel.js";
import { basename, relativeTime } from "../../model/format.js";
import { STATUS_LABEL, threadStatus, type ThreadStatus } from "../../model/status.js";
import type { SessionSummary } from "../../types.js";
import { Composer, ComposerFooter } from "../composer/Composer.js";
import { BootError, BootScreen, HostErrorCard, Onboarding } from "../home/Home.js";
import { SettingsPage } from "../settings/SettingsPage.js";
import { ThreadView } from "../thread/ThreadView.js";
import { UsagePage } from "../usage/UsagePage.js";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Modal, Sheet, Tip } from "../ui/overlays.js";
import { Button, IconButton, Logo, cn } from "../ui/primitives.js";
import { StatusGlyph } from "../ui/StatusGlyph.js";

/** How many threads stay open as tabs; opening one more closes the one used longest ago. */
const MAX_TABS = 8;

/**
 * Muse Code GUI for a narrow side panel, such as an editor extension's view: one folder, the threads
 * open in it as tabs across the top, and every earlier thread one click away in History.
 */
export function PanelShell() {
  const panel = usePanel();
  const cwd = panel?.cwd ?? null;
  const route = useApp((s) => s.route);
  const loaded = useApp((s) => s.sessionsLoaded);
  const boot = useApp((s) => s.boot);
  const env = useApp((s) => s.env);
  const [historyOpen, setHistoryOpen] = useState(false);
  const tabs = usePanelTabs(cwd);
  let body = null;
  // The same setup and error screens the app shows, sized for the panel. Without them a missing muse CLI or a
  // server that never answered leaves the panel blank, since sessions never load.
  if (!env) {
    body = boot === "error" ? <BootError compact /> : <BootScreen />;
  } else if (!env.museFound) {
    body = <Onboarding compact />;
  } else if (boot === "error") {
    body = <BootError compact />;
  } else if (!loaded) {
    body = null;
  } else if (route.kind === "thread") {
    body = <ThreadView key={route.sessionId} sessionId={route.sessionId} bare />;
  } else if (route.kind === "usage") {
    body = <UsagePage />;
  } else if (route.kind === "settings") {
    body = <SettingsPage />;
  } else if (!cwd) {
    body = <NoFolder />;
  } else {
    body = <PanelNew cwd={cwd} onHistory={() => setHistoryOpen(true)} />;
  }
  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-bg text-fg">
      <PanelHeader tabs={tabs} onHistory={() => setHistoryOpen(true)} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</main>
      <HistorySheet cwd={cwd} open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}

interface PanelTabs {
  ids: string[];
  close: (sessionId: string) => void;
}

/** The open tabs for this folder, kept per folder in local storage so a reload keeps them. */
function usePanelTabs(cwd: string | null): PanelTabs {
  const controller = useController();
  const key = `musegui.panelTabs:${cwd ?? ""}`;
  const [ids, setIds] = useState<string[]>(() => readTabs(key));
  const activeId = useApp((s) => (s.route.kind === "thread" ? s.route.sessionId : null));
  const sessions = useApp((s) => s.sessions);
  const loaded = useApp((s) => s.sessionsLoaded);

  // Opening a thread from anywhere (history, a notification, the composer) gives it a tab.
  useEffect(() => {
    if (!activeId) {
      return;
    }
    setIds((current) => {
      if (current.includes(activeId)) {
        return current;
      }
      const next = [...current, activeId];
      return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next;
    });
  }, [activeId]);

  // Archived or removed threads lose their tab once the session list is in.
  useEffect(() => {
    if (loaded) {
      setIds((current) => {
        const kept = current.filter((id) => sessions[id] && !sessions[id]?.archived);
        return kept.length === current.length ? current : kept;
      });
    }
  }, [loaded, sessions]);

  // Coming back to the panel lands on the last thread that was open, not an empty composer.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !loaded) {
      return;
    }
    restored.current = true;
    const last = ids[ids.length - 1];
    if (!activeId && last && sessions[last]) {
      controller.openThread(last);
    }
  }, [loaded, ids, activeId, sessions, controller]);

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      /* storage can be off in some webviews; tabs then last for the session only */
    }
  }, [key, ids]);

  const close = (sessionId: string) => {
    const index = ids.indexOf(sessionId);
    const next = ids.filter((id) => id !== sessionId);
    setIds(next);
    if (sessionId === activeId) {
      const neighbour = next[Math.min(index, next.length - 1)];
      if (neighbour) {
        controller.openThread(neighbour);
      } else {
        controller.newThread(cwd);
      }
    }
  };
  return { ids, close };
}

function readTabs(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(-MAX_TABS) : [];
  } catch {
    return [];
  }
}

/** Status for a list of threads, computed the way the full app's sidebar does it. */
function useStatuses(sessions: SessionSummary[]): Record<string, ThreadStatus> {
  const threads = useApp((s) => s.threads);
  const lastSeen = useApp((s) => s.prefs.lastSeen);
  const baseline = useApp((s) => s.prefs.baseline);
  const activeId = useApp((s) => (s.route.kind === "thread" ? s.route.sessionId : null));
  return useMemo(() => {
    const out: Record<string, ThreadStatus> = {};
    for (const session of sessions) {
      out[session.sessionId] = threadStatus(session, {
        fold: threads[session.sessionId]?.fold ?? null,
        lastSeen: lastSeen[session.sessionId] ?? null,
        baseline,
        active: session.sessionId === activeId,
      });
    }
    return out;
  }, [sessions, threads, lastSeen, baseline, activeId]);
}

function PanelHeader(props: { tabs: PanelTabs; onHistory: () => void }) {
  const controller = useController();
  const panel = usePanel();
  const route = useApp((s) => s.route);
  const sessionsById = useApp((s) => s.sessions);
  const activeId = route.kind === "thread" ? route.sessionId : null;
  const open = useMemo(
    () => props.tabs.ids.map((id) => sessionsById[id]).filter((s): s is SessionSummary => Boolean(s)),
    [props.tabs.ids, sessionsById],
  );
  const statuses = useStatuses(open);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the active tab in view when the strip overflows.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, route.kind]);

  const onTabsKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    const tabs = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const at = tabs.indexOf(document.activeElement as HTMLElement);
    const next = tabs[(at + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const active = activeId ? sessionsById[activeId] ?? null : null;
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  return (
    <header className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-1">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Open threads"
        onKeyDown={onTabsKey}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {open.map((session) => (
          <Tab
            key={session.sessionId}
            session={session}
            status={statuses[session.sessionId] ?? "idle"}
            active={session.sessionId === activeId}
            onOpen={() => controller.openThread(session.sessionId)}
            onClose={() => props.tabs.close(session.sessionId)}
          />
        ))}
        {route.kind === "new" || route.kind === "home" ? (
          <span
            role="tab"
            aria-selected="true"
            tabIndex={0}
            className="flex h-7 shrink-0 items-center rounded-md bg-active px-2 text-xs font-medium text-fg"
          >
            New thread
          </span>
        ) : null}
      </div>
      <Tip label="New thread">
        <IconButton size="xs" label="New thread" onClick={() => controller.newThread(panel?.cwd ?? null)}>
          <PlusIcon size={14} />
        </IconButton>
      </Tip>
      <Tip label="History">
        <IconButton size="xs" label="History" onClick={props.onHistory}>
          <ClockCounterClockwiseIcon size={14} />
        </IconButton>
      </Tip>
      <Menu>
        <Tip label="More">
          <MenuTrigger asChild>
            <IconButton size="xs" label="More actions">
              <DotsThreeIcon size={15} />
            </IconButton>
          </MenuTrigger>
        </Tip>
        <MenuContent align="end">
          {active ? (
            <>
              <MenuItem icon={<PencilSimpleIcon size={14} />} onSelect={() => setRenaming(active)}>
                Rename thread
              </MenuItem>
              <MenuItem icon={<ArrowsInIcon size={14} />} onSelect={() => void controller.compact(active.sessionId)}>
                Compact context
              </MenuItem>
              <MenuItem icon={<ArchiveIcon size={14} />} onSelect={() => void controller.archive(active.sessionId)}>
                Archive thread
              </MenuItem>
              <MenuSeparator />
            </>
          ) : null}
          <MenuItem icon={<ChartBarIcon size={14} />} onSelect={() => controller.navigate({ kind: "usage" })}>
            Usage and cost
          </MenuItem>
          <MenuItem icon={<GearSixIcon size={14} />} onSelect={() => controller.navigate({ kind: "settings" })}>
            Settings
          </MenuItem>
        </MenuContent>
      </Menu>
      <RenameDialog session={renaming} onClose={() => setRenaming(null)} />
    </header>
  );
}

/** A dialog, not `window.prompt`: editor webviews block native prompts. */
function RenameDialog(props: { session: SessionSummary | null; onClose: () => void }) {
  const controller = useController();
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (props.session) {
      setTitle(props.session.title);
    }
  }, [props.session]);
  const session = props.session;
  const save = () => {
    const next = title.trim();
    if (session && next && next !== session.title) {
      void controller.rename(session.sessionId, next);
    }
    props.onClose();
  };
  return (
    <Modal open={session !== null} onOpenChange={(open) => (open ? undefined : props.onClose())} title="Rename thread" className="top-[12vh] w-[min(420px,calc(100%-24px))]">
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          autoFocus
          aria-label="Thread title"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="h-8 rounded-md bg-sunken px-2 text-sm text-fg outline-none focus:shadow-[0_0_0_1.5px_var(--accent)]"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="accent" type="submit">
            Rename
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Tab(props: { session: SessionSummary; status: ThreadStatus; active: boolean; onOpen: () => void; onClose: () => void }) {
  const { session, status, active } = props;
  const onAux = (event: MouseEvent) => {
    // Middle click closes, as in editor tabs.
    if (event.button === 1) {
      event.preventDefault();
      props.onClose();
    }
  };
  return (
    <div
      className={cn(
        "group flex h-7 max-w-[11rem] min-w-[4.5rem] flex-1 basis-0 items-center rounded-md transition-colors duration-100",
        active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        onClick={props.onOpen}
        onAuxClick={onAux}
        title={session.title}
        className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch pl-2 text-xs outline-none focus-visible:underline"
      >
        {status !== "idle" ? <StatusGlyph status={status} className="shrink-0" /> : null}
        <span className="truncate">{session.title}</span>
        {status !== "idle" ? <span className="sr-only">, {STATUS_LABEL[status]}</span> : null}
      </button>
      <button
        type="button"
        aria-label={`Close ${session.title}`}
        onClick={props.onClose}
        className={cn(
          "mx-0.5 flex size-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-hover hover:text-fg focus-visible:opacity-100",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <XIcon size={11} />
      </button>
    </div>
  );
}

/** Threads in the panel's folder, newest first. */
function useFolderSessions(cwd: string | null): SessionSummary[] {
  const sessions = useApp((s) => s.sessions);
  return useMemo(
    () =>
      Object.values(sessions)
        .filter((s) => !s.archived && inFolder(s.cwd, cwd))
        .sort((a, b) => (a.activityAt < b.activityAt ? 1 : -1)),
    [sessions, cwd],
  );
}

/** The editor has no folder open, so there is nothing to scope the panel to yet. */
function NoFolder() {
  return (
    <div className="flex flex-1 flex-col items-start gap-3 px-4 pt-6">
      <div className="flex items-center gap-2">
        <Logo size={20} />
        <h1 className="text-sm font-semibold text-fg">Open a folder to start</h1>
      </div>
      <p className="text-xs text-pretty text-muted">
        Muse Code GUI works on the folder you have open: its threads show up here as tabs, and new threads start in it.
      </p>
      <Button size="sm" variant="accent" onClick={() => postToHost({ type: "musegui-command", command: "openFolder" })}>
        Open Folder
      </Button>
    </div>
  );
}

function PanelNew(props: { cwd: string | null; onHistory: () => void }) {
  const controller = useController();
  const projects = useApp((s) => s.projects);
  const now = useNow(60_000);
  const project = props.cwd ? (projects.find((p) => p.cwd === props.cwd) ?? null) : (projects[0] ?? null);
  const recent = useFolderSessions(props.cwd).slice(0, 5);
  const statuses = useStatuses(recent);

  // The host opened a folder Muse Code GUI doesn't know yet. The extension adds it on load, so give that a moment
  // to land before adding it from here, which would start a second, slow discovery of the same folder.
  const adding = useRef(false);
  useEffect(() => {
    if (!props.cwd || project || adding.current) {
      return;
    }
    const cwd = props.cwd;
    const timer = window.setTimeout(() => {
      adding.current = true;
      void controller.addProject(cwd);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [props.cwd, project, controller]);

  if (!project) {
    return <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted">Opening {props.cwd ? basename(props.cwd) : "your folder"}…</div>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-4">
        <div className="flex items-center gap-2">
          <Logo size={20} />
          <h1 className="text-sm font-semibold text-fg">New thread</h1>
        </div>
        <p className="mt-1.5 truncate text-xs text-muted" title={project.cwd}>
          in {project.displayName}
        </p>
        {recent.length > 0 ? (
          <section className="mt-6" aria-label="Recent threads">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-2xs font-medium text-subtle">Recent</h2>
              <button type="button" onClick={props.onHistory} className="text-2xs text-subtle hover:text-fg">
                View all
              </button>
            </div>
            <ul className="mt-1 flex flex-col">
              {recent.map((session) => (
                <li key={session.sessionId}>
                  <HistoryRow session={session} status={statuses[session.sessionId] ?? "idle"} now={now} onOpen={() => controller.openThread(session.sessionId)} />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="mt-6 text-xs text-pretty text-muted">
            Ask Muse Code to change, fix or explain something in this folder. Past threads show up here and under History.
          </p>
        )}
      </div>
      <div className="shrink-0 px-3 pb-2">
        <HostErrorCard className="mb-2" />
        <Composer sessionId={null} cwd={project.cwd} running={false} readOnly={false} variant="home" autoFocus />
        <ComposerFooter cwd={project.cwd} branch={null} running={false} />
      </div>
    </div>
  );
}

function HistoryRow(props: { session: SessionSummary; status: ThreadStatus; now: number; onOpen: () => void; active?: boolean }) {
  const { session, status } = props;
  return (
    <button
      type="button"
      onClick={props.onOpen}
      aria-current={props.active ? "true" : undefined}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors duration-100 hover:bg-hover",
        props.active && "bg-active",
      )}
    >
      {status !== "idle" ? <StatusGlyph status={status} className="shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate text-xs text-fg">{session.title}</span>
      {status !== "idle" ? <span className="sr-only">{STATUS_LABEL[status]}</span> : null}
      <span className="shrink-0 text-2xs text-subtle tabular-nums">{relativeTime(session.activityAt, props.now)}</span>
    </button>
  );
}

const DAY = 24 * 60 * 60 * 1000;

function dateGroup(iso: string, now: number): string {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const at = new Date(iso).getTime();
  if (at >= startOfToday.getTime()) return "Today";
  if (at >= startOfToday.getTime() - DAY) return "Yesterday";
  if (at >= startOfToday.getTime() - 7 * DAY) return "Previous 7 days";
  if (at >= startOfToday.getTime() - 30 * DAY) return "Previous 30 days";
  return "Older";
}

/** Every thread in the folder, searchable by title and grouped by when it last moved. */
function HistorySheet(props: { cwd: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const ime = useImeGuard();
  const controller = useController();
  const now = useNow(60_000);
  const [query, setQuery] = useState("");
  const all = useFolderSessions(props.cwd);
  const activeId = useApp((s) => (s.route.kind === "thread" ? s.route.sessionId : null));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? all.filter((s) => words.every((w) => s.title.toLowerCase().includes(w))) : all;
  const statuses = useStatuses(shown);
  const groups = useMemo(() => {
    const out: { label: string; items: SessionSummary[] }[] = [];
    for (const session of shown) {
      const label = dateGroup(session.activityAt, now);
      const last = out[out.length - 1];
      if (last && last.label === label) {
        last.items.push(session);
      } else {
        out.push({ label, items: [session] });
      }
    }
    return out;
  }, [shown, now]);
  const open = (sessionId: string) => {
    props.onOpenChange(false);
    setQuery("");
    controller.openThread(sessionId);
  };
  return (
    <Sheet
      open={props.open}
      onOpenChange={(next) => {
        props.onOpenChange(next);
        if (!next) setQuery("");
      }}
      title="History"
      description={props.cwd ? `Threads in ${basename(props.cwd)}` : undefined}
      className="w-full!"
    >
      <label className="flex h-8 items-center gap-2 rounded-md bg-sunken px-2 text-xs text-muted focus-within:shadow-[0_0_0_1.5px_var(--accent)]">
        <MagnifyingGlassIcon size={13} className="shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyUp={ime.onKeyUp}
          onKeyDown={(event) => {
            if (ime.isImeKey(event)) {
              return;
            }
            const first = shown[0];
            if (event.key === "Enter" && first) {
              open(first.sessionId);
            }
          }}
          placeholder="Search threads"
          aria-label="Search threads"
          className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-subtle"
        />
      </label>
      {groups.length === 0 ? (
        <p className="mt-6 text-center text-xs text-muted">{all.length === 0 ? "No threads in this folder yet." : "No threads match."}</p>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="mt-4" aria-label={group.label}>
            <h3 className="px-1.5 text-2xs font-medium text-subtle">{group.label}</h3>
            <ul className="mt-1 flex flex-col">
              {group.items.map((session) => (
                <li key={session.sessionId}>
                  <HistoryRow
                    session={session}
                    status={statuses[session.sessionId] ?? "idle"}
                    now={now}
                    active={session.sessionId === activeId}
                    onOpen={() => open(session.sessionId)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </Sheet>
  );
}
