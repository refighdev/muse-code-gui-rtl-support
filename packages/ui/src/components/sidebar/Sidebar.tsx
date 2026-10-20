import { copyText, isEditorHosted } from "../../app/host.js";
import { usePanel } from "../../app/panel.js";
import { ArchiveIcon, ArrowClockwiseIcon, ArrowLineDownIcon, ArrowUUpLeftIcon, ArrowsClockwiseIcon, CaretRightIcon, ChartBarIcon, CheckIcon, CodeIcon, CopyIcon, DotsThreeIcon, DownloadSimpleIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, FunnelSimpleIcon, GearSixIcon, GitBranchIcon, MagnifyingGlassIcon, MonitorIcon, MoonIcon, NotePencilIcon, PauseIcon, PencilSimpleIcon, PlayIcon, PushPinIcon, PushPinSlashIcon, ShieldSlashIcon, SidebarSimpleIcon, StackIcon, SunIcon, TargetIcon, XIcon } from "../ui/icons.js";
import { memo, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from "react";
import { shallowEqual, useApp, useController, useNow } from "../../app/context.js";
import { useImeGuard } from "../../app/ime.js";
import { useOverlayDragProps, useTitlebarOverlay } from "../../app/frame.js";
import { basename, formatElapsed, relativeTime } from "../../model/format.js";
import { statusLabel } from "../../model/goal.js";
import { PlanPill } from "../usage/PlanMeter.js";
import {
  STATUS_LABEL,
  groupByProject,
  groupByStatus,
  isLive,
  settledEntries,
  threadStatus,
  type ProjectGroup,
  type SidebarEntry,
} from "../../model/status.js";
import { CODE_THEMES, DEFAULT_SIDEBAR_WIDTH, type CodeTheme } from "../../model/store.js";
import type { UpdateState } from "../../model/updates.js";
import type { ProjectView, SessionSummary } from "../../types.js";
import { Menu, MenuCheck, MenuContent, MenuItem, MenuOption, MenuRadioGroup, MenuSeparator, MenuTrigger, Tip } from "../ui/overlays.js";
import { IconButton, Logo, MOD, NEW_THREAD_KEYS, Shortcut, Spinner, cn, isMac } from "../ui/primitives.js";
import { StatusGlyph } from "../ui/StatusGlyph.js";

const PROJECT_PREVIEW = 6;
const STATUS_PREVIEW = 30;
/** The strip under the last project: dropping there sends a project to the bottom. */
const END_DROP = "end";
const REORDER_SLOP = 6;

function projectUnderPoint(x: number, y: number): string | null {
  for (const node of document.elementsFromPoint(x, y)) {
    if (!(node instanceof Element)) {
      continue;
    }
    if (node.closest("[data-project-end-drop]")) {
      return END_DROP;
    }
    const section = node.closest("[data-project-cwd]");
    if (section instanceof HTMLElement && section.dataset.projectCwd) {
      return section.dataset.projectCwd;
    }
  }
  return null;
}

export function Sidebar() {
  const width = useApp((s) => s.prefs.sidebarWidth);
  const overlay = useTitlebarOverlay();
  // The New thread row, where focus goes when a card that held it closes; the sidebar is outside the main
  // area, so the FocusKeeper has no composer to fall back to here.
  const newThreadRef = useRef<HTMLButtonElement>(null);
  return (
    <aside
      aria-label="Sidebar"
      className="@container relative flex h-full shrink-0 flex-col border-r border-line bg-sidebar"
      style={{ width }}
    >
      {overlay ? <TrafficLightsSlot /> : null}
      <SidebarTop newThreadRef={newThreadRef} />
      <ThreadList />
      <SidebarFooter />
      <ResizeHandle />
    </aside>
  );
}

/**
 * The macOS traffic lights float in this slot, 20px from the left and 20px from the top.
 * It also drags the window.
 */
function TrafficLightsSlot() {
  const drag = useOverlayDragProps("self");
  return <div data-drag-region {...drag} aria-hidden="true" className="h-10 shrink-0" />;
}

function SidebarTop(props: { newThreadRef: Ref<HTMLButtonElement> }) {
  const controller = useController();
  const routeKind = useApp((s) => s.route.kind);
  const drag = useOverlayDragProps();
  return (
    <div data-drag-region {...drag} className="flex flex-col gap-px px-2 pt-2 pb-1.5">
      <div className="mb-2 flex h-8 items-center gap-2 pr-0.5 pl-1.5">
        <Logo size={20} />
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-fg">Muse Code GUI</span>
        <span className="flex-1" />
        <Tip label="Hide sidebar" shortcut={[MOD, "B"]}>
          <IconButton label="Hide sidebar" onClick={() => controller.toggleSidebar()}>
            <SidebarSimpleIcon size={16} />
          </IconButton>
        </Tip>
      </div>
      <NavRow
        buttonRef={props.newThreadRef}
        icon={<NotePencilIcon size={15} />}
        label="New thread"
        keys={NEW_THREAD_KEYS}
        active={routeKind === "new"}
        onClick={() => controller.newThread()}
      />
      <NavRow icon={<MagnifyingGlassIcon size={15} />} label="Search" keys={[MOD, "K"]} onClick={() => controller.setPaletteOpen(true)} />
    </div>
  );
}

function NavRow(props: {
  icon: ReactNode;
  label: string;
  keys: string[];
  active?: boolean;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={props.buttonRef}
      type="button"
      onClick={props.onClick}
      aria-current={props.active ? "page" : undefined}
      className={cn(
        "group/nav flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-sm text-muted transition-colors duration-100 hover:bg-hover hover:text-fg",
        props.active && "bg-active text-fg",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{props.label}</span>
      {/* The hint only takes room once the sidebar is wide enough to keep the label on one line. */}
      <span className="hidden shrink-0 @min-[16rem]:block">
        <Shortcut keys={props.keys} className="opacity-0 transition-opacity duration-150 group-hover/nav:opacity-100" />
      </span>
    </button>
  );
}

function useSidebarEntries(): { entries: SidebarEntry[]; activeId: string | null } {
  const sessions = useApp((s) => s.sessions);
  const threads = useApp((s) => s.threads);
  const lastSeen = useApp((s) => s.prefs.lastSeen);
  const baseline = useApp((s) => s.prefs.baseline);
  const activeId = useApp((s) => (s.route.kind === "thread" ? s.route.sessionId : null));
  const entries = useMemo(
    () =>
      Object.values(sessions).map((session) => ({
        session,
        status: threadStatus(session, {
          fold: threads[session.sessionId]?.fold ?? null,
          lastSeen: lastSeen[session.sessionId] ?? null,
          baseline,
          active: session.sessionId === activeId,
        }),
      })),
    [sessions, threads, lastSeen, baseline, activeId],
  );
  return { entries, activeId };
}

function ThreadList() {
  const controller = useController();
  const projects = useApp((s) => s.projects);
  const groupBy = useApp((s) => s.prefs.groupBy);
  const collapsed = useApp((s) => s.prefs.collapsedProjects);
  const loaded = useApp((s) => s.sessionsLoaded);
  const now = useNow(30_000);
  const { entries, activeId } = useSidebarEntries();

  const projectGroups = useMemo(() => groupByProject(projects, entries), [projects, entries]);
  // Dragging a project header moves it: the drop lands it above the row under the cursor, or last.
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const endDrag = () => {
    setDragging(null);
    setOver(null);
  };
  // The dragged project comes with the drop rather than from `dragging`: the pointer handlers were made on
  // pointer-down, before the drag began, so the `dragging` they could see is still null.
  const drop = (cwd: string, beforeCwd: string | null) => {
    void controller.reorderProjects(cwd, beforeCwd);
    endDrag();
  };
  const statusGroups = useMemo(() => groupByStatus(entries), [entries]);
  const settled = useMemo(() => settledEntries(entries), [entries]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 items-center justify-between pr-2 pl-3.5">
        <h2 className="text-xs font-medium text-subtle">{groupBy === "project" ? "Projects" : "By status"}</h2>
        <div className="flex items-center gap-0.5">
          <GroupByMenu />
          <Tip label="Add project">
            <IconButton size="xs" label="Add project" onClick={() => controller.setAddProjectOpen(true)}>
              <FolderPlusIcon size={14} />
            </IconButton>
          </Tip>
        </div>
      </div>
      <nav aria-label="Threads" className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-6">
        {!loaded ? (
          <SidebarSkeleton />
        ) : projects.length === 0 ? (
          <SidebarEmpty />
        ) : groupBy === "project" ? (
          <>
            {projectGroups.map((group) => (
              <ProjectSection
                key={group.project.cwd}
                group={group}
                collapsed={collapsed.includes(group.project.cwd)}
                activeId={activeId}
                now={now}
                dragging={dragging}
                over={over}
                onDragStart={setDragging}
                onDragOver={setOver}
                onDrop={drop}
                onDragEnd={endDrag}
              />
            ))}
            {dragging ? (
              <div
                aria-hidden="true"
                data-project-end-drop=""
                className={cn(
                  "mx-1 h-7 rounded-lg border border-dashed transition-colors duration-100",
                  over === END_DROP ? "border-accent bg-hover" : "border-line",
                )}
              />
            ) : null}
          </>
        ) : (
          <>
            {statusGroups.map((group) => (
              <StatusSection key={group.id} label={group.label} entries={group.entries} activeId={activeId} now={now} cap={group.id === "idle"} />
            ))}
            {settled.length > 0 ? <SettledShelf shelfKey="status" entries={settled} activeId={activeId} now={now} showProject /> : null}
          </>
        )}
      </nav>
    </div>
  );
}

const ProjectSection = memo(function ProjectSection(props: {
  group: ProjectGroup;
  collapsed: boolean;
  activeId: string | null;
  now: number;
  dragging: string | null;
  over: string | null;
  onDragStart: (cwd: string) => void;
  onDragOver: (cwd: string) => void;
  onDrop: (cwd: string, beforeCwd: string | null) => void;
  onDragEnd: () => void;
}) {
  const controller = useController();
  const noWindowDrag = useOverlayDragProps("off");
  const didReorder = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const { project, entries } = props.group;
  const activeIndex = entries.findIndex((e) => e.session.sessionId === props.activeId);
  const liveCount = entries.filter((e) => isLive(e.status)).length;
  const limit = expanded ? entries.length : Math.max(PROJECT_PREVIEW, liveCount, activeIndex + 1);
  const visible = entries.slice(0, limit);
  return (
    <section
      data-project-cwd={project.cwd}
      className={cn("mb-1", props.dragging === project.cwd && "opacity-50")}
      aria-label={project.displayName}
    >
      <div
        className={cn(
          "mx-1 mb-0.5 h-0.5 rounded-full transition-colors duration-100",
          props.over === project.cwd && props.dragging && props.dragging !== project.cwd ? "bg-accent" : "bg-transparent",
        )}
      />
      <div
        data-no-drag
        {...noWindowDrag}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          const origin = event.target;
          if (origin instanceof Element && origin.closest("[data-no-reorder]")) {
            return;
          }
          const startX = event.clientX;
          const startY = event.clientY;
          const cwd = project.cwd;
          let started = false;
          const onMove = (move: globalThis.PointerEvent) => {
            if (!started) {
              if (Math.hypot(move.clientX - startX, move.clientY - startY) < REORDER_SLOP) {
                return;
              }
              started = true;
              didReorder.current = true;
              props.onDragStart(cwd);
            }
            const over = projectUnderPoint(move.clientX, move.clientY);
            if (over) {
              props.onDragOver(over);
            }
          };
          const onUp = (up: globalThis.PointerEvent) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            // The browser sends its click to the element holding both ends of the gesture, so a drop onto
            // another project never reaches this header's onClickCapture. Clearing here, after that click has
            // gone by, keeps the next real click on this header from being swallowed.
            setTimeout(() => {
              didReorder.current = false;
            }, 0);
            if (!started) {
              return;
            }
            const over = projectUnderPoint(up.clientX, up.clientY);
            if (over === END_DROP) {
              props.onDrop(cwd, null);
            } else if (over && over !== cwd) {
              props.onDrop(cwd, over);
            } else {
              props.onDragEnd();
            }
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
          window.addEventListener("pointercancel", onUp);
        }}
        onClickCapture={(event) => {
          if (!didReorder.current) {
            return;
          }
          didReorder.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        className="group/project flex h-8 cursor-grab items-center gap-0.5 rounded-lg pr-1 transition-colors duration-100 hover:bg-hover active:cursor-grabbing"
      >
        <button
          type="button"
          aria-expanded={!props.collapsed}
          onClick={() => controller.toggleProjectCollapsed(project.cwd)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-1.5 text-left"
          title={project.cwd}
        >
          <CaretRightIcon
            size={13}
            className={cn("shrink-0 text-subtle transition-transform duration-150 ease-out", !props.collapsed && "rotate-90")}
          />
          {props.collapsed ? (
            <FolderIcon size={15} className="shrink-0 text-subtle" />
          ) : (
            <FolderOpenIcon size={15} className="shrink-0 text-subtle" />
          )}
          <span className="truncate text-sm font-medium text-fg">{project.displayName}</span>
          {project.pinned ? (
            <>
              <PushPinIcon size={11} className="shrink-0 text-subtle" aria-hidden="true" />
              <span className="sr-only">, pinned</span>
            </>
          ) : null}
          {props.collapsed && props.group.attention > 0 ? (
            <span className="mr-1 ml-auto size-1.5 shrink-0 rounded-full bg-warn" aria-label={`${props.group.attention} need you`} />
          ) : props.collapsed && props.group.running > 0 ? (
            <Spinner size={10} className="mr-1 ml-auto text-accent-text" label="Working" />
          ) : null}
        </button>
        <div
          data-no-reorder
          className="flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-hover/project:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
        >
          <Tip label={`New thread in ${project.displayName}`}>
            <IconButton size="xs" label={`New thread in ${project.displayName}`} onClick={() => controller.newThread(project.cwd)}>
              <NotePencilIcon size={13} />
            </IconButton>
          </Tip>
          <ProjectMenu project={project} />
        </div>
      </div>
      {props.collapsed ? null : (
        <ul className="flex flex-col gap-px pt-px">
          {visible.map((entry) => (
            <ThreadRow key={entry.session.sessionId} entry={entry} active={entry.session.sessionId === props.activeId} now={props.now} />
          ))}
          {entries.length === 0 && props.group.settled.length === 0 ? (
            <li>
              <button
                type="button"
                onClick={() => controller.newThread(project.cwd)}
                className="flex h-7 w-full items-center rounded-lg pl-[30px] text-left text-xs text-subtle hover:bg-hover hover:text-fg"
              >
                Start the first thread
              </button>
            </li>
          ) : null}
          {entries.length > visible.length || (expanded && entries.length > PROJECT_PREVIEW) ? (
            <li>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex h-7 w-full items-center rounded-lg pl-[30px] text-left text-xs text-subtle hover:bg-hover hover:text-fg"
              >
                {expanded ? "Show fewer" : `Show ${entries.length - visible.length} more`}
              </button>
            </li>
          ) : null}
        </ul>
      )}
      {props.collapsed || props.group.settled.length === 0 ? null : (
        <SettledShelf shelfKey={`project:${project.cwd}`} entries={props.group.settled} activeId={props.activeId} now={props.now} />
      )}
    </section>
  );
});

function StatusSection(props: { label: string; entries: SidebarEntry[]; activeId: string | null; now: number; cap: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const limit = props.cap && !expanded ? STATUS_PREVIEW : props.entries.length;
  return (
    <section className="mb-2" aria-label={props.label}>
      <h3 className="flex h-7 items-center gap-2 px-2 text-xs font-medium text-subtle">
        <span>{props.label}</span>
        <span className="tabular-nums">{props.entries.length}</span>
      </h3>
      <ul className="flex flex-col gap-px">
        {props.entries.slice(0, limit).map((entry) => (
          <ThreadRow
            key={entry.session.sessionId}
            entry={entry}
            active={entry.session.sessionId === props.activeId}
            now={props.now}
            showProject
          />
        ))}
        {props.entries.length > limit ? (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex h-7 w-full items-center rounded-lg pl-[30px] text-left text-xs text-subtle hover:bg-hover hover:text-fg"
            >
              Show {props.entries.length - limit} more
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

const SHELF_PAGE = 10;
const SHELF_MORE = 25;

/**
 * Settled threads, collapsed under a "Settled" divider as in T3 Code. While collapsed it still
 * shows the thread that is open, so the sidebar never loses the current selection.
 */
function SettledShelf(props: { shelfKey: string; entries: SidebarEntry[]; activeId: string | null; now: number; showProject?: boolean }) {
  const controller = useController();
  const open = useApp((s) => s.prefs.openShelves.includes(props.shelfKey));
  const [limit, setLimit] = useState(SHELF_PAGE);
  const visible = open ? props.entries.slice(0, limit) : props.entries.filter((e) => e.session.sessionId === props.activeId);
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => controller.toggleShelf(props.shelfKey)}
        className="group/shelf flex h-7 w-full items-center gap-2 rounded-lg pr-2 pl-[30px] text-left text-xs text-subtle transition-colors duration-100 hover:text-fg"
      >
        <span>Settled</span>
        <span className="tabular-nums">{props.entries.length}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
        <CaretRightIcon size={12} className={cn("shrink-0 transition-transform duration-150 ease-out", open && "rotate-90")} />
      </button>
      {visible.length > 0 ? (
        <ul className="flex flex-col gap-px">
          {visible.map((entry) => (
            <ThreadRow
              key={entry.session.sessionId}
              entry={entry}
              active={entry.session.sessionId === props.activeId}
              now={props.now}
              showProject={props.showProject}
              settled
            />
          ))}
        </ul>
      ) : null}
      {open && props.entries.length > limit ? (
        <button
          type="button"
          onClick={() => setLimit((current) => current + SHELF_MORE)}
          className="flex h-7 w-full items-center rounded-lg pl-[30px] text-left text-xs text-subtle hover:bg-hover hover:text-fg"
        >
          Show {Math.min(SHELF_MORE, props.entries.length - limit)} more
        </button>
      ) : null}
    </div>
  );
}

/** "Working 1m" counted from the turn's start and ticking each second, like T3 Code's timer. */
function WorkingFor(props: { session: SessionSummary }) {
  const foldStart = useApp((s) => {
    const fold = s.threads[props.session.sessionId]?.fold;
    return fold?.activeTurnId ? (fold.turns[fold.activeTurnId]?.startedAt ?? null) : null;
  });
  const liveStart = props.session.live?.turnStartedAt ? Date.parse(props.session.live.turnStartedAt) : null;
  const start = foldStart ?? liveStart;
  const now = useNow(1000);
  return (
    <span className="text-accent-text">
      Working
      {start ? <span className="ml-1">{formatElapsed(now - start)}</span> : null}
    </span>
  );
}

/** The right-hand slot of a row: what the thread needs, a running timer, or how long ago it moved. */
function RowStatus(props: { entry: SidebarEntry; now: number; settled?: boolean }) {
  const { session, status } = props.entry;
  if (props.settled) {
    return <span className="text-subtle">{relativeTime(session.settledAt ?? session.activityAt, props.now)}</span>;
  }
  switch (status) {
    case "running":
      return <WorkingFor session={session} />;
    case "approval":
      return <span className="font-medium text-warn-text">Approval</span>;
    case "input":
      return <span className="font-medium text-status-input">Input</span>;
    case "failed":
      return <span className="font-medium text-danger-text">Failed</span>;
    case "unread":
      return (
        <span className="flex items-center gap-1 font-medium text-ok-text">
          <CheckIcon size={11} aria-hidden="true" />
          Done
        </span>
      );
    default:
      return <span className="text-subtle">{relativeTime(session.activityAt, props.now)}</span>;
  }
}

/** The second line of an active card: the project in the status view, an open goal, and the branch once known. */
function RowMeta(props: { session: SessionSummary; showProject?: boolean }) {
  const branch = useApp((s) => s.threads[props.session.sessionId]?.fold.meta.branch ?? null);
  // An opened thread's own goal is the freshest; otherwise, what the server last saw.
  const goal = useApp((s) => {
    const fold = s.threads[props.session.sessionId]?.fold;
    return fold?.meta.goalSeen ? fold.meta.goal : (props.session.live?.goal ?? null);
  });
  const tone = goal ? statusLabel(goal.status).tone : null;
  const open = goal !== null && (tone === "active" || tone === "paused" || tone === "attention");
  if (!props.showProject && !branch && !open) {
    return null;
  }
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-subtle">
      {props.showProject ? <span className="truncate">{basename(props.session.cwd)}</span> : null}
      {open && goal ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 tabular-nums",
            tone === "active" ? "text-accent-text" : tone === "attention" ? "text-warn-text" : "text-subtle",
          )}
          title={`Goal: ${goal.objective}`}
        >
          <TargetIcon size={11} className="shrink-0" aria-hidden="true" />
          <span className="sr-only">Goal </span>
          {Math.round(Math.max(0, Math.min(100, goal.percentComplete)))}%
        </span>
      ) : null}
      {branch ? (
        <span className="flex min-w-0 items-center gap-1">
          <GitBranchIcon size={11} className="shrink-0" aria-hidden="true" />
          <span className="truncate font-mono text-2xs">{branch}</span>
        </span>
      ) : null}
    </span>
  );
}

function AccountBadge({ accountId }: { accountId: string | null }) {
  const account = useApp((s) => s.accounts?.find((a) => a.id === accountId) ?? null);
  if (!accountId || !account) return null;
  return (
    <span
      title={`Account: ${account.name}`}
      className="max-w-[7rem] shrink-0 truncate rounded bg-active px-1 py-px text-2xs font-medium text-muted"
    >
      {account.name}
    </span>
  );
}

/**
 * The tree line from a thread down to its side chats, as in a file explorer. The thread's row draws
 * it from under its status glyph; each side chat carries it on and the last one turns the corner.
 */
function TreeGuide(props: { last: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -top-px left-[17px] w-[9px] border-l border-line",
          props.last ? "h-[calc(50%+1px)] rounded-bl-md border-b" : "-bottom-px",
        )}
      />
      {props.last ? null : <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-[17px] w-[9px] border-t border-line" />}
    </>
  );
}

export const ThreadRow = memo(
  function ThreadRow(props: { entry: SidebarEntry; active: boolean; now: number; showProject?: boolean; settled?: boolean }) {
    const controller = useController();
    const { session, status } = props.entry;
    const [renaming, setRenaming] = useState(false);
    const emphasized = props.active || status === "unread" || isLive(status);
    return (
      <li>
        <div
          className={cn(
            "group/row relative flex min-h-8 items-center gap-2 rounded-lg py-1 pr-1 transition-colors duration-100",
            props.entry.nested ? "pl-[46px]" : "pl-[30px]",
            props.active ? "bg-active" : "hover:bg-hover",
          )}
        >
          {props.entry.hasSides ? (
            <span aria-hidden="true" className="pointer-events-none absolute top-[calc(50%+8px)] -bottom-px left-[17px] border-l border-line" />
          ) : null}
          {props.entry.nested ? <TreeGuide last={props.entry.lastNested === true} /> : null}
          {props.settled ? null : (
            <span className={cn("absolute top-1/2 flex size-4 -translate-y-1/2 items-center justify-center", props.entry.nested ? "left-[26px]" : "left-[10px]")}>
              <StatusGlyph status={status} />
            </span>
          )}
          {renaming ? (
            <RenameField
              initial={session.title}
              onDone={(title) => {
                setRenaming(false);
                if (title !== null) {
                  void controller.rename(session.sessionId, title);
                }
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => controller.openThread(session.sessionId)}
              onDoubleClick={() => setRenaming(true)}
              aria-current={props.active ? "page" : undefined}
              title={session.title}
              className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-accent focus-visible:after:outline"
            >
              <span
                className={cn(
                  "flex min-w-0 items-center gap-1.5 text-sm",
                  props.settled ? "text-subtle" : emphasized ? "text-fg" : "text-muted",
                  status === "unread" && !props.settled && "font-medium",
                )}
              >
                {session.sandboxDisabled === true ? (
                  <span title="Sandbox off" className="flex shrink-0 text-warn-text">
                    <ShieldSlashIcon size={12} aria-hidden="true" />
                  </span>
                ) : null}
                <AccountBadge accountId={session.accountId} />
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                {session.pinned ? <PushPinIcon size={11} className="shrink-0 text-subtle" aria-hidden="true" /> : null}
              </span>
              {props.settled ? null : <RowMeta session={session} showProject={props.showProject} />}
              <span className="sr-only">{`, ${STATUS_LABEL[status]}${props.entry.nested ? ", side chat" : ""}${session.pinned ? ", pinned" : ""}${session.sandboxDisabled === true ? ", sandbox off" : ""}${session.accountId ? ", using a separate account" : ""}`}</span>
            </button>
          )}
          {renaming ? null : (
            <>
              <span
                // pr-1.5 on top of the row's pr-1 mirrors the status glyph's 10px inset on the left.
                className="shrink-0 pr-1.5 text-2xs tabular-nums group-focus-within/row:hidden group-hover/row:hidden group-has-[[data-state=open]]/row:hidden"
                aria-hidden="true"
              >
                <RowStatus entry={props.entry} now={props.now} settled={props.settled} />
              </span>
              <div className="relative z-10 hidden items-center group-focus-within/row:flex group-hover/row:flex group-has-[[data-state=open]]/row:flex">
                {props.settled ? (
                  <Tip label="Un-settle">
                    <IconButton size="xs" label="Un-settle thread" onClick={() => void controller.setSettled(session.sessionId, false)}>
                      <ArrowUUpLeftIcon size={13} />
                    </IconButton>
                  </Tip>
                ) : isLive(status) ? null : (
                  <Tip label="Settle">
                    <IconButton size="xs" label="Settle thread" onClick={() => void controller.setSettled(session.sessionId, true)}>
                      <CheckIcon size={14} />
                    </IconButton>
                  </Tip>
                )}
                <ThreadMenu session={session} onRename={() => setRenaming(true)} />
              </div>
            </>
          )}
        </div>
      </li>
    );
  },
  (a, b) =>
    a.entry.session === b.entry.session &&
    a.entry.status === b.entry.status &&
    a.entry.nested === b.entry.nested &&
    a.entry.lastNested === b.entry.lastNested &&
    a.entry.hasSides === b.entry.hasSides &&
    a.active === b.active &&
    a.now === b.now &&
    a.showProject === b.showProject &&
    a.settled === b.settled,
);

function RenameField(props: { initial: string; onDone: (title: string | null) => void }) {
  const ime = useImeGuard();
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (!done.current) {
      done.current = true;
      props.onDone(value);
    }
  };
  return (
    <input
      autoFocus
      defaultValue={props.initial}
      aria-label="Thread title"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
      onKeyUp={ime.onKeyUp}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (ime.isImeKey(e)) {
          return;
        }
        if (e.key === "Enter") {
          finish(e.currentTarget.value);
        } else if (e.key === "Escape") {
          finish(null);
        }
      }}
      className="relative z-10 h-6 min-w-0 flex-1 rounded-md bg-raised px-1.5 text-sm text-fg outline-none shadow-[0_0_0_1.5px_var(--accent)]"
    />
  );
}

