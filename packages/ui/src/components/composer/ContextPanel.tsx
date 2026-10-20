import { CaretDownIcon, CaretRightIcon } from "../ui/icons.js";
import { Popover } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";
import { shallowEqual, useApp, useController } from "../../app/context.js";
import { formatDuration, formatTokens, modelDisplayName } from "../../model/format.js";
import {
  contextBreakdown,
  contextUsageOf,
  sessionUsage,
  type ContextBreakdown,
  type SessionUsage,
  type SliceKey,
} from "../../model/usage.js";
import { Tip, FLOATING } from "../ui/overlays.js";
import { cn } from "../ui/primitives.js";
import { Collapse } from "../ui/sourced.js";

const SLICE_COLOR: Record<SliceKey, string> = {
  prompts: "bg-chart-1",
  replies: "bg-chart-2",
  tools: "bg-chart-3",
  subagents: "bg-chart-4",
  summary: "bg-chart-6",
  system: "bg-chart-5",
};

function share(part: number, whole: number | null): string {
  if (!whole) {
    return "";
  }
  const value = (part / whole) * 100;
  return value > 0 && value < 0.1 ? "<0.1%" : `${value.toFixed(1)}%`;
}

function money(value: number, currency: string | null): string {
  const prefix = !currency || currency === "USD" ? "$" : `${currency} `;
  return `${prefix}${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function duration(ms: number): string {
  return ms > 0 ? formatDuration(ms) || "0s" : "0s";
}

/** The composer's context ring. Opens the context window and session usage panel. */
export function ContextMeter(props: { sessionId: string }) {
  const usage = useApp((s) => {
    const fold = s.threads[props.sessionId]?.fold;
    return fold ? contextUsageOf(fold, s.models) : null;
  }, shallowEqual);
  if (!usage || !usage.windowTokens) {
    return null;
  }
  const fill = Math.min(1, usage.usedTokens / usage.windowTokens);
  const percent = fill < 0.01 ? "<1%" : `${Math.round(fill * 100)}%`;
  const tone = usage.pressure === "blocked" ? "text-danger" : usage.pressure === "warning" ? "text-warn" : "text-accent-text";
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  return (
    <Popover.Root>
      <Tip label={`${formatTokens(usage.usedTokens)} of ${formatTokens(usage.windowTokens)} tokens in context`}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`Context window ${percent} used`}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-2xs text-subtle tabular-nums transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="-rotate-90">
              <circle cx="8" cy="8" r={radius} fill="none" stroke="var(--border-strong)" strokeWidth="2" />
              <circle
                cx="8"
                cy="8"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${Math.max(circumference * fill, fill > 0 ? 1.2 : 0)} ${circumference}`}
                className={tone}
              />
            </svg>
            {percent}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={6}
          {...FLOATING}
          className="pop z-[var(--z-dropdown)] max-h-[var(--radix-popover-content-available-height)] w-[360px] max-w-[calc(100dvw-24px)] overflow-y-auto rounded-xl bg-raised text-fg shadow-pop outline-none"
        >
          <ContextPanel sessionId={props.sessionId} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Mounted only while the popover is open, so a streaming thread does not recompute it. */
function ContextPanel(props: { sessionId: string }) {
  const controller = useController();
  const fold = useApp((s) => s.threads[props.sessionId]?.fold ?? null);
  const readOnly = useApp((s) => Boolean(s.threads[props.sessionId]?.readOnly));
  const models = useApp((s) => s.models);
  const [expanded, setExpanded] = useState(false);
  const breakdown = useMemo(() => (fold ? contextBreakdown(fold, models) : null), [fold, models]);
  const usage = useMemo(() => (fold ? sessionUsage(fold, models) : null), [fold, models]);
  if (!breakdown || !usage) {
    return null;
  }
  return (
    <div>
      <section className="px-3.5 pt-3 pb-3">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-100 hover:bg-hover"
        >
          <span className="text-sm text-muted">Context window</span>
          <span className="flex-1" />
          <span className="text-xs text-muted tabular-nums">
            {formatTokens(breakdown.used)} / {formatTokens(breakdown.window)} ({share(breakdown.used, breakdown.window)})
          </span>
          <CaretDownIcon size={14} className={cn("shrink-0 text-subtle transition-transform duration-150 ease-out", expanded && "rotate-180")} />
        </button>
        <SegmentBar breakdown={breakdown} />
        <Collapse open={expanded}>
          <Breakdown breakdown={breakdown} usage={usage} />
        </Collapse>
        <div className="mt-2.5 flex items-center gap-3 text-xs">
          <Pressure pressure={breakdown.pressure} />
          <span className="flex-1" />
          <button
            type="button"
            disabled={readOnly}
            onClick={() => void controller.compact(props.sessionId)}
            className="shrink-0 font-medium text-accent-text underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-40"
          >
            Compact session
          </button>
        </div>
      </section>
      <Divider />
      <ThisSession usage={usage} />
      <Divider />
      <Tokens usage={usage} />
      <Divider />
      <Activity usage={usage} />
    </div>
  );
}

