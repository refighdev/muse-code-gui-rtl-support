import { copyText } from "../../app/host.js";
import { ArchiveIcon, ArrowsInIcon, CodeIcon, CopyIcon, DotsThreeIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, LockIcon, NotePencilIcon, PencilSimpleIcon, ShieldSlashIcon, SquareHalfBottomIcon, SquareIcon, StopCircleIcon, TreeStructureIcon } from "../ui/icons.js";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { announce, FOCUS_SCOPE } from "../../app/a11y.js";
import { useApp, useController, useNow } from "../../app/context.js";
import { useImeGuard } from "../../app/ime.js";
import { speechChanges, threadSpeech, type ThreadSpeech } from "../../model/announce.js";
import { CaptionSpacer, useOverlayDragProps } from "../../app/frame.js";
import { basename, formatDuration } from "../../model/format.js";
import { backgroundTasks } from "../../model/plan.js";
import { goalView } from "../../model/goal.js";
import type { ThreadState } from "../../model/store.js";
import type { SessionSummary } from "../../types.js";
import { SidebarToggle, TrafficLightSpacer } from "../chrome.js";
import { Composer, ComposerFooter } from "../composer/Composer.js";
import { TelemetryPills } from "../composer/TelemetryPills.js";
import { ApprovalPanel, CloseCard, PlanPanel, QuestionPanel, QueuedList, ReadOnlyNotice, ReviewingNotice, StalledNotice } from "../requests/Requests.js";
import { GoalPanel } from "./GoalPanel.js";
import { revealLabel } from "../sidebar/Sidebar.js";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tip } from "../ui/overlays.js";
import { Button, IconButton, MOD, Spinner } from "../ui/primitives.js";
import { FilesPanel } from "../files/FilesPanel.js";
import { Transcript } from "./Transcript.js";
import { ChangedFiles } from "./ChangedFiles.js";
import { Monitors } from "./Monitors.js";

/** `bare` drops the header and the files panel, for the compact panel whose tabs stand in for the header. */
export function ThreadView(props: { sessionId: string; bare?: boolean }) {
  const session = useApp((s) => s.sessions[props.sessionId] ?? null);
  const thread = useApp((s) => s.threads[props.sessionId] ?? null);
  const filesOpen = useApp((s) => s.prefs.filesOpen);
  if (!session) {
    return <MissingThread />;
  }
  const running = thread ? thread.fold.activeTurnId !== null : Boolean(session.live?.activeTurnId);
  const ssh = session.cwd.startsWith("ssh://");
  return (
    // One labelled region per thread, so a screen reader always knows which conversation it is in, and focus
    // lost inside it (an answered approval, a Stop button gone) comes back to this thread's composer.
    <section
      aria-label={`Thread: ${session.title}`}
      tabIndex={-1}
      {...{ [FOCUS_SCOPE]: "" }}
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden outline-none"
    >
      <ThreadAnnouncements sessionId={props.sessionId} />
      {props.bare ? null : <ThreadHeader session={session} thread={thread} running={running} />}
      <div className="flex min-h-0 flex-1">
        <div className="@container flex min-w-0 flex-1 flex-col">
          {thread ? <Transcript sessionId={props.sessionId} thread={thread} /> : <div className="min-h-0 flex-1" />}
          <Dock session={session} thread={thread} running={running} />
        </div>
        {filesOpen && !props.bare ? (ssh ? <SshFilesNote /> : <FilesPanel sessionId={props.sessionId} cwd={session.cwd} />) : null}
      </div>
    </section>
  );
}

/**
 * Tells a screen reader what changed in the open thread, once per change: work starting and ending, Muse
 * asking for something, a plan step done. The visible status line is not a live region, since it ticks.
 */
function ThreadAnnouncements(props: { sessionId: string }) {
  // A string, so the store only re-renders this when something worth saying changed.
  const key = useApp((s) => {
    const fold = s.threads[props.sessionId]?.fold;
    return fold ? JSON.stringify(threadSpeech(fold)) : null;
  });
  const previous = useRef<ThreadSpeech | null>(null);
  useEffect(() => {
    if (key === null) {
      return;
    }
    const next = JSON.parse(key) as ThreadSpeech;
    // Nothing is said for the state a thread opens in, only for what changes while it is open.
    if (previous.current) {
      for (const sentence of speechChanges(previous.current, next)) {
        announce(sentence);
      }
    }
    previous.current = next;
  }, [key]);
  return null;
}