function ThreadMenu(props: { session: SessionSummary; onRename: () => void }) {
  const controller = useController();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size="xs" label="Thread actions">
          <DotsThreeIcon size={14} />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<PencilSimpleIcon size={14} />} onSelect={props.onRename}>
          Rename
        </MenuItem>
        <MenuItem
          icon={props.session.pinned ? <PushPinSlashIcon size={14} /> : <PushPinIcon size={14} />}
          onSelect={() => void controller.toggleThreadPin(props.session.sessionId)}
        >
          {props.session.pinned ? "Unpin" : "Pin to top"}
        </MenuItem>
        <MenuItem icon={<CopyIcon size={14} />} onSelect={() => void copyText(props.session.sessionId)}>
          Copy session ID
        </MenuItem>
        <MenuItem icon={<FolderOpenIcon size={14} />} onSelect={() => void controller.openFolder(props.session.cwd, "files")}>
          {revealLabel()}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<ArchiveIcon size={14} />} onSelect={() => void controller.archive(props.session.sessionId)}>
          Archive thread
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function revealLabel(): string {
  if (isMac) {
    return "Reveal in Finder";
  }
  return typeof navigator !== "undefined" && /Win/.test(navigator.platform) ? "Open in File Explorer" : "Open folder";
}

function ProjectMenu(props: { project: ProjectView }) {
  const controller = useController();
  const { project } = props;
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size="xs" label={`${project.displayName} actions`}>
          <DotsThreeIcon size={14} />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<NotePencilIcon size={14} />} onSelect={() => controller.newThread(project.cwd)}>
          New thread
        </MenuItem>
        <MenuItem
          icon={project.pinned ? <PushPinSlashIcon size={14} /> : <PushPinIcon size={14} />}
          onSelect={() => void controller.togglePin(project.cwd)}
        >
          {project.pinned ? "Unpin" : "Pin to top"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<FolderOpenIcon size={14} />} onSelect={() => void controller.openFolder(project.cwd, "files")}>
          {revealLabel()}
        </MenuItem>
        <MenuItem icon={<CodeIcon size={14} />} onSelect={() => void controller.openFolder(project.cwd, "editor")}>
          Open in VS Code
        </MenuItem>
        <MenuItem icon={<CopyIcon size={14} />} onSelect={() => void copyText(project.cwd)}>
          Copy path
        </MenuItem>
        <MenuItem icon={<ArrowsClockwiseIcon size={14} />} onSelect={() => void controller.refreshProject(project.cwd)}>
          Refresh threads
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<XIcon size={14} />} tone="danger" onSelect={() => void controller.hideProject(project.cwd)}>
          Remove from sidebar
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function GroupByMenu() {
  const controller = useController();
  const groupBy = useApp((s) => s.prefs.groupBy);
  return (
    <Menu>
      <Tip label="Group threads">
        <MenuTrigger asChild>
          <IconButton size="xs" label="Group threads">
            <FunnelSimpleIcon size={14} />
          </IconButton>
        </MenuTrigger>
      </Tip>
      <MenuContent align="end">
        <MenuRadioGroup value={groupBy} onValueChange={(v) => controller.setGroupBy(v === "status" ? "status" : "project")}>
          <MenuOption value="project" icon={<FolderIcon size={14} />} label="By project" description="Each project with its threads" />
          <MenuOption value="status" icon={<StackIcon size={14} />} label="By status" description="Needs you, working, ready for review" />
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function SidebarFooter() {
  const controller = useController();
  const env = useApp((s) => s.env);
  const connection = useApp((s) => s.connection);
  const discovering = useApp((s) => s.discovering);
  const hostError = useApp((s) => s.hostError);
  const status =
    connection === "lost"
      ? { dot: "bg-warn", text: "Reconnecting to Muse Code GUI" }
      : hostError
        ? { dot: "bg-danger", text: "Muse needs attention" }
        : env?.museSignedIn === false
          ? { dot: "bg-warn", text: "Sign in to Muse" }
          : env?.platform === "win32" && env.runtime !== "native"
            ? { dot: "bg-ok", text: `Muse in WSL (${env.defaultDistro ?? "Ubuntu"})` }
            : { dot: "bg-ok", text: "Muse ready" };
  const signIn = env?.museSignedIn === false ? "Run muse login in a terminal, then check again." : null;
  const detail = hostError ?? signIn ?? (env?.musePath ? `${env.musePath}  |  Muse Code GUI ${env.version}` : `Muse Code GUI ${env?.version ?? ""}`);
  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-t border-line px-2">
      <Tip label={detail} side="top" align="start">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1.5 text-xs text-muted" tabIndex={0}>
          <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} aria-hidden="true" />
          <span className="truncate">{status.text}</span>
        </div>
      </Tip>
      <Tip label="Refresh threads from Muse" side="top">
        <IconButton label="Refresh threads from Muse" onClick={() => void controller.discoverAll()} disabled={discovering}>
          <ArrowsClockwiseIcon size={14} className={cn(discovering && "animate-spin")} />
        </IconButton>
      </Tip>
      <PlanPill />
      <Tip label="Usage and cost" side="top">
        <IconButton label="Usage and cost" onClick={() => controller.navigate({ kind: "usage" })}>
          <ChartBarIcon size={14} />
        </IconButton>
      </Tip>
      <Tip label="Settings" shortcut={[MOD, ","]} side="top">
        <IconButton label="Settings" onClick={() => controller.navigate({ kind: "settings" })}>
          <GearSixIcon size={14} />
        </IconButton>
      </Tip>
      <UpdatesMenu />
      <ThemeMenu />
    </div>
  );
}

