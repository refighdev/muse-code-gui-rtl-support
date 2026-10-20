import { DatabaseIcon, GaugeIcon } from "../ui/icons.js";
import { Popover } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";
import { useApp } from "../../app/context.js";
import { formatDuration, formatExactTokens, formatTokensPerSecond } from "../../model/format.js";
import {
  sessionTelemetry,
  timePillLabel,
  usagePillLabel,
  type SessionTelemetry,
  type TelemetryModelUsage,
} from "../../model/usage.js";
import { Tip, FLOATING } from "../ui/overlays.js";

/** Which telemetry dialog is open; at most one at a time. */
type TelemetryDialog = "time" | "usage" | null;

/**
 * The two telemetry pills above the composer: what this thread's session did so far, each pill
 * opening its own detail. Pure client-side — every number comes from the thread's fold.
 */
export function TelemetryPills(props: { sessionId: string }) {
  const enabled = useApp((s) => s.prefs.showTelemetry);
  const fold = useApp((s) => s.threads[props.sessionId]?.fold ?? null);
  const truncated = useApp((s) => s.threads[props.sessionId]?.truncated ?? false);
  const telemetry = useMemo(() => (fold ? sessionTelemetry(fold, truncated) : null), [fold, truncated]);
  const [open, setOpen] = useState<TelemetryDialog>(null);
  if (!enabled || !telemetry || !fold) {
    return null;
  }
  // A resumed thread may report cumulative usage even when its call history is unavailable.
  if (telemetry.turns === 0 && telemetry.steps === 0 && telemetry.totalTokens === 0 && !fold.activeTurnId) {
    return null;
  }
  return (
    <div className="flex items-center justify-center gap-1.5">
      <Pill
        icon={<GaugeIcon size={12} />}
        open={open === "time"}
        onOpenChange={(next) => setOpen(next ? "time" : null)}
        label={timePillLabel(telemetry)}
        tip="Timing of this session's model calls"
        aria="Session timing"
      >
        <TimingPanel telemetry={telemetry} />
      </Pill>
      <Pill
        icon={<DatabaseIcon size={12} />}
        open={open === "usage"}
        onOpenChange={(next) => setOpen(next ? "usage" : null)}
        label={usagePillLabel(telemetry)}
        tip="Token usage of this session"
        aria="Session token usage"
      >
        <UsagePanel telemetry={telemetry} />
      </Pill>
    </div>
  );
}

/** One pill with its dialog, after the cost and context meters beside the composer. */
function Pill(props: {
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  tip: string;
  aria: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Tip label={props.tip}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={props.aria}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-2xs text-subtle tabular-nums transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg"
          >
            <span className="shrink-0">{props.icon}</span>
            {props.label}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={6}
          {...FLOATING}
          className="pop z-[var(--z-dropdown)] max-h-[var(--radix-popover-content-available-height)] w-[340px] max-w-[calc(100dvw-24px)] overflow-y-auto rounded-xl bg-raised text-fg shadow-pop outline-none"
        >
          {props.children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** LLM time, steps, request-average speed and how much of the session was actually timed. */
function TimingPanel(props: { telemetry: SessionTelemetry }) {
  const t = props.telemetry;
  return (
    <div className="flex flex-col gap-3 p-3.5">
      <div>
        <p className="text-sm font-semibold text-fg">
          {t.timedCalls > 0 ? formatDuration(t.durationMs) : "—"} <span className="font-normal text-subtle">of model time</span>
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {t.partial
            ? "Partial history: timing, turns and steps cover the loaded calls only."
            : t.timedCalls === t.steps
              ? "Every model call reported how long it took."
              : "Some calls did not report how long they took."}
        </p>
      </div>
      <dl className="flex flex-col gap-1 text-xs">
        <Row label="Steps" value={`${t.steps}`} />
        <Row label="Request average" value={t.tokensPerSecond === null ? "—" : formatTokensPerSecond(t.tokensPerSecond)} />
        <Row label="Timed" value={`${t.timedCalls} of ${t.steps} calls timed`} />
      </dl>
      <ModelBreakdown models={t.models} />
    </div>
  );
}

/** Exact token counts, with the cache split and the same per-model totals as the timing panel. */
function UsagePanel(props: { telemetry: SessionTelemetry }) {
  const t = props.telemetry;
  return (
    <div className="flex flex-col gap-3 p-3.5">
      <div>
        <p className="text-sm font-semibold text-fg">
          {formatExactTokens(t.totalTokens)}{t.totalsComplete ? "" : "+"} <span className="font-normal text-subtle">tokens</span>
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {t.partial
            ? t.totalsComplete
              ? "Session token totals are complete. Cache, reasoning and model details cover loaded calls only."
              : "Partial history: token counts and details cover loaded calls only."
            : "Exact counts over every model call in this thread."}
        </p>
      </div>
      <dl className="flex flex-col gap-1 text-xs">
        <Row label="Output" value={formatExactTokens(t.outputTokens)} />
        {t.reasoningTokens > 0 ? (
          <div className="pl-2 text-2xs text-subtle tabular-nums">
            {t.partial ? "loaded calls include " : "includes "}{formatExactTokens(t.reasoningTokens)} reasoning
          </div>
        ) : null}
        <Row label={t.partial ? "Loaded uncached input" : "Uncached input"} value={formatExactTokens(t.uncachedTokens)} />
        <Row label={t.partial ? "Loaded cached input" : "Cached input"} value={formatExactTokens(t.cachedTokens)} />
        {t.cacheWriteTokens > 0 ? <Row label={t.partial ? "Loaded cache write" : "Cache write"} value={formatExactTokens(t.cacheWriteTokens)} /> : null}
        <Row label={t.partial ? "Loaded cache hit" : "Cache hit"} value={t.cacheHitPct === null ? "—" : `${t.cacheHitPct}%`} />
      </dl>
      <ModelBreakdown models={t.models} />
    </div>
  );
}

function ModelBreakdown(props: { models: TelemetryModelUsage[] }) {
  if (props.models.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      {props.models.map((model) => (
        <div key={model.modelId} className="flex items-baseline justify-between gap-3 text-xs">
          <span className="min-w-0 truncate text-fg">{model.name}</span>
          <span className="shrink-0 text-muted tabular-nums">{model.calls === 1 ? "1 call" : `${model.calls} calls`}</span>
          <span className="w-20 shrink-0 text-right text-muted tabular-nums">{formatExactTokens(model.outputTokens)} out</span>
        </div>
      ))}
    </div>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{props.label}</dt>
      <dd className="tabular-nums text-fg">{props.value}</dd>
    </div>
  );
}