/** SSH projects run on a remote host, which the local file viewer cannot read in this version. */
function SshFilesNote() {
  return (
    <aside
      aria-label="Files"
      className="relative flex h-full shrink-0 flex-col border-l border-line bg-bg"
      style={{ width: "min(320px, 70%)" }}
    >
      <p className="px-4 py-6 text-sm text-muted">The file viewer is not available for SSH projects in this version.</p>
    </aside>
  );
}

function ThreadHeader(props: { session: SessionSummary; thread: ThreadState | null; running: boolean }) {
  const controller = useController();
  const { session, thread } = props;
  const [renaming, setRenaming] = useState(false);
  const fold = thread?.fold ?? null;
  const waiting = fold ? Object.keys(fold.approvals).length + Object.keys(fold.userInputs).length > 0 : false;
  const startedAt = fold?.activeTurnId ? fold.turns[fold.activeTurnId]?.startedAt : undefined;
  const now = useNow(1000, props.running && startedAt !== undefined);
  const drag = useOverlayDragProps();
  const noDrag = useOverlayDragProps("off");
  const filesOpen = useApp((s) => s.prefs.filesOpen);
  return (
    <header data-drag-region {...drag} className="@container flex h-12 shrink-0 items-center gap-1.5 overflow-hidden border-b border-line px-3">
      <TrafficLightSpacer />
      <SidebarToggle />
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
        {renaming ? (
          <TitleField
            initial={session.title}
            onDone={(title) => {
              setRenaming(false);
              if (title !== null) {
                void controller.rename(session.sessionId, title);
              }
            }}
          />
        ) : (
          <h1
            data-no-drag
            {...noDrag}
            className="min-w-0 flex-1 cursor-text truncate overflow-hidden text-sm font-semibold text-nowrap text-ellipsis text-fg"
            title={`${session.title} (double-click to rename)`}
            onDoubleClick={() => setRenaming(true)}
          >
            {session.title}
          </h1>
        )}
        <span className="hidden min-w-0 shrink @min-[420px]:flex">
          <ProjectChip cwd={session.cwd} />
        </span>
        {fold?.meta.branch ? (
          <span className="hidden min-w-0 items-center gap-1 text-xs text-subtle lg:flex">
            <GitBranchIcon size={12} className="shrink-0" />
            <span className="truncate font-mono text-2xs">{fold.meta.branch}</span>
          </span>
        ) : null}
      </div>
      {session.sandboxDisabled === true ? (
        <Tip label="This thread started while sandboxing was switched off, so its shells run unconfined">
          <span className="flex shrink-0 items-center gap-1.5 px-1 text-xs font-medium text-warn-text">
            <ShieldSlashIcon size={12} aria-hidden="true" />
            <span className="sr-only">Sandbox off</span>
            <span aria-hidden="true" className="@max-[420px]:hidden">Sandbox off</span>
          </span>
        </Tip>
      ) : null}
      {waiting ? (
        <span className="flex shrink-0 items-center gap-1.5 px-1 text-xs font-medium text-warn-text">
          <span className="attention-pulse size-1.5 rounded-full bg-warn" aria-hidden="true" />
          <span className="@max-[420px]:hidden">Waiting for you</span>
        </span>
      ) : props.running ? (
        <span className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted">
          <Spinner size={11} className="text-accent-text" />
          <span className="@max-[420px]:hidden">Working</span>
          {startedAt ? <span className="text-subtle tabular-nums">{formatDuration(now - startedAt)}</span> : null}
        </span>
      ) : thread?.readOnly ? (
        <span className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-subtle">
          <LockIcon size={12} />
          <span className="@max-[420px]:hidden">Read-only</span>
        </span>
      ) : null}
      {props.running ? (
        <Tip label="Stop the turn" shortcut={["Esc"]}>
          <IconButton label="Stop the turn" onClick={() => void controller.stop(session.sessionId)}>
            <SquareIcon weight="fill" size={11} />
          </IconButton>
        </Tip>
      ) : null}
      <HiddenCardsButton sessionId={session.sessionId} running={props.running} />
      <Tip label={filesOpen ? "Hide files" : "Show files"} shortcut={[MOD, "Shift", "E"]}>
        <IconButton label={filesOpen ? "Hide files" : "Show files"} active={filesOpen} onClick={() => controller.toggleFiles()}>
          <TreeStructureIcon size={15} />
        </IconButton>
      </Tip>
      <span className="@max-[360px]:hidden">
        <Tip label="Open in VS Code">
          <IconButton label="Open in VS Code" onClick={() => void controller.openFolder(session.cwd, "editor")}>
            <CodeIcon size={15} />
          </IconButton>
        </Tip>
      </span>
      <Menu>
        <Tip label="More">
          <MenuTrigger asChild>
            <IconButton label="Thread actions">
              <DotsThreeIcon size={16} />
            </IconButton>
          </MenuTrigger>
        </Tip>
        <MenuContent align="end">
          <MenuItem icon={<PencilSimpleIcon size={14} />} onSelect={() => setRenaming(true)}>
            Rename
          </MenuItem>
          <MenuItem icon={<ArrowsInIcon size={14} />} onSelect={() => void controller.compact(session.sessionId)} disabled={thread?.readOnly}>
            Compact context
          </MenuItem>
          <MenuItem icon={<FolderOpenIcon size={14} />} onSelect={() => void controller.openFolder(session.cwd, "files")}>
            {revealLabel()}
          </MenuItem>
          <MenuItem icon={<CopyIcon size={14} />} onSelect={() => void copyText(session.sessionId)}>
            Copy session ID
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<ArchiveIcon size={14} />} onSelect={() => void controller.archive(session.sessionId)}>
            Archive thread
          </MenuItem>
        </MenuContent>
      </Menu>
      <CaptionSpacer />
    </header>
  );
}