function SegmentBar(props: { breakdown: ContextBreakdown }) {
  const { slices, used, window } = props.breakdown;
  const whole = window ?? used;
  return (
    <div
      role="img"
      aria-label={`${share(used, window)} of the context window used`}
      className="mt-2 flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-active"
    >
      {slices.map((slice) => (
        <span
          key={slice.key}
          className={cn("h-full shrink-0 first:rounded-l-full", SLICE_COLOR[slice.key])}
          // A sliver stays visible even for a category far under one percent.
          style={{ width: `${Math.max((slice.tokens / whole) * 100, 0.6)}%` }}
        />
      ))}
    </div>
  );
}

function Breakdown(props: { breakdown: ContextBreakdown; usage: SessionUsage }) {
  const { breakdown, usage } = props;
  const toolTokens = usage.tools.reduce((total, tool) => total + tool.tokens, 0);
  const toolCalls = usage.tools.reduce((total, tool) => total + tool.calls, 0);
  const subagentTokens = usage.subagents.reduce((total, agent) => total + agent.tokens, 0);
  return (
    <div className="pt-3">
      <ul className="flex flex-col gap-1.5">
        {breakdown.slices.map((slice) => (
          <Row key={slice.key} swatch={SLICE_COLOR[slice.key]} label={slice.label} value={`≈${formatTokens(slice.tokens)}`} share={share(slice.tokens, breakdown.window)} />
        ))}
        {breakdown.free !== null ? (
          <Row swatch="bg-active" label="Free space" value={formatTokens(breakdown.free)} share={share(breakdown.free, breakdown.window)} />
        ) : null}
      </ul>
      {usage.tools.length > 0 ? (
        <Group
          label="Tool results this session"
          total={`≈${formatTokens(toolTokens)}`}
          count={`${toolCalls}`}
          rows={usage.tools.map((tool) => ({ key: tool.tool, label: tool.tool, value: `≈${formatTokens(tool.tokens)}`, aside: `${tool.calls}×` }))}
        />
      ) : null}
      {usage.subagents.length > 0 ? (
        <Group
          label="Subagents"
          total={formatTokens(subagentTokens)}
          count={`${usage.subagents.length}`}
          rows={usage.subagents.map((agent) => ({ key: agent.itemId, label: agent.label, value: formatTokens(agent.tokens) }))}
        />
      ) : null}
      <p className="mt-2.5 text-2xs leading-4 text-subtle">
        Muse reports the total. The split marked ≈ is estimated from this thread&apos;s text.
      </p>
    </div>
  );
}

function Row(props: { swatch: string; label: string; value: string; share: string }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-[3px]", props.swatch)} />
      <span className="min-w-0 flex-1 truncate text-fg">{props.label}</span>
      <span className="w-16 shrink-0 text-right text-muted tabular-nums">{props.value}</span>
      <span className="w-12 shrink-0 text-right font-medium text-fg tabular-nums">{props.share}</span>
    </li>
  );
}

function Group(props: { label: string; total: string; count: string; rows: { key: string; label: string; value: string; aside?: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs transition-colors duration-100 hover:bg-hover"
      >
        <CaretRightIcon size={12} className={cn("size-2.5 shrink-0 text-subtle transition-transform duration-150 ease-out", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate text-fg">{props.label}</span>
        <span className="w-16 shrink-0 text-right text-muted tabular-nums">{props.total}</span>
        <span className="w-12 shrink-0 text-right text-muted tabular-nums">{props.count}</span>
      </button>
      <Collapse open={open}>
        <ul className="mt-1 flex max-h-44 flex-col gap-1 overflow-y-auto pl-[18px]">
          {props.rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2 text-xs text-muted">
              <span className="min-w-0 flex-1 truncate font-mono text-2xs" title={row.label}>
                {row.label}
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums">{row.value}</span>
              <span className="w-12 shrink-0 text-right tabular-nums">{row.aside ?? ""}</span>
            </li>
          ))}
        </ul>
      </Collapse>
    </div>
  );
}

function Pressure(props: { pressure: string }) {
  if (props.pressure === "blocked") {
    return <span className="font-medium text-danger-text">Full. Compact the session to continue.</span>;
  }
  if (props.pressure === "warning") {
    return <span className="font-medium text-warn-text">Filling up</span>;
  }
  return <span className="text-muted">Plenty of room</span>;
}

function Divider() {
  return <div aria-hidden="true" className="mx-3.5 h-px bg-line" />;
}

function Heading(props: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-xs font-medium text-fg">{props.children}</h3>
      <span className="flex-1" />
      {props.aside ? <span className="min-w-0 truncate text-xs text-muted">{props.aside}</span> : null}
    </div>
  );
}

