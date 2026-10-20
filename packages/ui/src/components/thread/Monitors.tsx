import { EyeIcon, StopCircleIcon } from "../ui/icons.js";
import { useMemo } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { formatDuration } from "../../model/format.js";
import { activeMonitors } from "../../model/monitor.js";
import { Tip } from "../ui/overlays.js";
import { Button } from "../ui/primitives.js";

/**
 * The monitors a thread has watching in the background, above the composer: what each one watches, for how
 * long, and a Stop button. The thread can look finished while these keep going, so they stay in view.
 */
export function Monitors(props: { sessionId: string }) {
  const controller = useController();
  const fold = useApp((s) => s.threads[props.sessionId]?.fold ?? null);
  const monitors = useMemo(() => (fold ? activeMonitors(fold) : []), [fold]);
  const busy = useApp((s) => s.busy);
  const now = useNow(1000, monitors.length > 0);
  if (monitors.length === 0) {
    return null;
  }
  return (
    <section aria-label="Monitors" className="rounded-xl bg-raised px-2.5 py-1.5 shadow-card">
      <p className="flex items-center gap-1.5 py-0.5 text-xs text-muted">
        <EyeIcon size={12} className="shrink-0 text-accent-text" aria-hidden="true" />
        <span className="font-medium text-fg">Watching</span>
        <span>
          {monitors.length === 1 ? "1 monitor" : `${monitors.length} monitors`} · Muse wakes up when something happens
        </span>
      </p>
      <ul className="flex flex-col">
        {monitors.map((monitor) => (
          <li key={monitor.itemId} className="flex min-w-0 items-center gap-2 py-1">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-fg" title={monitor.description ?? monitor.command ?? undefined}>
                {monitor.description ?? monitor.command ?? "Monitor"}
                {monitor.persistent ? <span className="ml-1.5 text-2xs text-subtle">persistent</span> : null}
              </span>
              {monitor.description && monitor.command ? (
                <span className="block truncate font-mono text-2xs text-subtle" title={monitor.command}>
                  {monitor.command}
                </span>
              ) : null}
            </span>
            {monitor.startedAt ? (
              <span className="shrink-0 text-2xs text-subtle tabular-nums">{formatDuration(Math.max(0, now - monitor.startedAt))}</span>
            ) : null}
            <Tip label="Stop watching. Muse replies once to confirm it stopped.">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-2 text-xs"
                loading={Boolean(busy[`task:${props.sessionId}:${monitor.itemId}`])}
                onClick={() => void controller.taskAction(props.sessionId, "stop", monitor.itemId)}
              >
                <StopCircleIcon size={12} /> Stop
              </Button>
            </Tip>
          </li>
        ))}
      </ul>
    </section>
  );
}
