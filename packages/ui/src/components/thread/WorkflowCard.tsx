import { ArrowCounterClockwiseIcon, CaretDownIcon, FlowArrowIcon, PauseIcon, PlayIcon, SkipForwardIcon, SquareHalfIcon, StopCircleIcon } from "../ui/icons.js";
import { memo, useMemo, useState } from "react";
import { useApp, useController } from "../../app/context.js";
import { formatDuration, formatTokens, humanize } from "../../model/format.js";
import { TERMINAL_FAILURES, workflowView, type WorkflowAgent, type WorkflowView } from "../../model/workflow.js";
import type { MspItem } from "../../types.js";
import { Markdown } from "../ui/Markdown.js";
import { Sheet } from "../ui/overlays.js";
import { Button, IconButton, Spinner, cn } from "../ui/primitives.js";

type Tone = "running" | "paused" | "done" | "failed";

const PILL: Record<Tone, string> = {
  running: "bg-accent-soft text-accent-text",
  paused: "bg-sunken text-muted",
  done: "bg-active text-ok-text",
  failed: "bg-warn-soft text-warn-text",
};

const FILL: Record<Tone, string> = {
  running: "bg-accent",
  paused: "bg-line",
  done: "bg-ok",
  failed: "bg-warn",
};

function toneOf(view: WorkflowView): Tone {
  if (view.running) {
    return "running";
  }
  if (view.paused) {
    return "paused";
  }
  // A run that was rejected, cancelled or timed out did not succeed, even with no failed agent.
  return view.failed > 0 || TERMINAL_FAILURES.has(view.status) ? "failed" : "done";
}

/** Muse keeps a paused run `inProgress` and flags it, so the raw status would read "In progress". */
function statusLabel(view: WorkflowView): string {
  return view.running ? "Running" : view.paused ? "Paused" : humanize(view.status);
}

function time(ms: number | null): string {
  return ms === null ? "Not known" : formatDuration(ms) || "0s";
}

/**
 * A workflow run: what it was for, how many agents it fanned out to and how they are doing, with
 * everything else a click away in the sheet. No tokens or cost, because Muse reports neither per run.
 */
export const WorkflowCard = memo(function WorkflowCard(props: { item: MspItem; sessionId?: string }) {
  const controller = useController();
  const [detail, setDetail] = useState(false);
  const { item, sessionId } = props;
  // The item is replaced on every revision, so this recomputes exactly when the run changes.
  const view = useMemo(() => {
    const fold = sessionId ? (controller.store.get().threads[sessionId]?.fold ?? null) : null;
    return workflowView(item, fold);
  }, [item, sessionId, controller]);
  const cardKey = `workflow:${item.itemId}`;
  const open = useApp((s) => !s.prefs.collapsedCards.includes(cardKey));
  const tone = toneOf(view);
  const percent = view.used > 0 ? ((view.done + view.failed) / view.used) * 100 : 0;
  return (
    <section aria-label="Workflow" className="enter-up overflow-hidden rounded-2xl bg-raised shadow-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => controller.setCardOpen(cardKey, !open)}
        className="flex h-10 w-full items-center gap-2.5 px-3.5 text-left transition-colors hover:bg-hover"
      >
        <FlowArrowIcon size={15} className="shrink-0 text-subtle" />
        <span className="shrink-0 text-sm font-medium text-fg">Workflow</span>
        <span className={cn("shrink-0 rounded-md px-1.5 py-px text-2xs font-medium", PILL[tone])}>
          {statusLabel(view)}
        </span>
        {view.used > 0 ? (
          <span className="shrink-0 text-xs text-subtle tabular-nums">
            {view.done + view.failed} of {view.used}
          </span>
        ) : null}
        {!open ? <span className="min-w-0 truncate text-xs text-muted">{view.objective ?? view.label}</span> : null}
        <span className="min-w-2 flex-1" />
        {view.running ? <Spinner size={12} className="shrink-0 text-accent-text" /> : null}
        <CaretDownIcon size={14} className={cn("shrink-0 text-subtle transition-transform duration-200", !open && "-rotate-90")} />
      </button>
      {open ? (
        <div className="px-3.5 pb-3">
          <p className="line-clamp-3 text-sm text-pretty text-fg [overflow-wrap:anywhere]" title={view.objective ?? view.label}>
            {view.objective ?? view.label}
          </p>
          {view.used > 0 ? (
            <div
              role="progressbar"
              aria-label="Agents finished"
              aria-valuemin={0}
              aria-valuemax={view.used}
              aria-valuenow={view.done + view.failed}
              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-active"
            >
              <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", FILL[tone])} style={{ width: `${percent}%` }} />
            </div>
          ) : null}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
            <Metric label="Agents" value={String(view.used)} />
            <Metric label={view.running || view.paused ? "Working" : "Done"} value={String(view.running || view.paused ? view.working : view.done)} />
            <Metric label="Tool calls" value={view.toolCalls === null ? "Not known" : String(view.toolCalls)} />
            <Metric label="Longest agent" value={time(view.longestMs)} />
          </dl>
          {view.failed > 0 ? (
            <p className="mt-2 text-xs text-warn-text">
              {view.failed} of {view.used} {view.failed === 1 ? "agent" : "agents"} did not finish.
            </p>
          ) : null}
          {view.paused ? <p className="mt-2 text-xs text-muted">Paused. Resume it, or cancel the run.</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDetail(true)}>
              <SquareHalfIcon size={13} /> Details
            </Button>
            {view.running && view.runId && sessionId ? <RunControl sessionId={sessionId} runId={view.runId} action="pause" /> : null}
            {view.paused && view.runId && sessionId ? <RunControl sessionId={sessionId} runId={view.runId} action="resume" /> : null}
            {(view.running || view.paused) && view.runId && sessionId ? <RunControl sessionId={sessionId} runId={view.runId} action="cancel" /> : null}
          </div>
        </div>
      ) : null}
      <Sheet
        open={detail}
        onOpenChange={setDetail}
        title="Workflow"
        description={view.objective ?? view.label}
      >
        <Detail view={view} tone={tone} sessionId={sessionId} />
      </Sheet>
    </section>
  );
});

