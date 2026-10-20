import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEvent, emptyFold } from "../src/model/fold.js";
import { groupByProject, groupByStatus, nestSides, settledEntries, threadStatus, type SidebarEntry } from "../src/model/status.js";
import type { LiveView, ProjectView, SessionSummary } from "../src/types.js";

const BASE = "2026-09-01T00:00:00.000Z";

function session(id: string, patch: Partial<SessionSummary> = {}, live: Partial<LiveView> | null = null): SessionSummary {
  return {
    sessionId: id,
    cwd: "/work/a",
    title: id,
    titleSource: "auto",
    turnCount: 1,
    modelId: null,
    origin: "musegui",
    archived: false,
    createdAt: BASE,
    activityAt: "2026-09-02T00:00:00.000Z",
    settled: false,
    settledAt: null,
    unsettledAt: null,
    pinned: false,
    sandboxDisabled: false,
    accountId: null,
    live: live
      ? { activeTurnId: null, turnStartedAt: null, pendingApprovals: 0, pendingInputs: 0, lastTerminal: null, lastError: null, ...live }
      : null,
    ...patch,
  };
}

describe("threadStatus", () => {
  it("ranks approval over input over running", () => {
    const ctx = { baseline: BASE, active: false };
    assert.equal(threadStatus(session("a", {}, { pendingApprovals: 1, pendingInputs: 1, activeTurnId: "t" }), ctx), "approval");
    assert.equal(threadStatus(session("a", {}, { pendingInputs: 1, activeTurnId: "t" }), ctx), "input");
    assert.equal(threadStatus(session("a", {}, { activeTurnId: "t" }), ctx), "running");
  });

  it("marks finished work unread until the user has seen it", () => {
    const s = session("a", {}, { lastTerminal: "completed" });
    assert.equal(threadStatus(s, { baseline: BASE, active: false }), "unread");
    assert.equal(threadStatus(s, { baseline: BASE, lastSeen: "2026-09-03T00:00:00.000Z", active: false }), "idle");
    assert.equal(threadStatus(s, { baseline: "2026-09-05T00:00:00.000Z", active: false }), "idle", "history from before first run is not unread");
    assert.equal(threadStatus(s, { baseline: BASE, active: true }), "idle");
    const failed = session("b", {}, { lastTerminal: "failed" });
    assert.equal(threadStatus(failed, { baseline: BASE, active: false }), "failed");
  });

  it("prefers the live fold over the server summary once a thread is open", () => {
    const s = session("a", {}, { activeTurnId: "t-old" });
    const fold = applyEvent(emptyFold(), { method: "turn/completed", params: { turnId: "t-old", terminal: "completed" } });
    assert.equal(threadStatus(s, { fold, baseline: "2026-09-05T00:00:00.000Z", active: false }), "idle");
  });
});

