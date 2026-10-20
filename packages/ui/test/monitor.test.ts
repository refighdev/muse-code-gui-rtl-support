import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEvents, buildTurns, emptyFold } from "../src/model/fold.js";
import { describeTool, toolKind } from "../src/model/format.js";
import { activeMonitors, wakeLabels } from "../src/model/monitor.js";
import { threadStatus } from "../src/model/status.js";
import type { MspItem, SessionSummary, ViewEvent } from "../src/types.js";

// Shapes captured from Muse Code 1.4.1 (30 Sep 2026): a `monitor` tool call that stays in progress while it
// watches, a turn Muse starts on its own when the watched command prints, and `cancelled` after task/stop.
const T1 = "01a0ef51-c3b1-7000-b1d8-19422ecd3d73";
const T2 = "01a0ef54-605f-74e0-b5cf-b503c8b884d2";
const MONITOR = "01a0ef51-e84b-7281-83fb-357969352c3c";

function monitorItem(status: string): MspItem {
  return {
    itemId: MONITOR,
    kind: "toolCall",
    turnId: T1,
    revision: status === "inProgress" ? 2 : 3,
    status,
    recordedAt: "2026-09-29T22:38:37.740011Z",
    tool: "monitor",
    callId: "call_01a0ef51e5dc752b9f06a7230b0a3dec",
    args: JSON.stringify({ command: "tail -n 0 -F log.txt", description: "watch log.txt" }),
  } as MspItem;
}

const FIRST_TURN: ViewEvent[] = [
  { method: "turn/started", params: { turnId: T1, commandId: T1 } },
  { method: "item/completed", params: { item: { itemId: "u1", kind: "userMessage", turnId: T1, status: "completed", revision: 1, text: "watch log.txt" } } },
  { method: "item/started", params: { item: monitorItem("inProgress") } },
  { method: "item/completed", params: { item: { itemId: "a1", kind: "agentMessage", turnId: T1, status: "completed", revision: 1, text: "Watching log.txt now." } } },
  { method: "turn/completed", params: { turnId: T1, terminal: "completed" } },
];

// No userMessage: Muse woke the agent because the monitor saw a line.
const WAKE_TURN: ViewEvent[] = [
  { method: "turn/started", params: { turnId: T2, commandId: T2 } },
  { method: "item/completed", params: { item: { itemId: "a2", kind: "agentMessage", turnId: T2, status: "completed", revision: 1, text: 'Saw "ERROR: build failed on step 3".' } } },
  { method: "turn/completed", params: { turnId: T2, terminal: "completed" } },
];

const session = { sessionId: "s1", activityAt: "2026-09-29T22:00:00Z", live: null } as unknown as SessionSummary;

describe("monitors", () => {
  it("reads a monitor tool call as watching, then stopped", () => {
    assert.equal(toolKind("monitor", { command: "tail -F x" }), "monitor");
    const watching = describeTool(monitorItem("inProgress"));
    assert.equal(watching.verb, "Watching");
    assert.equal(watching.subject, "watch log.txt");
    assert.equal(watching.note, "tail -n 0 -F log.txt");
    assert.equal(describeTool(monitorItem("cancelled")).verb, "Stopped watching");
  });

  it("lists the monitors still watching", () => {
    const fold = applyEvents(emptyFold(), FIRST_TURN);
    const monitors = activeMonitors(fold);
    assert.equal(monitors.length, 1);
    assert.equal(monitors[0]?.itemId, MONITOR);
    assert.equal(monitors[0]?.description, "watch log.txt");
    assert.equal(monitors[0]?.command, "tail -n 0 -F log.txt");
    const stopped = applyEvents(fold, [{ method: "item/completed", params: { item: monitorItem("cancelled") } }]);
    assert.equal(activeMonitors(stopped).length, 0);
  });

  it("calls an idle thread with a monitor watching, not idle", () => {
    const fold = applyEvents(emptyFold(), FIRST_TURN);
    const ctx = { fold, lastSeen: "2026-09-30T00:00:00Z", baseline: "2026-09-01T00:00:00Z", active: true };
    assert.equal(threadStatus(session, ctx), "watching");
    const stopped = applyEvents(fold, [{ method: "item/completed", params: { item: monitorItem("cancelled") } }]);
    assert.equal(threadStatus(session, { ...ctx, fold: stopped }), "idle");
    // An unopened thread goes by the server's count.
    const unopened = { ...session, live: { activeTurnId: null, turnStartedAt: null, pendingApprovals: 0, pendingInputs: 0, lastTerminal: null, lastError: null, monitors: 2 } };
    assert.equal(threadStatus(unopened, { baseline: "2026-09-01T00:00:00Z", lastSeen: "2026-09-30T00:00:00Z", active: false }), "watching");
  });

  it("labels the turn a monitor started", () => {
    const turns = buildTurns(applyEvents(emptyFold(), [...FIRST_TURN, ...WAKE_TURN]));
    const labels = wakeLabels(turns);
    const wake = turns.find((t) => t.turnId === T2);
    const first = turns.find((t) => t.turnId === T1);
    assert.equal(labels[wake!.key], "Woken by a monitor: watch log.txt");
    assert.equal(labels[first!.key], undefined);
  });

  it("leaves promptless turns alone in threads that never had a monitor", () => {
    const turns = buildTurns(applyEvents(emptyFold(), WAKE_TURN));
    assert.deepEqual(wakeLabels(turns), {});
  });
});
