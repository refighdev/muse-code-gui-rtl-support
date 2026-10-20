import { CaretDownIcon, PauseIcon, PlayIcon, SquareIcon, TargetIcon, XIcon } from "../ui/icons.js";
import { useMemo } from "react";
import { shallowEqual, useApp, useController, useNow } from "../../app/context.js";
import { formatDuration, formatTokens, relativeTime } from "../../model/format.js";
import { goalView, type GoalTone, type GoalView } from "../../model/goal.js";
import { formatCost } from "../../model/pricing.js";
import { turnCost } from "../../model/usage.js";
import { CloseCard } from "../requests/Requests.js";
import { Tip } from "../ui/overlays.js";
import { Button, cn } from "../ui/primitives.js";

const PILL: Record<GoalTone, string> = {
  active: "bg-accent-soft text-accent-text",
  paused: "bg-active text-muted",
  done: "bg-active text-ok-text",
  attention: "bg-warn-soft text-warn-text",
  ended: "bg-active text-subtle",
};

const FILL: Record<GoalTone, string> = {
  active: "bg-accent",
  paused: "bg-line-strong",
  done: "bg-ok",
  attention: "bg-warn",
  ended: "bg-line-strong",
};

/** The goal Muse is working toward in this thread, with how long, how many turns and how many tokens it took. */
export function GoalPanel(props: { sessionId: string; running: boolean; readOnly: boolean }) {
  const controller = useController();
  // Only what the goal reads from: streamed text changes none of these, so tokens do not re-render the panel.
  const inputs = useApp((s) => {
    const fold = s.threads[props.sessionId]?.fold;
    return fold
      ? { goal: fold.meta.goal, seen: fold.meta.goalSeen, since: fold.meta.goalSince, calls: fold.meta.calls, items: fold.order.length }
      : null;
  }, shallowEqual);
  const view = useMemo(() => {
    const fold = controller.store.get().threads[props.sessionId]?.fold;
    return inputs && fold ? goalView(fold) : null;
  }, [inputs, controller, props.sessionId]);
  // Kept in prefs, not here: this panel unmounts whenever the user looks at another thread.
  const cardKey = `goal:${props.sessionId}`;
  const open = useApp((s) => !s.prefs.collapsedCards.includes(cardKey));
  const hidden = useApp((s) => s.prefs.hiddenCards.includes(cardKey));
  const ticking = view?.tone === "active" && view.startedAt !== null;
  const now = useNow(1000, ticking);
  if (!view || hidden) {
    return null;
  }
  const elapsed = view.startedAt === null ? null : Math.max(0, (view.endedAt ?? now) - view.startedAt - view.pausedMs);
  return (
    <section aria-label="Goal" className="enter-up overflow-hidden rounded-2xl bg-raised shadow-card">
      <div className="flex items-center pr-1.5 transition-colors hover:bg-hover">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => controller.setCardOpen(cardKey, !open)}
          className="flex h-10 min-w-0 flex-1 items-center gap-2.5 pl-3.5 text-left"
        >
          <TargetIcon size={15} className="shrink-0 text-subtle" />
          <span className="text-sm font-medium text-fg">Goal</span>
          <span className={cn("shrink-0 rounded-md px-1.5 py-px text-2xs font-medium", PILL[view.tone])}>{view.label}</span>
          <span className="shrink-0 text-xs text-subtle tabular-nums">{Math.round(view.percent)}%</span>
          {!open ? <span className="min-w-0 truncate text-xs text-muted">{view.objective}</span> : null}
          <span className="flex-1" />
          {elapsed !== null ? <span className="shrink-0 text-xs text-subtle tabular-nums">{formatDuration(elapsed) || "0s"}</span> : null}
          <CaretDownIcon size={14} className={cn("shrink-0 text-subtle transition-transform duration-200", !open && "-rotate-90")} />
        </button>
        <CloseCard label="Hide the goal" onClose={() => controller.setCardHidden(cardKey, true)} />
      </div>
      {open ? <GoalBody view={view} elapsed={elapsed} now={now} {...props} /> : null}
    </section>
  );
}

