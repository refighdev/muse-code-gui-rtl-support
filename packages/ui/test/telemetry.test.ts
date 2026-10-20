import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEvents, emptyFold, type ThreadFold } from "../src/model/fold.js";
import { formatCompactTokens, formatDuration, formatExactTokens, formatTokensPerSecond } from "../src/model/format.js";
import { sessionTelemetry, timePillLabel, usagePillLabel } from "../src/model/usage.js";
import type { ViewEvent } from "../src/types.js";
import { historyEvents } from "./fixtures/probe.js";

function calls(entries: Record<string, unknown>[]): ViewEvent[] {
  return entries.map((params, index) => ({
    method: "session/tokenUsage",
    params: { sessionId: "s1", viewCursor: `v:${index}`, ...params },
  }));
}

function started(turnId: string): ViewEvent {
  return { method: "turn/started", params: { turnId } };
}

function foldWith(events: ViewEvent[]): ThreadFold {
  return applyEvents(emptyFold(), events);
}

describe("session telemetry", () => {
  it("uses the provider's cache-read counter without double counting or exceeding the prompt", () => {
    const fold = foldWith(calls([
      { promptTokens: 1000, usage: { outputTokens: 100, cacheReadTokens: 900, cachedTokens: 100 } },
      { promptTokens: 100, usage: { outputTokens: 10, cachedTokens: 500 } },
    ]));
    const t = sessionTelemetry(fold);
    assert.equal(t.cachedTokens, 1000);
    assert.equal(t.cacheHitPct, 91);
  });

  it("keeps cumulative token totals when only the tail of a thread is loaded", () => {
    const whole = sessionTelemetry(foldWith(historyEvents));
    const tailFold = foldWith(historyEvents.slice(-12));
    const tail = sessionTelemetry(tailFold);
    assert.equal(tail.promptTokens, whole.promptTokens);
    assert.equal(tail.outputTokens, whole.outputTokens);
    assert.match(timePillLabel(tail), /partial/i);
    assert.doesNotMatch(usagePillLabel(tail), /Cache hit/);
    const loadedPrompt = Object.values(tailFold.meta.calls).reduce((sum, call) => sum + call.promptTokens, 0);
    assert.equal(tail.uncachedTokens + tail.cachedTokens, loadedPrompt);
  });

  it("marks counts as a lower bound when truncated history has no cumulative totals", () => {
    const t = sessionTelemetry(foldWith(calls([{ promptTokens: 1000, usage: { outputTokens: 100, cachedTokens: 900 } }])), true);
    assert.equal(t.partial, true);
    assert.equal(t.totalsComplete, false);
    assert.equal(usagePillLabel(t), "1.1K+ tok");
    assert.match(timePillLabel(t), /Partial/);
  });

  it("keeps loaded cache counts separate from authoritative session totals", () => {
    const t = sessionTelemetry(foldWith(calls([{
      promptTokens: 1000,
      usage: { outputTokens: 100, cachedTokens: 900 },
      cumulative: { promptTokens: 10000, outputTokens: 1000, totalTokens: 11000 },
    }])));
    assert.equal(t.totalTokens, 11000);
    assert.equal(t.uncachedTokens, 100);
    assert.equal(t.cachedTokens, 900);
    assert.equal(t.cacheHitPct, 90);
    assert.equal(usagePillLabel(t), "11K tok");
  });

  it("retains reported usage even when no call history is available", () => {
    const fold = emptyFold();
    fold.meta.tokenTotals = { promptTokens: 900, outputTokens: 100, totalTokens: 1000 };
    const t = sessionTelemetry(fold);
    assert.equal(t.partial, true);
    assert.equal(t.totalsComplete, true);
    assert.equal(t.steps, 0);
    assert.equal(usagePillLabel(t), "1K tok");
  });

  it("sums every call, taking speed and time only from the calls that timed", () => {
    const fold = foldWith([
      started("t1"),
      started("t2"),
      started("t3"),
      ...calls([
        { turnId: "t1", durationMs: 1000, usage: { outputTokens: 100 } },
        { turnId: "t1", durationMs: 1000, usage: { outputTokens: 24 } },
        { turnId: "t2", usage: { outputTokens: 40 } },
        { turnId: "t2", usage: { outputTokens: 40 } },
        { turnId: "t2", usage: { outputTokens: 40 } },
        { turnId: "t3", usage: { outputTokens: 40 } },
        { turnId: "t3", usage: { outputTokens: 40 } },
        { turnId: "t3", usage: { outputTokens: 40 } },
      ]),
    ]);
    const t = sessionTelemetry(fold);
    assert.equal(t.turns, 3);
    assert.equal(t.steps, 8);
    assert.equal(t.timedCalls, 2);
    assert.equal(t.durationMs, 2000);
    // 124 output tokens over the timed calls' 2 s; the untimed calls count nowhere in the speed.
    assert.equal(t.tokensPerSecond, 62);
    assert.equal(t.outputTokens, 364);
    assert.equal(t.cacheHitPct, null);
  });

  it("reads cache hit and cache write off the raw per-call counters", () => {
    const fold = foldWith(
      calls([
        { promptTokens: 100_000, usage: { outputTokens: 10_000, cachedTokens: 87_000, reasoningTokens: 700 } },
        { usage: { outputTokens: 2_000, cacheWriteTokens: 5_000 } },
      ]),
    );
    const t = sessionTelemetry(fold);
    assert.equal(t.promptTokens, 100_000);
    assert.equal(t.cachedTokens, 87_000);
    assert.equal(t.cacheWriteTokens, 5_000);
    assert.equal(t.reasoningTokens, 700);
    assert.equal(t.outputTokens, 12_000);
    assert.equal(t.cacheHitPct, 87);
  });

  it("groups output tokens per model, stripping the contributor suffix for display", () => {
    const fold = foldWith(
      calls([
        { modelId: "muse-spark", usage: { outputTokens: 300 } },
        { modelId: "muse-spark", durationMs: 1000, usage: { outputTokens: 100 } },
        { modelId: "muse-spark-contributor", usage: { outputTokens: 50 } },
      ]),
    );
    const t = sessionTelemetry(fold);
    assert.deepEqual(
      t.models.map((model) => ({ name: model.name, calls: model.calls, outputTokens: model.outputTokens })),
      [
        { name: "muse-spark", calls: 2, outputTokens: 400 },
        { name: "muse-spark", calls: 1, outputTokens: 50 },
      ],
    );
  });

  it("counts a turn the moment it starts, and nothing on an empty thread", () => {
    const live = sessionTelemetry(foldWith([started("t9")]));
    assert.equal(live.turns, 1);
    assert.equal(live.steps, 0);
    assert.equal(live.tokensPerSecond, null);
    assert.equal(live.cacheHitPct, null);
    const empty = sessionTelemetry(emptyFold());
    assert.equal(empty.turns, 0);
    assert.equal(empty.steps, 0);
    assert.deepEqual(empty.models, []);
  });
});

