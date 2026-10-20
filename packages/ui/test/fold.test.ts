import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addEcho,
  applyEvent,
  applyEvents,
  buildTurns,
  inheritedTurns,
  sideStart,
  emptyFold,
  foldFromLoad,
  gateFor,
  requirementIndex,
  updateEcho,
} from "../src/model/fold.js";
import type { ViewEvent } from "../src/types.js";
import { historyEvents, liveEvents } from "./fixtures/probe.js";

function foldAll(events: ViewEvent[]) {
  return applyEvents(emptyFold(), events);
}

describe("thread fold against a real muse transcript", () => {
  it("drops a prompt's local copy once its turn ends, landed or not", () => {
    const sending = addEcho(emptyFold(), { localId: "e1", text: "hello", turnId: null, disposition: "sending", createdAt: 1 });
    const started = updateEcho(sending, "e1", { turnId: "t1", disposition: "started" });
    assert.equal(started.echoes.length, 1);

    // The turn died before Muse committed the prompt, so nothing in the transcript matches the echo.
    const failed = applyEvent(started, {
      method: "turn/completed",
      params: { sessionId: "s1", turnId: "t1", terminal: "failed", error: { kind: "rateLimit", message: "quota", retryable: true } },
      at: 2,
    });
    assert.equal(failed.echoes.length, 0, "a failed turn takes its pending bubble with it");

    const quiet = applyEvent(updateEcho(sending, "e1", { turnId: "t2", disposition: "started" }), {
      method: "turn/completed",
      params: { sessionId: "s1", turnId: "t2", terminal: "completed" },
      at: 3,
    });
    assert.equal(quiet.echoes.length, 0, "a turn that committed no prompt item leaves no ghost either");
  });


  it("folds the live stream into three finished turns", () => {
    const fold = liveEvents.reduce(applyEvent, emptyFold());
    const turns = buildTurns(fold);
    assert.equal(turns.length, 3);
    assert.equal(fold.activeTurnId, null);

    const [pong, shell, question] = turns;
    assert.equal(pong?.prompt?.text, "Reply with exactly one word: pong");
    assert.equal(pong?.final?.text, "pong");
    assert.equal(pong?.entries.length, 0, "reminder children stay hidden");
    assert.equal(pong?.info?.durationMs, 42316);

    assert.equal(shell?.entries.length, 1);
    assert.equal(shell?.entries[0]?.kind, "toolCall");
    assert.equal(shell?.entries[0]?.tool, "bash");
    assert.match(shell?.entries[0]?.visibleOutput ?? "", /README\.md/);
    assert.match(shell?.final?.text ?? "", /printed 4 entries/);

    assert.equal(question?.entries[0]?.tool, "request_user_input");
    assert.equal(question?.final?.text, "Blue");
    assert.deepEqual(Object.keys(fold.userInputs), []);
    const settled = Object.values(fold.settled)[0];
    assert.equal(settled?.outcome, "answered");
    assert.equal(settled?.answers[0]?.selectedLabel, "Blue");

    assert.equal(fold.meta.contextUsage?.windowTokens, 1007997);
    assert.equal(fold.meta.tokenTotals?.totalTokens, 108605);
    assert.equal(fold.meta.approvalMode, "onRequest");
    assert.equal(fold.meta.modelId, "muse-spark-1.3-contributor");
  });

  it("shows a turn as running with its streaming reply inline", () => {
    const firstDelta = liveEvents.findIndex((e) => e.method === "item/delta");
    const fold = foldAll(liveEvents.slice(0, firstDelta + 1));
    assert.notEqual(fold.activeTurnId, null);
    const [turn] = buildTurns(fold);
    assert.equal(turn?.running, true);
    assert.equal(turn?.final, null);
    const reply = turn?.entries.find((e) => e.kind === "agentMessage");
    assert.equal(reply?.text, "pong");
    assert.equal(reply?.status, "inProgress");
  });

  it("parks a pending question until it settles", () => {
    const requested = liveEvents.findIndex((e) => e.method === "userInput/requested");
    const fold = foldAll(liveEvents.slice(0, requested + 1));
    const [pending] = Object.values(fold.userInputs);
    assert.equal(pending?.questions[0]?.question, "Which color do you prefer?");
    const toolItem = Object.values(fold.items).find((i) => i.tool === "request_user_input");
    assert.equal(gateFor(fold, toolItem?.itemId ?? "")?.kind, "input");
  });

  it("renders paged history the same as the live stream", () => {
    const live = buildTurns(foldAll(liveEvents));
    const history = buildTurns(foldAll(historyEvents));
    assert.deepEqual(
      history.map((t) => [t.prompt?.text, t.final?.text, t.entries.map((e) => e.kind)]),
      live.map((t) => [t.prompt?.text, t.final?.text, t.entries.map((e) => e.kind)]),
    );
  });

  it("never duplicates items when history and live events overlap", () => {
    const fold = applyEvents(foldAll(historyEvents), liveEvents);
    const ids = fold.order;
    assert.equal(new Set(ids).size, ids.length);
    const live = foldAll(liveEvents);
    assert.equal(fold.order.length, live.order.length);
    const reply = Object.values(fold.items).find((i) => i.kind === "agentMessage" && i.text === "pong");
    assert.equal(reply?.revision, 2, "the higher live revision wins over the paged one");
  });

  it("keeps streamed text when the final arrives empty and ignores late deltas", () => {
    let fold = applyEvent(emptyFold(), {
      method: "item/started",
      params: { sessionId: "s", item: { itemId: "m1", kind: "agentMessage", status: "inProgress", revision: 1, turnId: "t1" } },
    });
    fold = applyEvent(fold, { method: "item/delta", params: { sessionId: "s", itemId: "m1", delta: "Hello world" } });
    fold = applyEvent(fold, {
      method: "item/completed",
      params: { sessionId: "s", item: { itemId: "m1", kind: "agentMessage", status: "completed", revision: 2, turnId: "t1", text: "" } },
    });
    assert.equal(fold.items["m1"]?.text, "Hello world");
    fold = applyEvent(fold, { method: "item/delta", params: { sessionId: "s", itemId: "m1", delta: " again" } });
    assert.equal(fold.items["m1"]?.text, "Hello world");
  });

  it("streams reasoning summaries and tool output by field path", () => {
    let fold = applyEvent(emptyFold(), {
      method: "item/started",
      params: { sessionId: "s", item: { itemId: "r1", kind: "reasoning", status: "inProgress", revision: 1, turnId: "t1" } },
    });
    fold = applyEvents(fold, [
      { method: "item/delta", params: { itemId: "r1", field: "summary.0", delta: "Checking " } },
      { method: "item/delta", params: { itemId: "r1", field: "summary.0", delta: "tests" } },
      { method: "item/delta", params: { itemId: "r1", field: "summary.1", delta: "Then build" } },
      { method: "item/delta", params: { itemId: "x9", field: "output", delta: "npm ok" } },
    ]);
    assert.deepEqual(fold.items["r1"]?.summary, ["Checking tests", "Then build"]);
    assert.equal(fold.items["x9"]?.kind, "toolCall");
    assert.equal(fold.items["x9"]?.visibleOutput, "npm ok");
  });

  it("tracks approvals from request to resolution", () => {
    const request = {
      sessionId: "s",
      approvalId: "a1",
      itemId: "tool1",
      currentRequirementId: { approvalId: "a1", sourceIndex: 0 },
      availableChoices: [{ choiceId: "yes", label: "Allow once", decision: "approved", scope: "once" }],
      subject: { kind: "shell", command: "rm -rf dist" },
    };
    let fold = applyEvent(emptyFold(), { method: "approval/requested", params: request });
    assert.equal(gateFor(fold, "tool1")?.kind, "approval");
    fold = applyEvent(fold, { method: "approval/resolved", params: { sessionId: "s", approvalId: "a1", decision: "approved", resolvedBy: "user" } });
    assert.deepEqual(fold.approvals, {});
    assert.equal(fold.resolved["a1"]?.decision, "approved");
    fold = applyEvent(fold, { method: "approval/requested", params: request });
    assert.deepEqual(fold.approvals, {}, "a redelivered request for a resolved approval stays resolved");
  });

  it("asks again for the next stage of a piped command under the same approval id", () => {
    const stage = (sourceIndex: number) => ({
      sessionId: "s",
      approvalId: "p1",
      itemId: "pipe1",
      currentRequirementId: { approvalId: "p1", sourceIndex },
      availableChoices: [{ choiceId: "yes", label: "Allow once", decision: "approved", scope: "once" }],
      subject: { kind: "shell", stages: [{ argv: ["cat", "a"], position: 0, totalStages: 2 }, { argv: ["rm", "b"], position: 1, totalStages: 2 }] },
    });
    const resolve = { method: "approval/resolved", params: { sessionId: "s", approvalId: "p1", decision: "approved", resolvedBy: "user" } };
    let fold = applyEvent(emptyFold(), { method: "approval/requested", params: stage(0) });
    fold = applyEvent(fold, resolve);
    assert.equal(fold.resolved["p1"]?.stage, 0);
    fold = applyEvent(fold, { method: "approval/requested", params: stage(0) });
    assert.deepEqual(fold.approvals, {}, "stage 0 redelivered stays resolved");
    fold = applyEvent(fold, { method: "approval/requested", params: stage(1) });
    assert.equal(gateFor(fold, "pipe1")?.kind, "approval", "stage 1 asks");
    assert.equal(fold.resolved["p1"], undefined);
    fold = applyEvent(fold, { method: "approval/requested", params: stage(0) });
    assert.equal(requirementIndex(fold.approvals["p1"]), 1, "a late stage 0 redelivery keeps stage 1 pending");
    fold = applyEvent(fold, resolve);
    assert.equal(fold.resolved["p1"]?.stage, 1);
    fold = applyEvent(fold, resolve);
    assert.equal(fold.resolved["p1"]?.stage, 1, "a duplicate resolve keeps the recorded stage");
    fold = applyEvent(fold, { method: "approval/reviewing", params: stage(1) });
    assert.deepEqual(fold.reviewing, {}, "a late hold for a decided stage is ignored");
  });

  it("shows an auto-reviewer hold as reviewing, not as a pending approval (Muse 1.4.9)", () => {
    const ids = { sessionId: "s", approvalId: "a2", itemId: "tool2", currentRequirementId: { approvalId: "a2", sourceIndex: 0 } };
    let fold = applyEvent(emptyFold(), { method: "approval/reviewing", params: ids });
    assert.deepEqual(fold.reviewing, { a2: true });
    assert.deepEqual(fold.approvals, {}, "nothing to decide while the reviewer holds it");
    const request = { ...ids, availableChoices: [{ choiceId: "yes", label: "Allow once", decision: "approved", scope: "once" }], subject: { kind: "shell", command: "ls" } };
    fold = applyEvent(fold, { method: "approval/requested", params: request });
    assert.deepEqual(fold.reviewing, {}, "a release hands the decision to the user");
    assert.equal(gateFor(fold, "tool2")?.kind, "approval");

    let settled = applyEvent(emptyFold(), { method: "approval/reviewing", params: ids });
    settled = applyEvent(settled, { method: "approval/resolved", params: { sessionId: "s", approvalId: "a2", decision: "approved", resolvedBy: "autoReviewer" } });
    assert.deepEqual(settled.reviewing, {});
    assert.deepEqual(settled.approvals, {});
    settled = applyEvent(settled, { method: "approval/reviewing", params: ids });
    assert.deepEqual(settled.reviewing, {}, "a late notice for a settled approval stays settled");

    let ended = applyEvent(emptyFold(), { method: "approval/reviewing", params: ids });
    ended = applyEvent(ended, { method: "turn/completed", params: { turnId: "t1", terminal: "interrupted" } });
    assert.deepEqual(ended.reviewing, {}, "a hold ends with its turn even without a resolve");
  });

  it("drops a reviewing hold on load when the server lists it as pending", () => {
    const ids = { sessionId: "s", approvalId: "a3", itemId: "tool3", currentRequirementId: { approvalId: "a3", sourceIndex: 0 } };
    const request = { ...ids, availableChoices: [], subject: { kind: "shell", command: "ls" } };
    const load = (approvals: unknown[]) =>
      foldFromLoad({
        session: null,
        msp: null,
        events: [{ method: "approval/reviewing", params: ids }],
        truncated: false,
        pending: { approvals: approvals as never[], userInputs: [] },
        readOnly: false,
        readOnlyReason: null,
      });
    assert.deepEqual(load([]).reviewing, { a3: true });
    assert.deepEqual(load([request]).reviewing, {});
    assert.ok(load([request]).approvals["a3"]);
  });

  it("records failures, retries and cancellations per turn", () => {
    const fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1000 },
      { method: "turn/retryScheduled", params: { turnId: "t1", attempt: 1, maxAttempts: 3, nextAttempt: 2, reason: "rate limited", retryDelayMs: 2000 } },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed", error: { kind: "modelError", message: "Provider down", retryable: true } }, at: 5000 },
    ]);
    assert.equal(fold.activeTurnId, null);
    assert.equal(fold.turns["t1"]?.terminal, "failed");
    assert.equal(fold.turns["t1"]?.error?.message, "Provider down");
    assert.equal(fold.turns["t1"]?.retry, undefined);
    assert.equal(fold.turns["t1"]?.startedAt, 1000);
  });

  it("leaves out the thread's turns Muse copies into a new side chat", () => {
    const fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "copy" } },
      { method: "item/completed", params: { item: { itemId: "u1", kind: "userMessage", turnId: "copy", revision: 1, status: "completed", text: "what is this repo about?" } } },
      {
        method: "turn/completed",
        params: { turnId: "copy", terminal: "failed", error: { kind: "modelError", message: "uncounted source run mirrored from the exact prefix (ADR 28290 D2)", retryable: true } },
      },
      { method: "turn/started", params: { turnId: "own" } },
      { method: "item/completed", params: { item: { itemId: "u2", kind: "userMessage", turnId: "own", revision: 1, status: "completed", text: "hi" } } },
      { method: "turn/completed", params: { turnId: "own", terminal: "failed", error: { kind: "modelError", message: "Provider down", retryable: true } } },
    ]);
    assert.deepEqual(buildTurns(fold).map((turn) => turn.turnId), ["own"], "a real failure still shows");
  });

  it("leaves out the turns a side chat inherits from its thread, completed or not", () => {
    const opened = Date.parse("2026-10-09T01:13:24.775Z");
    const fold = applyEvents(emptyFold(), [
      { method: "item/completed", params: { item: { itemId: "u1", kind: "userMessage", turnId: "old", revision: 1, status: "completed", text: "hi", recordedAt: "2026-10-09T00:36:40Z" } } },
      { method: "item/completed", params: { item: { itemId: "f1", kind: "fileChange", turnId: "old", revision: 1, status: "completed", recordedAt: "2026-10-09T00:37:00Z" } } },
      { method: "item/completed", params: { item: { itemId: "a1", kind: "agentMessage", turnId: "old", revision: 1, status: "completed", text: "Hi!", recordedAt: "2026-10-09T00:37:02Z" } } },
      { method: "turn/started", params: { turnId: "own" } },
      { method: "item/completed", params: { item: { itemId: "u2", kind: "userMessage", turnId: "own", revision: 1, status: "completed", text: "test", recordedAt: "2026-10-09T01:13:26Z" } } },
    ]);
    const inherited = inheritedTurns(fold, opened);
    assert.deepEqual([...inherited], ["old"]);
    assert.deepEqual(buildTurns(fold, inherited).map((turn) => turn.turnId), ["own"]);
    assert.deepEqual(buildTurns(fold).map((turn) => turn.turnId), ["old", "own"], "an ordinary thread keeps every turn");
    assert.equal(inheritedTurns(fold, null).size, 0);
  });

  it("dates a side chat from its creation, and nothing else", () => {
    assert.equal(sideStart({ sideOf: "main", createdAt: "2026-10-09T01:13:24.775Z" }), Date.parse("2026-10-09T01:13:24.775Z"));
    assert.equal(sideStart({ sideOf: null, createdAt: "2026-10-09T01:13:24.775Z" }), null);
    assert.equal(sideStart({ sideOf: "main", createdAt: "not a date" }), null);
    assert.equal(sideStart(undefined), null);
  });

  it("drops the local echo once the prompt comes back from the stream", () => {
    let fold = addEcho(emptyFold(), { localId: "l1", text: "hello  there", turnId: null, disposition: "sending", createdAt: 1 });
    fold = updateEcho(fold, "l1", { turnId: "t1", disposition: "started" });
    assert.equal(fold.echoes[0]?.turnId, "t1");
    fold = applyEvent(fold, {
      method: "item/completed",
      params: { item: { itemId: "u1", kind: "userMessage", status: "completed", revision: 1, turnId: "t1", text: "hello there" } },
    });
    assert.equal(fold.echoes.length, 0);

    let raced = applyEvent(emptyFold(), {
      method: "item/completed",
      params: { item: { itemId: "u2", kind: "userMessage", status: "completed", revision: 1, turnId: "t2", text: "fast" } },
    });
    raced = addEcho(raced, { localId: "l2", text: "fast", turnId: null, disposition: "sending", createdAt: 1 });
    raced = updateEcho(raced, "l2", { turnId: "t2", disposition: "started" });
    assert.equal(raced.echoes.length, 0, "an echo whose prompt already landed is dropped on ack");
  });

  it("clears a slash turn's echo once a revision carries the shown text, or once its turn finishes", () => {
    let fold = addEcho(emptyFold(), { localId: "l1", text: "/plan tidy", turnId: null, disposition: "sending", createdAt: 1 });
    // The live start carries only the instructions the model got.
    fold = applyEvent(fold, {
      method: "item/started",
      params: { item: { itemId: "u1", kind: "userMessage", status: "inProgress", revision: 1, turnId: "t1", text: "Use skill bundled:plan first" } },
    });
    fold = updateEcho(fold, "l1", { turnId: "t1", disposition: "started" });
    assert.equal(fold.echoes.length, 1, "nothing matched the shown text yet");
    fold = applyEvent(fold, {
      method: "item/completed",
      params: {
        item: { itemId: "u1", kind: "userMessage", status: "completed", revision: 2, turnId: "t1", text: "Use skill bundled:plan first", displayText: "/plan tidy" },
      },
    });
    assert.equal(fold.echoes.length, 0, "the revision with the shown text clears it");

    let stray = addEcho(emptyFold(), { localId: "l2", text: "typed", turnId: "t2", disposition: "started", createdAt: 1 });
    stray = applyEvent(stray, {
      method: "item/completed",
      params: { item: { itemId: "u2", kind: "userMessage", status: "completed", revision: 1, turnId: "t2", text: "sent" } },
    });
    assert.equal(stray.echoes.length, 1);
    stray = applyEvent(stray, { method: "turn/completed", params: { turnId: "t2", terminal: "completed" } });
    assert.equal(stray.echoes.length, 0, "a finished turn whose prompt landed needs no local copy");
  });

  it("keeps queued prompts until their turn launches or is reclaimed", () => {
    let fold = addEcho(emptyFold(), { localId: "q1", text: "next", turnId: "t5", disposition: "queued", createdAt: 1 });
    fold = applyEvent(fold, { method: "turn/started", params: { turnId: "t5" } });
    assert.equal(fold.echoes[0]?.disposition, "started");
    fold = addEcho(fold, { localId: "q2", text: "later", turnId: "t6", disposition: "queued", createdAt: 2 });
    fold = applyEvent(fold, { method: "turn/unqueued", params: { turnId: "t6", commandId: "t6" } });
    assert.deepEqual(fold.echoes.map((e) => e.localId), ["q1"]);
  });

  it("marks a turn retracted only when Muse accepted the retract (Muse 1.4.10)", () => {
    let fold = applyEvent(emptyFold(), { method: "turn/started", params: { turnId: "t7" } });
    fold = applyEvent(fold, { method: "turn/retracted", params: { turnId: "t7", commandId: "c7", outcome: "declined" } });
    assert.equal(fold.turns["t7"]?.retracted, undefined, "a declined retract leaves the turn running");
    fold = applyEvent(fold, { method: "turn/retracted", params: { turnId: "t7", commandId: "c7" } });
    assert.equal(fold.turns["t7"]?.retracted, true, "no outcome reads as accepted");
    fold = applyEvent(fold, { method: "turn/retracted", params: { turnId: "t8", commandId: "c8", outcome: "accepted" } });
    assert.equal(fold.turns["t8"]?.retracted, true);
  });

  it("builds a fold from a resume load with the server's pending set", () => {
    const requested = liveEvents.findIndex((e) => e.method === "userInput/requested");
    const pendingInput = liveEvents[requested]?.params;
    const fold = foldFromLoad({
      session: null,
      msp: { status: "running", activeTurnId: "t-live", modelId: "m", approvalMode: "denyUnmatched", workspaceRoot: "/w", turnCount: 3 },
      events: historyEvents,
      truncated: false,
      pending: { approvals: [], userInputs: [pendingInput as never] },
      readOnly: false,
      readOnlyReason: null,
    });
    assert.equal(fold.activeTurnId, "t-live");
    assert.equal(Object.keys(fold.userInputs).length, 1);
    assert.equal(fold.meta.approvalMode, "onRequest", "events win over the resume snapshot");
  });

  it("does not show a prompt twice when the thread reloads while it is in flight (#55)", () => {
    const load = (events: ViewEvent[]) => ({
      session: null,
      msp: { status: "running", activeTurnId: "t2", modelId: "m", approvalMode: "onRequest", workspaceRoot: "/w", turnCount: 2 },
      events,
      truncated: false,
      pending: { approvals: [], userInputs: [] },
      readOnly: false,
      readOnlyReason: null,
    });
    const said = (itemId: string, turnId: string, text: string): ViewEvent => ({
      at: 1,
      method: "item/completed",
      params: { item: { itemId, kind: "userMessage", status: "completed", revision: 1, turnId, text } },
    });
    let previous = addEcho(emptyFold(), { localId: "l1", text: "continue", turnId: "t2", disposition: "started", createdAt: 1 });
    previous = addEcho(previous, { localId: "l2", text: "later", turnId: "t3", disposition: "queued", createdAt: 2 });
    previous = addEcho(previous, { localId: "l3", text: "continue", turnId: null, disposition: "sending", createdAt: 3 });

    const fold = foldFromLoad(
      load([
        { at: 1, method: "turn/started", params: { turnId: "t1" } },
        said("u1", "t1", "continue"),
        { at: 1, method: "turn/completed", params: { turnId: "t1", terminal: "completed" } },
        { at: 1, method: "turn/started", params: { turnId: "t2" } },
        said("u2", "t2", "continue"),
      ]),
      previous,
    );
    assert.deepEqual(
      fold.echoes.map((e) => e.localId),
      ["l2", "l3"],
      "the acknowledged echo the history already holds goes; a queued one and an unacknowledged one stay",
    );
    const shown = buildTurns(fold).filter((t) => t.prompt?.text === "continue").length + fold.echoes.filter((e) => e.text === "continue" && e.disposition !== "queued").length;
    assert.equal(shown, 3, "two prompts from history plus the one still being sent, each exactly once");
  });

  it("returns the same fold for an empty batch", () => {
    const fold = emptyFold();
    assert.equal(applyEvents(fold, []), fold);
  });
});

describe("subagent children", () => {
  const child = (i: number): ViewEvent => ({
    at: 1,
    method: "item/completed",
    params: {
      sessionId: "s1",
      item: { itemId: `c${i}`, kind: "reminderChild", status: "completed", revision: 1, turnId: "t1", text: "x".repeat(500) },
    },
  });

  it("are left out of the fold, since nothing ever renders them", () => {
    const fold = foldAll([child(1), child(2), child(3)]);
    assert.deepEqual(Object.keys(fold.items), []);
    assert.deepEqual(fold.order, []);
  });

  it("cost a thread nothing as they pile up", () => {
    // A plan that runs subagents produced tens of thousands of these, and keeping them made every later event in the
    // thread slower until it stopped updating at all (#32).
    let fold = emptyFold();
    const started = Date.now();
    for (let i = 0; i < 20_000; i += 1) {
      fold = applyEvent(fold, child(i));
    }
    assert.deepEqual(fold.order, []);
    assert.ok(Date.now() - started < 2_000, `20k subagent children took ${Date.now() - started}ms`);
  });
});