function GoalBody(props: { view: GoalView; elapsed: number | null; now: number; sessionId: string; running: boolean; readOnly: boolean }) {
  const controller = useController();
  const { view } = props;
  const models = useApp((s) => s.models);
  // The same turns the token count covers, priced at each call's own model rate.
  const spend = useMemo(() => {
    const fold = controller.store.get().threads[props.sessionId]?.fold;
    if (!fold) {
      return null;
    }
    let cost = 0;
    let currency: string | null = null;
    let complete = true;
    let priced = false;
    for (const turnId of view.turnIds) {
      const turn = turnCost(fold, turnId, models);
      if (!turn) {
        continue;
      }
      priced = true;
      cost += turn.cost;
      currency = currency ?? turn.currency;
      complete = complete && turn.complete;
    }
    return priced ? { cost, currency, complete } : null;
  }, [view, models, controller, props.sessionId]);
  const busy = useApp((s) => Boolean(s.busy[`goal:${props.sessionId}`]));
  const muse = view.tokensUsed !== null && view.tokensUsed > 0 ? ` Muse's own count at its last goal update: ${formatTokens(view.tokensUsed)}.` : "";
  const lastUpdate = view.lastProgressAt ?? view.endedAt;
  const newGoal = () => {
    // Keep an unsent draft: it becomes the start of the objective, and nothing is sent until the user does.
    const draft = document.querySelector<HTMLTextAreaElement>("textarea")?.value.trim() ?? "";
    controller.prefillComposer(props.sessionId, !draft ? "/goal " : /^\/goal\b/i.test(draft) ? draft : `/goal ${draft}`);
    // The composer takes the text on its next render; put the caret after it.
    requestAnimationFrame(() => {
      const composer = document.querySelector<HTMLTextAreaElement>("textarea[aria-autocomplete], textarea");
      composer?.focus();
      composer?.setSelectionRange(composer.value.length, composer.value.length);
    });
  };
  return (
    <div className="px-3.5 pb-3">
      <p className="line-clamp-3 text-sm text-pretty text-fg [overflow-wrap:anywhere]" title={view.objective}>
        {view.objective}
      </p>
      <div
        role="progressbar"
        aria-label="Goal progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(view.percent)}
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-active"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", FILL[view.tone])} style={{ width: `${view.percent}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-5">
        <Metric label={view.tone === "active" ? "Running for" : "Ran for"} value={props.elapsed === null ? "Not known" : formatDuration(props.elapsed) || "0s"} />
        <Metric label="Turns" value={String(view.turns)} />
        <Tip label={`Input and output tokens of this goal's model calls.${muse}`}>
          <div tabIndex={0} className="min-w-0 cursor-default">
            <Metric label="Tokens" value={view.tokenBudget ? `${formatTokens(view.tokens)} of ${formatTokens(view.tokenBudget)}` : formatTokens(view.tokens)} />
          </div>
        </Tip>
        <Tip
          label={`What this goal's work would have cost at published API rates.${
            spend && !spend.complete ? " One of its models has no listed price, so the real figure is higher." : ""
          }`}
        >
          <div tabIndex={0} className="min-w-0 cursor-default">
            <Metric
              label="Cost"
              value={spend ? `${spend.complete ? "" : "≥ "}${formatCost(spend.cost, spend.currency ?? undefined)}` : "Not known"}
            />
          </div>
        </Tip>
        <Metric label="Last update" value={lastUpdate ? relativeTime(new Date(lastUpdate).toISOString(), props.now) : "None yet"} />
      </dl>
      {/* What Muse is on and plans next only means something while the goal is still open. */}
      {(view.tone === "active" || view.tone === "paused" || view.tone === "attention") && (view.currentWork || view.nextWork) ? (
        <dl className="mt-2.5 flex flex-col gap-1 text-xs">
          {view.currentWork ? <Work label="Now" text={view.currentWork} /> : null}
          {view.nextWork ? <Work label="Next" text={view.nextWork} /> : null}
        </dl>
      ) : null}
      {props.readOnly ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Pausing keeps the goal and stops Muse starting new work on it; stopping only ends the running turn. */}
          {view.tone === "active" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void controller.goalAction(props.sessionId, "pause")}>
              <PauseIcon size={13} /> Pause goal
            </Button>
          ) : null}
          {view.tone === "active" && props.running ? (
            <Button size="sm" variant="ghost" onClick={() => void controller.stop(props.sessionId)}>
              <SquareIcon size={12} /> Stop turn
            </Button>
          ) : null}
          {(view.tone === "paused" || view.tone === "attention") && !props.running ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void controller.continueGoal(props.sessionId, view.objective, view.status)}
            >
              <PlayIcon size={13} /> {view.tone === "paused" ? "Resume goal" : "Keep going"}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={newGoal}>
            {view.tone === "active" ? "Change goal" : "New goal"}
          </Button>
          {view.tone !== "done" && view.tone !== "ended" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void controller.goalAction(props.sessionId, "clear")}>
              <XIcon size={13} /> Clear
            </Button>
          ) : null}
        </div>
      )}
    </div>
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

function Work(props: { label: string; text: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-9 shrink-0 text-subtle">{props.label}</dt>
      <dd className="min-w-0 text-muted [overflow-wrap:anywhere]">{props.text}</dd>
    </div>
  );
}