describe("telemetry pill labels", () => {
  it("labels the time pill with turns, steps and speed, dropping the speed when nothing timed", () => {
    const timed = sessionTelemetry(
      foldWith([
        started("t1"),
        started("t2"),
        started("t3"),
        ...calls([
          { turnId: "t1", durationMs: 1000, usage: { outputTokens: 100 } },
          { turnId: "t1", durationMs: 1000, usage: { outputTokens: 24 } },
          { turnId: "t2", usage: { outputTokens: 40 } },
          { turnId: "t2", usage: { outputTokens: 40 } },
          { turnId: "t2", usage: { outputTokens: 40 } },
          { turnId: "t3", usage: { outputTokens: 40 } },
          { turnId: "t3", usage: { outputTokens: 40 } },
          { turnId: "t3", usage: { outputTokens: 40 } },
        ]),
      ]),
    );
    assert.equal(timePillLabel(timed), "3 turns · 8 steps · 62 tok/s");

    const untimed = sessionTelemetry(
      foldWith([
        started("t1"),
        ...calls([
          { turnId: "t1", usage: { outputTokens: 10 } },
          { turnId: "t1", usage: { outputTokens: 10 } },
          { turnId: "t1", usage: { outputTokens: 10 } },
          { turnId: "t1", usage: { outputTokens: 10 } },
        ]),
      ]),
    );
    assert.equal(timePillLabel(untimed), "1 turn · 4 steps");

    const single = sessionTelemetry(
      foldWith([started("t1"), ...calls([{ turnId: "t1", usage: { outputTokens: 10 } }])]),
    );
    assert.equal(timePillLabel(single), "1 turn · 1 step");
  });

  it("labels the usage pill with the compact total and the cache hit, when there is cache data", () => {
    const cached = sessionTelemetry(
      foldWith(calls([{ promptTokens: 100_000, usage: { outputTokens: 152_000, cachedTokens: 87_000 } }])),
    );
    assert.equal(usagePillLabel(cached), "252K tok · Cache hit 87%");

    const uncached = sessionTelemetry(foldWith(calls([{ usage: { outputTokens: 18_400 } }])));
    assert.equal(usagePillLabel(uncached), "18.4K tok");
  });
});

describe("telemetry formatters", () => {
  it("formats tokens per second with one decimal below 100 and a whole number above", () => {
    assert.equal(formatTokensPerSecond(62), "62 tok/s");
    assert.equal(formatTokensPerSecond(7.25), "7.3 tok/s");
    assert.equal(formatTokensPerSecond(125.4), "125 tok/s");
  });

  it("formats model time from milliseconds up to hours", () => {
    assert.equal(formatDuration(820), "820ms");
    assert.equal(formatDuration(42_000), "42s");
    assert.equal(formatDuration(64_000), "1m 4s");
    assert.equal(formatDuration(3_720_000), "1h 2m");
    assert.equal(formatDuration(null), "");
  });

  it("formats exact token counts with thousands separators", () => {
    assert.equal(formatExactTokens(999), "999");
    assert.equal(formatExactTokens(252_343), "252,343");
    assert.equal(formatExactTokens(1_234_567), "1,234,567");
  });

  it("keeps one decimal on compact pill totals until a hundred thousand", () => {
    assert.equal(formatCompactTokens(364), "364");
    assert.equal(formatCompactTokens(18_400), "18.4k");
    assert.equal(formatCompactTokens(252_000), "252k");
  });
});

describe("session statistics default", () => {
  it("stays off until it is switched on, for fresh and revived prefs alike", async () => {
    const { defaultPrefs, revivePrefs } = await import("../src/model/store.js");
    assert.equal(defaultPrefs().showTelemetry, false);
    assert.equal(revivePrefs({}, defaultPrefs()).showTelemetry, false);
    assert.equal(revivePrefs({ showTelemetry: true }, defaultPrefs()).showTelemetry, true);
  });
});
