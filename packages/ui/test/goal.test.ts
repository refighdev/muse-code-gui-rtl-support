import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEvents, emptyFold } from "../src/model/fold.js";
import { describeTool, toolKind } from "../src/model/format.js";
import { goalPrompt, goalView, parseGoalRecord, statusLabel } from "../src/model/goal.js";
import type { MspItem, ViewEvent } from "../src/types.js";

const T0 = Date.parse("2026-09-11T19:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** A goal tool's output, shaped like Muse's: `{"goal": {...}}` with snake_case fields. */
function record(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    goal: {
      goal_id: "g1",
      objective: "Ship the release",
      status: "active",
      percent_complete: 0,
      current_work: null,
      next_work: null,
      created_at_ms: T0,
      updated_at_ms: T0,
      last_progress_at_ms: null,
      tokens_used: 0,
      token_budget: 500000,
      ...extra,
    },
  });
}

function tool(itemId: string, turnId: string, name: string, output: string, at: number): ViewEvent {
  return {
    method: "item/completed",
    params: { item: { itemId, kind: "toolCall", status: "completed", revision: 1, turnId, tool: name, args: "{}", visibleOutput: output, recordedAt: iso(at) } },
  };
}

function prompt(itemId: string, turnId: string, at: number): ViewEvent {
  return {
    method: "item/completed",
    params: { item: { itemId, kind: "userMessage", status: "completed", revision: 1, turnId, text: "go", recordedAt: iso(at) } },
  };
}

function usage(turnId: string, cursor: string, input: number, output: number): ViewEvent {
  return { method: "session/tokenUsage", params: { turnId, viewCursor: cursor, promptTokens: input, usage: { inputTokens: input, outputTokens: output } } };
}

function goalChanged(goal: Record<string, unknown> | null): ViewEvent {
  return { method: "session/goalChanged", params: { goal } };
}

const BEFORE = [prompt("u0", "t0", T0 - 60_000), usage("t0", "c0", 1000, 100)];
const SET = [
  prompt("u1", "t1", T0 - 2_000),
  tool("g-create", "t1", "create_goal", record(), T0 + 100),
  usage("t1", "c1", 5000, 200),
  goalChanged({ objective: "Ship the release", status: "active", percentComplete: 0 }),
];
const WORK = [
  prompt("u2", "t2", T0 + 60_000),
  usage("t2", "c2", 7000, 300),
  goalChanged({ objective: "Ship the release", status: "active", percentComplete: 40, currentWork: "Writing notes", nextWork: "Tag it" }),
];