function ThisSession(props: { usage: SessionUsage }) {
  const { usage } = props;
  const cost =
    usage.cost === null ? (
      <Tip label="Muse's catalog lists no price for the models used here">
        <span className="cursor-default text-fg" tabIndex={0}>
          Not listed
        </span>
      </Tip>
    ) : (
      <span className="text-fg tabular-nums" title={usage.costComplete ? "Estimated from catalog prices" : "Some calls used a model without a price"}>
        {usage.costComplete ? "≈" : "≥"}
        {money(usage.cost, usage.currency)}
      </span>
    );
  return (
    <section className="px-3.5 py-3">
      <Heading>This session</Heading>
      <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
        <span className="flex min-w-0 gap-1.5">
          <span className="text-muted">Cost</span>
          {cost}
        </span>
        <span className="flex min-w-0 gap-1.5 tabular-nums">
          <span className="text-muted">Lines</span>
          <span className="text-ok-text">+{usage.lines.added}</span>
          <span className="text-danger-text">−{usage.lines.removed}</span>
        </span>
        <span className="flex min-w-0 gap-1.5">
          <span className="text-muted">Cache hit</span>
          <span className="text-fg tabular-nums">{usage.cacheHit === null ? "none yet" : `${Math.round(usage.cacheHit * 100)}%`}</span>
        </span>
      </div>
    </section>
  );
}

function Tokens(props: { usage: SessionUsage }) {
  const { usage } = props;
  const modelLabel = usage.models.length === 1 ? modelDisplayName(usage.models[0]?.modelId) : usage.models.length > 1 ? `${usage.models.length} models` : null;
  return (
    <section className="px-3.5 py-3">
      <Heading aside={modelLabel}>Tokens</Heading>
      <dl className="mt-1 divide-y divide-line text-xs">
        <Line label="Input" hint="Prompt tokens, each counted once" value={formatTokens(usage.promptTokens)} />
        <Line label="Output" value={formatTokens(usage.outputTokens)} />
        {usage.reasoningTokens > 0 ? <Line label="Reasoning" hint="Part of the output" value={formatTokens(usage.reasoningTokens)} /> : null}
        <Line label="Cache read" value={formatTokens(usage.cacheReadTokens || usage.cachedTokens)} />
        <Line label="Cache write" value={formatTokens(usage.cacheWriteTokens)} />
        <Line label="Total" value={formatTokens(usage.totalTokens)} strong />
      </dl>
      {usage.models.length > 1 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {usage.models.map((model) => (
            <li key={model.modelId} className="flex items-center gap-2 text-muted">
              <span className="min-w-0 flex-1 truncate">{modelDisplayName(model.modelId)}</span>
              <span className="tabular-nums">{model.calls} calls</span>
              <span className="w-14 text-right tabular-nums">{formatTokens(model.promptTokens + model.outputTokens)}</span>
              <span className="w-14 text-right tabular-nums">{model.cost === null ? "" : money(model.cost, usage.currency)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Line(props: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <dt className={cn(props.strong ? "font-medium text-fg" : "text-muted")}>
        {props.label}
        {props.hint ? <span className="ml-1.5 text-subtle">{props.hint}</span> : null}
      </dt>
      <span className="flex-1" />
      <dd className={cn("tabular-nums", props.strong ? "font-medium text-fg" : "text-fg")}>{props.value}</dd>
    </div>
  );
}

function Activity(props: { usage: SessionUsage }) {
  const { usage } = props;
  return (
    <section className="px-3.5 pt-3 pb-3.5">
      <Heading>Activity</Heading>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-5 gap-y-1 text-xs">
        <Pair label="Turns" value={`${usage.turns}`} />
        <Pair label="Model calls" value={`${usage.calls}`} />
        <Pair label="Time working" value={duration(usage.workedMs)} />
        <Pair label="Model time" value={duration(usage.modelMs)} />
        {usage.firstTokenMs !== null ? <Pair label="First token" value={duration(usage.firstTokenMs)} /> : null}
        {usage.lines.files > 0 ? <Pair label="Files changed" value={`${usage.lines.files}`} /> : null}
      </dl>
      {usage.compactions.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {usage.compactions.map((record) => (
            <li key={record.itemId} className="flex items-center gap-2 text-muted">
              <span className="min-w-0 flex-1 truncate">
                {record.trigger === "auto" ? "Automatic compaction" : "Compaction"}
                {record.outcome && record.outcome !== "compacted" ? ` (${record.outcome})` : ""}
              </span>
              {record.before !== null && record.after !== null ? (
                <span className="tabular-nums">
                  {formatTokens(record.before)} → {formatTokens(record.after)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Pair(props: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{props.label}</dt>
      <dd className="text-fg tabular-nums">{props.value}</dd>
    </div>
  );
}