describe("sidebar grouping", () => {
  const projects: ProjectView[] = [
    { cwd: "/work/a", displayName: "a", pinned: false, activityAt: BASE, defaultAccountId: null },
    { cwd: "/work/b", displayName: "b", pinned: false, activityAt: BASE, defaultAccountId: null },
  ];
  const entries: SidebarEntry[] = [
    { session: session("old", { createdAt: "2026-09-01T01:00:00.000Z", activityAt: "2026-09-09T00:00:00.000Z" }), status: "idle" },
    { session: session("new", { createdAt: "2026-09-04T00:00:00.000Z" }), status: "unread" },
    { session: session("busy", { createdAt: "2026-09-01T00:30:00.000Z" }), status: "running" },
    { session: session("back", { createdAt: "2026-08-01T00:00:00.000Z", unsettledAt: "2026-09-05T00:00:00.000Z" }), status: "idle" },
    { session: session("shelved", { settled: true, settledAt: "2026-09-03T00:00:00.000Z" }), status: "idle" },
    { session: session("shelved-earlier", { settled: true, settledAt: "2026-09-02T00:00:00.000Z" }), status: "idle" },
    { session: session("woken", { settled: true, settledAt: "2026-09-02T00:00:00.000Z" }, { pendingApprovals: 1 }), status: "approval" },
    { session: session("other", { cwd: "/work/b" }), status: "idle" },
    { session: session("hidden-project", { cwd: "/work/hidden" }), status: "idle" },
  ];

  it("keeps active threads in a stable order and shelves settled ones", () => {
    const groups = groupByProject(projects, entries);
    assert.deepEqual(groups.map((g) => g.project.cwd), ["/work/a", "/work/b"]);
    // Newest by start or return, never by activity: "old" keeps its place though it was busy last.
    assert.deepEqual(groups[0]?.entries.map((e) => e.session.sessionId), ["back", "new", "old", "busy", "woken"]);
    assert.deepEqual(groups[0]?.settled.map((e) => e.session.sessionId), ["shelved", "shelved-earlier"]);
    assert.equal(groups[0]?.attention, 1);
    assert.equal(groups[0]?.running, 1);
    assert.deepEqual(groups[1]?.entries.map((e) => e.session.sessionId), ["other"]);
  });

  it("groups active threads by status and lists settled ones apart", () => {
    const groups = groupByStatus(entries.filter((e) => e.status !== "running"));
    assert.deepEqual(groups.map((g) => g.id), ["attention", "review", "idle"]);
    assert.deepEqual(groups[0]?.entries.map((e) => e.session.sessionId), ["woken"]);
    assert.deepEqual(groups[2]?.entries.map((e) => e.session.sessionId), ["back", "old", "other", "hidden-project"]);
    assert.deepEqual(settledEntries(entries).map((e) => e.session.sessionId), ["shelved", "shelved-earlier"]);
  });

  it("nests side chats under the thread they came from", () => {
    const withSides: SidebarEntry[] = [
      { session: session("side-a", { createdAt: "2026-09-05T00:00:00.000Z", sideOf: "main" }), status: "idle" },
      { session: session("first", { createdAt: "2026-09-04T00:00:00.000Z" }), status: "idle" },
      { session: session("main", { createdAt: "2026-09-01T00:00:00.000Z" }), status: "idle" },
      { session: session("orphan", { createdAt: "2026-09-03T00:00:00.000Z", sideOf: "gone" }), status: "idle" },
    ];
    const listed = groupByProject(projects, withSides)[0]?.entries ?? [];
    assert.deepEqual(listed.map((e) => e.session.sessionId), ["first", "orphan", "main", "side-a"]);
    assert.deepEqual(listed.map((e) => e.nested ?? false), [false, false, false, true]);
    assert.deepEqual(listed.map((e) => e.hasSides ?? false), [false, false, true, false]);
    assert.equal(listed[3]?.lastNested, true);
    // Nothing to nest leaves the list as it was.
    const plain = withSides.slice(1, 3);
    assert.equal(nestSides(plain), plain);
  });

  it("groups pinned threads above the rest, in the same stable order", () => {
    const pinned: SidebarEntry[] = [
      { session: session("first", { createdAt: "2026-09-04T00:00:00.000Z" }), status: "idle" },
      { session: session("pinned-old", { createdAt: "2026-09-01T00:00:00.000Z", pinned: true }), status: "idle" },
      { session: session("pinned-new", { createdAt: "2026-09-02T00:00:00.000Z", pinned: true }), status: "idle" },
    ];
    const groups = groupByProject(projects, pinned);
    assert.deepEqual(groups[0]?.entries.map((e) => e.session.sessionId), ["pinned-new", "pinned-old", "first"]);
    // Unpinning returns each thread to its stable place.
    const unpinned = pinned.map((e) => ({ ...e, session: { ...e.session, pinned: false } }));
    assert.deepEqual(groupByProject(projects, unpinned)[0]?.entries.map((e) => e.session.sessionId), ["first", "pinned-new", "pinned-old"]);
  });

  it("shelves a settled thread even when it is pinned", () => {
    const shelved: SidebarEntry[] = [
      { session: session("kept", { createdAt: "2026-09-01T00:00:00.000Z", pinned: true }), status: "idle" },
      { session: session("shelved-pin", { createdAt: "2026-09-04T00:00:00.000Z", pinned: true, settled: true, settledAt: "2026-09-05T00:00:00.000Z" }), status: "idle" },
    ];
    const groups = groupByProject(projects, shelved);
    assert.deepEqual(groups[0]?.entries.map((e) => e.session.sessionId), ["kept"]);
    assert.deepEqual(groups[0]?.settled.map((e) => e.session.sessionId), ["shelved-pin"]);
  });

  it("lists pinned threads first within each status group", () => {
    const mixed: SidebarEntry[] = [
      { session: session("plain", { createdAt: "2026-09-04T00:00:00.000Z" }), status: "idle" },
      { session: session("starred", { createdAt: "2026-09-01T00:00:00.000Z", pinned: true }), status: "idle" },
    ];
    const groups = groupByStatus(mixed);
    assert.deepEqual(groups[0]?.entries.map((e) => e.session.sessionId), ["starred", "plain"]);
  });
});