describe("goals", () => {
  it("reads Muse's goal record from a goal tool's output", () => {
    const parsed = parseGoalRecord(record({ tokens_used: 1234, last_progress_at_ms: T0 + 5 }));
    assert.equal(parsed?.goalId, "g1");
    assert.equal(parsed?.createdAt, T0);
    assert.equal(parsed?.tokensUsed, 1234);
    assert.equal(parsed?.tokenBudget, 500000);
    assert.equal(parsed?.lastProgressAt, T0 + 5);
    assert.equal(parseGoalRecord('{"goal":{"objective":"cut'), null, "a cut-off output is not a record");
    assert.equal(parseGoalRecord(JSON.stringify({ goal: { status: "active" } })), null);
    assert.equal(parseGoalRecord(undefined), null);
  });

  it("shows a running goal with its progress, and counts only the turns and tokens since it was set", () => {
    const view = goalView(applyEvents(emptyFold(), [...BEFORE, ...SET, ...WORK]));
    assert.ok(view);
    assert.equal(view.objective, "Ship the release");
    assert.equal(view.label, "In progress");
    assert.equal(view.tone, "active");
    assert.equal(view.percent, 40, "the live block wins over the record's 0");
    assert.equal(view.currentWork, "Writing notes");
    assert.equal(view.nextWork, "Tag it");
    assert.equal(view.startedAt, T0);
    assert.equal(view.endedAt, null);
    assert.equal(view.turns, 2, "the turn that set it and the one after, not the one before");
    assert.equal(view.tokens, 5000 + 200 + 7000 + 300);
    assert.equal(view.tokenBudget, 500000);
  });

  it("stops the clock and the count when the goal is done", () => {
    const done = [
      tool("g-done", "t2", "update_goal", record({ status: "complete", percent_complete: 100, updated_at_ms: T0 + 90_000, tokens_used: 12_500 }), T0 + 90_000),
      goalChanged({ objective: "Ship the release", status: "complete", percentComplete: 100 }),
      prompt("u3", "t3", T0 + 200_000),
      usage("t3", "c3", 9000, 900),
    ];
    const view = goalView(applyEvents(emptyFold(), [...BEFORE, ...SET, ...WORK, ...done]));
    assert.equal(view?.label, "Done");
    assert.equal(view?.tone, "done");
    assert.equal(view?.percent, 100);
    assert.equal(view?.endedAt, T0 + 90_000);
    assert.equal(view?.turns, 2, "work after it finished does not count");
    assert.equal(view?.tokensUsed, 12_500);
  });

  it("drops a cleared goal, and falls back to the record when no goal change was seen", () => {
    assert.equal(goalView(applyEvents(emptyFold(), [...SET, goalChanged(null)])), null);
    const recordOnly = goalView(applyEvents(emptyFold(), [prompt("u1", "t1", T0), tool("g-create", "t1", "create_goal", record(), T0 + 100)]));
    assert.equal(recordOnly?.objective, "Ship the release");
    assert.equal(recordOnly?.turns, 1);
    assert.equal(goalView(emptyFold()), null);
  });

  it("stops a paused goal's clock where it paused, and runs it again on resume", () => {
    const paused = applyEvents(emptyFold(), [
      ...SET,
      { method: "session/goalChanged", params: { goal: { objective: "Ship the release", status: "paused", percentComplete: 20 } }, at: T0 + 30_000 },
    ]);
    const view = goalView(paused);
    assert.equal(view?.label, "Paused");
    assert.equal(view?.endedAt, T0 + 30_000, "the pause, not the goal record's older update");
    const resumed = goalView(
      applyEvents(paused, [
        { method: "session/goalChanged", params: { goal: { objective: "Ship the release", status: "active", percentComplete: 20 } }, at: T0 + 60_000 },
      ]),
    );
    assert.equal(resumed?.label, "In progress");
    assert.equal(resumed?.endedAt, null);
  });

  it("leaves paused time, and the turns taken while paused, out of the goal's counts", () => {
    const view = goalView(
      applyEvents(emptyFold(), [
        ...SET,
        { method: "session/goalChanged", params: { goal: { objective: "Ship the release", status: "paused", percentComplete: 20 } }, at: T0 + 30_000 },
        prompt("u-aside", "t-aside", T0 + 50_000),
        usage("t-aside", "c-aside", 8000, 800),
        { method: "session/goalChanged", params: { goal: { objective: "Ship the release", status: "active", percentComplete: 20 } }, at: T0 + 90_000 },
        prompt("u-resume", "t-resume", T0 + 95_000),
        usage("t-resume", "c-resume", 6000, 600),
        { method: "session/goalChanged", params: { goal: { objective: "Ship the release", status: "complete", percentComplete: 100 } }, at: T0 + 120_000 },
      ]),
    );
    assert.equal(view?.pausedMs, 60_000);
    assert.equal(view?.endedAt, T0 + 120_000);
    assert.equal(view?.turns, 2, "the turn that set it and the one after it resumed, not the aside while paused");
    assert.equal(view?.tokens, 5000 + 200 + 6000 + 600);
  });

  it("ignores a goal change that carries no goal, and tolerates odd field types", () => {
    const base = applyEvents(emptyFold(), SET);
    assert.equal(applyEvents(base, [goalChanged({ status: "paused" })]).meta.goal?.status, "active", "a block without an objective changes nothing");
    const odd = goalView(applyEvents(base, [goalChanged({ objective: "Ship the release", status: 7, percentComplete: "50", currentWork: 3 })]));
    assert.equal(odd?.label, "In progress");
    assert.equal(odd?.percent, 0);
    assert.equal(odd?.currentWork, null);
  });

  it("names statuses, known or not, and asks the model to set the goal", () => {
    assert.deepEqual(statusLabel("budget_limited"), { label: "Out of budget", tone: "attention" });
    assert.deepEqual(statusLabel("superseded"), { label: "Replaced", tone: "ended" });
    assert.deepEqual(statusLabel("waiting_on_ci"), { label: "Waiting on ci", tone: "paused" });
    assert.match(goalPrompt("  Ship the release "), /create_goal tool\. Objective: Ship the release\n/);
  });

  it("describes Muse's goal tools as goal steps, not file writes", () => {
    const call = (tool: string, args: Record<string, unknown>, status = "completed") =>
      ({ itemId: "i1", kind: "toolCall", status, revision: 1, tool, args: JSON.stringify(args) }) as MspItem;
    const said = (item: MspItem) => {
      const described = describeTool(item);
      return `${described.verb} ${described.subject ?? ""}`.trim();
    };
    assert.equal(toolKind("create_goal", null), "goal", "not a write, despite the word create");
    assert.equal(said(call("create_goal", { objective: "Ship it" })), "Set a goal Ship it");
    assert.equal(said(call("report_progress", { percent_complete: 33.4, current_work: "Haiku 1" })), "Reported progress 33%");
    assert.equal(describeTool(call("report_progress", { percent_complete: 33, current_work: "Haiku 1" })).note, "Haiku 1");
    assert.equal(said(call("update_goal", { status: "complete" })), "Marked the goal done");
    assert.equal(said(call("update_goal", { status: "blocked" }, "inProgress")), "Updating the goal blocked");
    assert.equal(said(call("get_goal", {})), "Checked the goal");
  });
});