export function updateSummary(updates: UpdateState, autoUpdate: boolean, paused: boolean, now: number): string {
  const version = updates.update?.version ?? "";
  switch (updates.status) {
    case "checking":
      return "Checking for updates";
    case "available":
      return paused ? `Version ${version} is available. Updates are paused.` : `Version ${version} is available`;
    case "downloading":
      return `Downloading version ${version}${updates.progress !== null ? `, ${Math.round(updates.progress * 100)}%` : ""}`;
    case "ready":
      return autoUpdate && !paused ? `Version ${version} installs when you close Muse Code GUI` : `Version ${version} is ready to install`;
    case "installing":
      return "Installing the update";
    case "error":
      return "Could not check for updates";
    case "upToDate": {
      const ago = updates.checkedAt ? relativeTime(new Date(updates.checkedAt).toISOString(), now) : "";
      return paused ? "Up to date. Updates are paused." : ago && ago !== "now" ? `Up to date, checked ${ago} ago` : "Up to date";
    }
    default:
      return paused ? "Updates are paused" : autoUpdate ? "Muse Code GUI updates itself" : "Automatic updates are off";
  }
}

/** Desktop app updates. The footer icon carries a dot while a new version waits. */
function UpdatesMenu() {
  const controller = useController();
  const updates = useApp((s) => s.updates);
  const autoUpdate = useApp((s) => s.prefs.autoUpdate);
  const paused = useApp((s) => s.prefs.updatesPaused);
  const now = useNow(60_000);
  if (!updates) {
    return null;
  }
  const { status } = updates;
  const version = updates.update?.version ?? "";
  const waiting = status === "available" || status === "downloading" || status === "ready";
  const busy = status === "checking" || status === "downloading" || status === "installing";
  return (
    <Menu>
      <Tip label={status === "ready" ? `Muse Code GUI ${version} is ready to install` : waiting ? `Muse Code GUI ${version} is available` : "Updates"} side="top">
        <MenuTrigger asChild>
          <IconButton label="Updates" className="relative">
            <DownloadSimpleIcon size={15} />
            {waiting ? (
              <span
                aria-hidden="true"
                className={cn("absolute top-1.5 right-1.5 size-1.5 rounded-full", status === "ready" ? "bg-accent" : "bg-accent/50")}
              />
            ) : null}
          </IconButton>
        </MenuTrigger>
      </Tip>
      <MenuContent side="top" align="start" className="w-[290px]">
        <div className="px-2 pt-1.5 pb-2">
          <p className="text-sm font-medium text-fg">Muse Code GUI {updates.currentVersion ?? ""}</p>
          <p className="mt-0.5 text-xs text-muted">{updateSummary(updates, autoUpdate, paused, now)}</p>
          {status === "downloading" && updates.progress !== null ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-active" role="progressbar" aria-valuenow={Math.round(updates.progress * 100)}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${updates.progress * 100}%` }} />
            </div>
          ) : null}
          {updates.error ? <p className="mt-1.5 text-xs break-words text-danger-text">{updates.error}</p> : null}
        </div>
        <MenuSeparator />
        {status === "ready" ? (
          <MenuItem icon={<ArrowClockwiseIcon size={14} />} onSelect={() => controller.restartToUpdate()}>
            Restart to update
          </MenuItem>
        ) : null}
        {status === "available" ? (
          <MenuItem icon={<ArrowLineDownIcon size={14} />} onSelect={() => controller.downloadUpdate()}>
            Download version {version}
          </MenuItem>
        ) : null}
        <MenuItem icon={<ArrowsClockwiseIcon size={14} />} disabled={busy} onSelect={() => controller.checkForUpdates()}>
          Check for updates
        </MenuItem>
        <MenuSeparator />
        <MenuCheck
          checked={autoUpdate}
          onChange={(on) => controller.setAutoUpdate(on)}
          description="Download new versions in the background and install them when Muse Code GUI closes"
        >
          Automatic updates
        </MenuCheck>
        <MenuItem icon={paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />} onSelect={() => controller.setUpdatesPaused(!paused)}>
          {paused ? "Resume updates" : "Pause updates"}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export const CODE_THEME_LABELS: Record<CodeTheme, string> = {
  musegui: "Muse Code GUI",
  ayu: "Ayu",
  github: "GitHub",
  vercel: "Vercel",
  cursor: "Cursor",
  catppuccin: "Catppuccin",
};

function ThemeMenu() {
  const controller = useController();
  const theme = useApp((s) => s.prefs.theme);
  const codeTheme = useApp((s) => s.prefs.codeTheme);
  const icon = theme === "light" ? <SunIcon size={15} /> : theme === "dark" ? <MoonIcon size={15} /> : <MonitorIcon size={15} />;
  return (
    <Menu>
      <Tip label="Theme" side="top">
        <MenuTrigger asChild>
          <IconButton label="Theme">{icon}</IconButton>
        </MenuTrigger>
      </Tip>
      <MenuContent side="top" align="end" className="min-w-[160px]">
        <MenuRadioGroup value={theme} onValueChange={(v) => controller.setTheme(v === "light" || v === "dark" ? v : "system")}>
          <MenuOption value="system" icon={<MonitorIcon size={14} />} label="System" />
          <MenuOption value="light" icon={<SunIcon size={14} />} label="Light" />
          <MenuOption value="dark" icon={<MoonIcon size={14} />} label="Dark" />
        </MenuRadioGroup>
        <MenuSeparator />
        <p className="px-2.5 pt-1 pb-1.5 text-2xs font-medium text-subtle">Code</p>
        <MenuRadioGroup
          value={codeTheme}
          onValueChange={(v) => controller.setCodeTheme(CODE_THEMES.includes(v as CodeTheme) ? (v as CodeTheme) : "musegui")}
        >
          {CODE_THEMES.map((name) => (
            <MenuOption
              key={name}
              value={name}
              icon={<span aria-hidden="true" className={cn("size-2.5 rounded-[3px]", `code-swatch-${name}`)} />}
              label={CODE_THEME_LABELS[name]}
            />
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function ResizeHandle() {
  const controller = useController();
  const width = useApp((s) => s.prefs.sidebarWidth);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = controller.store.get().prefs.sidebarWidth;
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    const move = (e: globalThis.PointerEvent) => controller.setSidebarWidth(startWidth + e.clientX - startX);
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
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={220}
      aria-valuemax={480}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => controller.setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
      onKeyDown={(e) => {
        const width = controller.store.get().prefs.sidebarWidth;
        if (e.key === "ArrowLeft") {
          controller.setSidebarWidth(width - 16);
        } else if (e.key === "ArrowRight") {
          controller.setSidebarWidth(width + 16);
        }
      }}
      className="absolute top-0 right-[-3px] z-[var(--z-resize)] h-full w-1.5 cursor-col-resize transition-colors duration-150 hover:bg-accent/35 focus-visible:bg-accent/35 focus-visible:outline-none"
    />
  );
}

function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-2 pt-2" aria-hidden="true">
      {[62, 80, 54, 70, 46, 66].map((w, i) => (
        <div key={i} className="h-3 rounded bg-hover" style={{ width: `${w}%`, marginLeft: i % 3 === 0 ? 0 : 22 }} />
      ))}
    </div>
  );
}

function SidebarEmpty() {
  const controller = useController();
  const discovering = useApp((s) => s.discovering);
  return (
    <div className="px-2 pt-3 text-sm">
      <p className="font-medium text-fg">No projects yet</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Add a folder to start a thread. Threads you ran from the Muse terminal show up here on their own.
      </p>
      <button
        type="button"
        onClick={() => controller.setAddProjectOpen(true)}
        className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-accent-text hover:bg-hover"
      >
        <FolderPlusIcon size={14} /> Add project
      </button>
      {discovering ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-subtle">
          <Spinner size={10} /> Looking for Muse threads
        </p>
      ) : null}
    </div>
  );
}

export { useSidebarEntries, shallowEqual };
