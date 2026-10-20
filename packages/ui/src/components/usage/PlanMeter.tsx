import { GaugeIcon } from "../ui/icons.js";
import { useEffect, useMemo } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { relativeTime } from "../../model/format.js";
import { planView, type PlanTone, type PlanView } from "../../model/plan.js";
import { Tip } from "../ui/overlays.js";
import { cn } from "../ui/primitives.js";

const FILL: Record<PlanTone, string> = {
  ok: "bg-accent",
  warn: "bg-warn",
  danger: "bg-danger",
};

const TEXT: Record<PlanTone, string> = {
  ok: "text-muted",
  warn: "text-warn-text",
  danger: "text-danger-text",
};

function usePlan(): PlanView | null {
  const usage = useApp((s) => s.planUsage);
  // A minute is fine for a countdown measured in hours, and it keeps an idle sidebar still.
  const now = useNow(60_000, usage !== null);
  return useMemo(() => planView(usage, now), [usage, now]);
}

/**
 * What the Muse Code plan has left, as Muse itself last reported it: the rolling window and the weekly cap. This is
 * the real allowance, unlike the usage page's cost, which prices the same work at API rates.
 */
export function PlanMeter() {
  const controller = useController();
  const view = usePlan();
  const now = useNow(60_000, view !== null);
  useEffect(() => {
    void controller.loadPlanUsage();
  }, [controller]);
  if (!view) {
    return (
      <section aria-label="Plan usage" className="rounded-2xl bg-raised px-4 py-3.5 shadow-card">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <GaugeIcon size={15} className="text-subtle" /> Plan usage
        </div>
        <p className="mt-1 text-xs text-pretty text-muted">
          Muse reports your plan's allowance with each model call. Send a prompt in any thread and it shows up here.
        </p>
      </section>
    );
  }
  return <MeterCard view={view} title="Plan usage" now={now} />;
}

/** The loaded-state meter card: a tier chip, the rolling window and weekly rows, and when Muse last reported them. */
function MeterCard(props: { view: PlanView; title: string; now: number }) {
  const { view, title, now } = props;
  return (
    <section aria-label={title} className="rounded-2xl bg-raised px-4 py-3.5 shadow-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <GaugeIcon size={15} className="shrink-0 text-subtle" />
        <h2 className="text-sm font-medium text-fg">{title}</h2>
        {view.tier ? <span className="rounded-md bg-active px-1.5 py-px text-2xs font-medium text-muted">{view.tier}</span> : null}
        <span className="flex-1" />
        <span className={cn("text-2xs", view.stale ? "text-warn-text" : "text-subtle")}>{updatedLabel(view, now)}</span>
      </div>
      <div className="mt-3 grid gap-3 @min-[520px]:grid-cols-2">
        {view.rows.map((row) => (
          <div key={row.key} className="min-w-0">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-muted">{row.label}</span>
              <span className="flex-1" />
              <span className={cn("font-medium tabular-nums", TEXT[row.tone])}>{row.used} used</span>
              <span className="shrink-0 text-2xs text-subtle">{view.age === "just now" ? "just now" : `${view.age} ago`}</span>
            </div>
            <div
              role="progressbar"
              aria-label={`${row.label} used`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={row.percent}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-active"
            >
              <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", FILL[row.tone])} style={{ width: `${row.percent}%` }} />
            </div>
            <p className="mt-1 text-2xs text-subtle tabular-nums">{row.resets}</p>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-2xs leading-4 text-pretty text-subtle">
        These come from Muse with each model call, so they only move when you send a prompt from a thread here. Work
        done in the terminal counts against your plan without showing up in this card. Muse sends whole percentages,
        and Meta's usage dashboard can read higher than this.
      </p>
    </section>
  );
}

/**
 * One meter per switchable account that has reported plan usage. Sits below the default `PlanMeter` on the usage
 * page; renders nothing when there is nothing per-account to show, so a single-account setup looks unchanged.
 */
export function AccountMeters() {
  const accounts = useApp((s) => s.accounts);
  const byAccount = useApp((s) => s.planUsageByAccount);
  const withUsage = (accounts ?? []).filter((account) => byAccount[account.id]);
  const now = useNow(60_000, withUsage.length > 0);
  if (withUsage.length === 0) {
    return null;
  }
  return (
    <div className="mb-6 grid gap-3 @min-[720px]:grid-cols-2">
      {withUsage.map((account) => {
        const view = planView(byAccount[account.id], now);
        return view ? <MeterCard key={account.id} view={view} title={account.name} now={now} /> : null;
      })}
    </div>
  );
}

/**
 * Muse reports these numbers with a model call and at no other time, so the reading is always a point in the past.
 * The age therefore sits beside each percentage as well as here, and this line says where the numbers come from.
 */
function updatedLabel(view: PlanView, now: number): string {
  const age = relativeTime(new Date(view.observedAtMs).toISOString(), now);
  return age === "now" ? "Muse reported this just now" : `Muse reported this ${age} ago`;
}

/** The rolling window's percentage, small enough for the sidebar footer; it opens the usage page. */
export function PlanPill() {
  const controller = useController();
  const view = usePlan();
  const first = view?.rows[0];
  if (!view || !first) {
    return null;
  }
  const label = view.rows.map((row) => `${row.label}: ${row.used} used, ${row.resets.toLowerCase()}`).join(". ");
  return (
    <Tip label={label} side="top">
      <button
        type="button"
        aria-label={`Plan usage. ${label}`}
        onClick={() => controller.navigate({ kind: "usage" })}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs font-medium tabular-nums transition-colors duration-100 hover:bg-hover",
          TEXT[first.tone],
        )}
      >
        <GaugeIcon size={12} />
        {first.used}
      </button>
    </Tip>
  );
}