function ProjectChip(props: { cwd: string }) {
  const controller = useController();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 shrink items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-subtle transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover"
          title={props.cwd}
        >
          <FolderIcon size={12} className="shrink-0" />
          <span className="truncate">{basename(props.cwd)}</span>
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem icon={<NotePencilIcon size={14} />} onSelect={() => controller.newThread(props.cwd)}>
          New thread in {basename(props.cwd)}
        </MenuItem>
        <MenuItem icon={<FolderOpenIcon size={14} />} onSelect={() => void controller.openFolder(props.cwd, "files")}>
          {revealLabel()}
        </MenuItem>
        <MenuItem icon={<CodeIcon size={14} />} onSelect={() => void controller.openFolder(props.cwd, "editor")}>
          Open in VS Code
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function TitleField(props: { initial: string; onDone: (title: string | null) => void }) {
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
      aria-label="Thread title"
      defaultValue={props.initial}
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
      className="h-7 w-[min(420px,50%)] rounded-md bg-raised px-2 text-sm font-semibold text-fg outline-none shadow-[0_0_0_1.5px_var(--accent)]"
    />
  );
}

function planShown(todo: ThreadState["fold"]["meta"]["todoList"] | null | undefined, running: boolean): boolean {
  return Boolean(todo && todo.length > 0 && (running || todo.some((t) => t.status !== "completed")));
}

/** Shown while a dock card the user closed has something to show; brings every closed card in the thread back. */
function HiddenCardsButton(props: { sessionId: string; running: boolean }) {
  const controller = useController();
  const names = useApp((s) => {
    const hidden = s.prefs.hiddenCards;
    const fold = s.threads[props.sessionId]?.fold;
    if (!fold || !hidden.some((k) => k.endsWith(`:${props.sessionId}`))) {
      return "";
    }
    const out: string[] = [];
    if (hidden.includes(`plan:${props.sessionId}`) && planShown(fold.meta.todoList, props.running)) {
      out.push("plan");
    }
    if (hidden.includes(`goal:${props.sessionId}`) && goalView(fold) !== null) {
      out.push("goal");
    }
    if (hidden.includes(`tasks:${props.sessionId}`) && backgroundTasks(fold).length > 0) {
      out.push("background tasks");
    }
    return out.join(", ");
  });
  if (!names) {
    return null;
  }
  const label = `Show the ${names.replace(/, ([^,]*)$/, " and $1")}`;
  return (
    <Tip label={label}>
      <IconButton label={label} onClick={() => controller.showThreadCards(props.sessionId)}>
        <SquareHalfBottomIcon size={15} />
      </IconButton>
    </Tip>
  );
}