/**
 * Pauses, resumes or cancels the whole run. Cancelling keeps what it had finished in its report.
 * Resuming needs Muse Code 1.4.6 or later; an older host answers with an error, which shows as a toast.
 */
function RunControl(props: { sessionId: string; runId: string; action: "pause" | "resume" | "cancel" }) {
  const controller = useController();
  const readOnly = useApp((s) => s.threads[props.sessionId]?.readOnly ?? true);
  const busy = useApp((s) => Boolean(s.busy[`workflow:${props.sessionId}:${props.runId}:run`]));
  if (readOnly) {
    return null;
  }
  return (
    <Button size="sm" variant="ghost" loading={busy} onClick={() => void controller.workflowAction(props.sessionId, props.action, props.runId)}>
      {props.action === "pause" ? (
        <>
          <PauseIcon size={13} /> Pause run
        </>
      ) : props.action === "resume" ? (
        <>
          <PlayIcon size={13} /> Resume run
        </>
      ) : (
        <>
          <StopCircleIcon size={13} /> Cancel run
        </>
      )}
    </Button>
  );
}

function Detail(props: { view: WorkflowView; tone: Tone; sessionId?: string }) {
  const { view } = props;
  // Skipping or retrying an agent needs the run it belongs to and a thread that is ours to drive.
  const controls = useApp((s) => (props.sessionId && view.runId && !s.threads[props.sessionId]?.readOnly ? { sessionId: props.sessionId, runId: view.runId } : null), (a, b) => a?.sessionId === b?.sessionId && a?.runId === b?.runId);
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs sm:grid-cols-3">
        <Metric label="Status" value={statusLabel(view)} />
        <Metric label="Agents used" value={String(view.used)} />
        <Metric label="Working" value={String(view.working)} />
        <Metric label="Done" value={String(view.done)} />
        <Metric label="Failed" value={String(view.failed)} />
        <Metric label="Tool calls" value={view.toolCalls === null ? "Not known" : String(view.toolCalls)} />
        <Metric label="Longest agent" value={time(view.longestMs)} />
        {/* Agents run alongside each other, so this is more than the run took on the clock. */}
        <Metric label="Agent time" value={time(view.agentMs)} />
        <Metric label="Started by" value={view.trigger ? humanize(view.trigger) : "Not known"} />
        {view.tokenBudget !== null ? <Metric label="Token budget" value={formatTokens(view.tokenBudget)} /> : null}
      </dl>

      {view.failure ? (
        <section>
          <h3 className="text-xs font-medium text-subtle">Last failure</h3>
          <p className="mt-1 text-sm text-danger-text [overflow-wrap:anywhere]">{view.failure}</p>
        </section>
      ) : null}

      <section>
        <h3 className="text-xs font-medium text-subtle">Agents</h3>
        {view.agents.length > 0 ? (
          <ul className="mt-1.5 flex flex-col">
            {view.agents.map((agent) => (
              <AgentRow key={`${agent.id}:${agent.attempt}`} agent={agent} controls={controls} />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">No agents reported yet.</p>
        )}
      </section>

      {view.summary ? (
        <section>
          <h3 className="text-xs font-medium text-subtle">
            Report{view.summaryStatus ? ` · ${humanize(view.summaryStatus)}` : ""}
          </h3>
          <div className="mt-1.5">
            <Markdown text={view.summary} className="text-sm" />
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="text-xs font-medium text-subtle">Run</h3>
        <dl className="mt-1.5 flex flex-col gap-1 text-xs">
          <Identifier label="Run" value={view.runId} />
          <Identifier label="Script" value={view.scriptId} />
          <Identifier label="Admitted" value={view.admitted ? "Yes" : "No"} />
          {view.deferred ? <Identifier label="Deferred" value="Ran in the background" /> : null}
        </dl>
      </section>
    </div>
  );
}

function AgentRow(props: { agent: WorkflowAgent; controls: { sessionId: string; runId: string } | null }) {
  const controller = useController();
  const { agent, controls } = props;
  const failed = Boolean(agent.terminal) && agent.terminal !== "completed";
  const busy = useApp((s) => Boolean(controls && s.busy[`workflow:${controls.sessionId}:${controls.runId}:${agent.id}`]));
  // The attempt goes along as the child's current one: if it moved on meanwhile, Muse refuses instead of guessing.
  const act = (action: "skip" | "retry") =>
    controls && void controller.workflowAction(controls.sessionId, action, controls.runId, { childId: agent.id, attempt: agent.attempt });
  return (
    <li className="flex items-center gap-2.5 border-b border-line py-2 last:border-b-0">
      {agent.terminal ? (
        <span className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-danger" : "bg-ok")} />
      ) : (
        <Spinner size={10} className="shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted" title={agent.id}>
        {agent.id}
      </span>
      {agent.attempt > 1 ? <span className="shrink-0 text-2xs text-subtle">try {agent.attempt}</span> : null}
      {agent.toolCalls !== null ? (
        <span className="shrink-0 text-2xs text-subtle tabular-nums">
          {agent.toolCalls} {agent.toolCalls === 1 ? "call" : "calls"}
        </span>
      ) : null}
      <span className="w-12 shrink-0 text-right text-2xs text-subtle tabular-nums">
        {agent.durationMs === null ? "" : formatDuration(agent.durationMs) || "0s"}
      </span>
      {controls && !agent.terminal ? (
        <IconButton size="xs" label={`Skip ${agent.id}`} title="Skip this agent" disabled={busy} onClick={() => act("skip")}>
          <SkipForwardIcon size={12} />
        </IconButton>
      ) : null}
      {controls && failed ? (
        <IconButton size="xs" label={`Retry ${agent.id}`} title="Run this agent again" disabled={busy} onClick={() => act("retry")}>
          <ArrowCounterClockwiseIcon size={12} />
        </IconButton>
      ) : null}
    </li>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-subtle">{props.label}</dt>
      <dd className="truncate text-fg tabular-nums">{props.value}</dd>
    </div>
  );
}

function Identifier(props: { label: string; value: string | null }) {
  if (!props.value) {
    return null;
  }
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-subtle">{props.label}</dt>
      <dd className="min-w-0 truncate font-mono text-[11.5px] text-muted" title={props.value}>
        {props.value}
      </dd>
    </div>
  );
}