function Dock(props: { session: SessionSummary; thread: ThreadState | null; running: boolean }) {
  const controller = useController();
  const { session, thread } = props;
  const fold = thread?.fold ?? null;
  const approvals = fold ? Object.values(fold.approvals) : [];
  const reviewing = fold ? Object.keys(fold.reviewing).length : 0;
  const inputs = fold ? Object.values(fold.userInputs) : [];
  const queued = fold ? fold.echoes.filter((e) => e.disposition === "queued") : [];
  const todo = fold?.meta.todoList ?? null;
  const showPlan = planShown(todo, props.running);
  // Known to be off, not merely not loaded yet: only then is switching catch-up on something to offer.
  const catchUpOff = useApp((s) => s.feedSettings?.catchUp === false);
  return (
    <section aria-label="Composer" className="shrink-0">
      <div className="mx-auto flex w-full max-w-[776px] flex-col gap-2 px-3 pb-2 @min-[400px]:px-4 @min-[520px]:px-6">
        {thread?.readOnly ? (
          <ReadOnlyNotice
            reason={thread.readOnlyReason}
            busy={thread.load === "loading"}
            onRetry={() => void controller.loadThread(session.sessionId)}
          />
        ) : null}
        {thread?.stalled && !thread.readOnly ? (
          <StalledNotice
            busy={thread.load === "loading"}
            onRetry={() => void controller.retryStalledThread(session.sessionId)}
            onKeepLive={catchUpOff ? () => void controller.keepThreadLive(session.sessionId) : undefined}
          />
        ) : null}
        {reviewing > 0 && !thread?.readOnly ? <ReviewingNotice count={reviewing} /> : null}
        {approvals.map((request, index) => (
          <ApprovalPanel key={request.approvalId} request={request} primary={index === 0} />
        ))}
        {inputs.map((request, index) => (
          <QuestionPanel key={request.userInputId} request={request} keyboard={approvals.length === 0 && index === 0} />
        ))}
        {fold && !thread?.readOnly ? <BackgroundTasks sessionId={session.sessionId} /> : null}
        <GoalPanel sessionId={session.sessionId} running={props.running} readOnly={Boolean(thread?.readOnly)} />
        {showPlan && todo ? <PlanPanel sessionId={session.sessionId} items={todo} /> : null}
        {queued.length > 0 ? <QueuedList sessionId={session.sessionId} items={queued} /> : null}
        {fold ? <Monitors sessionId={session.sessionId} /> : null}
        {fold ? <ChangedFiles sessionId={session.sessionId} /> : null}
        <TelemetryPills sessionId={session.sessionId} />
        <Composer
          sessionId={session.sessionId}
          cwd={session.cwd}
          running={props.running}
          readOnly={Boolean(thread?.readOnly)}
          variant="thread"
          autoFocus
        />
        <ComposerFooter cwd={session.cwd} branch={fold?.meta.branch ?? null} running={props.running} />
      </div>
    </section>
  );
}

/** Tool calls still running after being sent to the background, with one way to stop all of them. */
function BackgroundTasks(props: { sessionId: string }) {
  const controller = useController();
  const count = useApp((s) => {
    const fold = s.threads[props.sessionId]?.fold;
    return fold ? backgroundTasks(fold).length : 0;
  });
  const busy = useApp((s) => Boolean(s.busy[`task:${props.sessionId}:all`]));
  const hidden = useApp((s) => s.prefs.hiddenCards.includes(`tasks:${props.sessionId}`));
  if (count === 0 || hidden) {
    return null;
  }
  return (
    <div className="flex items-center gap-2 rounded-xl bg-raised px-3 py-1.5 text-xs text-muted shadow-card">
      <Spinner size={11} className="shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1 truncate">
        {count === 1 ? "1 task is running in the background" : `${count} tasks are running in the background`}
      </span>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" loading={busy} onClick={() => void controller.taskAction(props.sessionId, "stopAll")}>
        <StopCircleIcon size={12} /> Stop all
      </Button>
      <CloseCard label="Hide background tasks" onClose={() => controller.setCardHidden(`tasks:${props.sessionId}`, true)} />
    </div>
  );
}

function MissingThread() {
  const controller = useController();
  const drag = useOverlayDragProps();
  return (
    <div className="flex h-full flex-1 flex-col">
      <header data-drag-region {...drag} className="flex h-12 items-center px-3">
        <TrafficLightSpacer />
        <SidebarToggle />
        <CaptionSpacer />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-[12vh] text-center">
        <p className="font-display text-2xl text-fg">This thread is not here anymore</p>
        <p className="max-w-[40ch] text-sm text-muted">It may have been archived or removed with its project.</p>
        <button type="button" className="mt-2 text-sm font-medium text-accent-text hover:underline" onClick={() => controller.newThread()}>
          Start a new thread
        </button>
      </div>
    </div>
  );
}
