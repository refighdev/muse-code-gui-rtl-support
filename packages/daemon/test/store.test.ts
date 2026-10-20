import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { MuseGuiStore } from "../src/store.js";

describe("MuseGuiStore", () => {
  it("groups sessions under projects by directory", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const project = store.upsertProject("D:\\work\\musegui");
    assert.equal(project.displayName, "musegui");
    assert.equal(project.pinned, false);
    const same = store.upsertProject("D:\\work\\musegui");
    assert.equal(same.id, project.id);
    const session = store.recordSession({ id: "s1", projectId: project.id });
    assert.equal(session.turnCount, 0);
    assert.equal(session.origin, "musegui");
    store.recordTurn("t1", "s1");
    store.updateTurnStatus("t1", "completed");
    const sessions = store.listSessionsByProject(project.id);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.turnCount, 1);
    assert.equal(sessions[0]?.id, "s1");
  });

  it("keeps the commands Muse Code GUI ran for a thread", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    store.recordSession({ id: "s1", projectId: project.id });
    store.addShellRun({
      id: "r1",
      sessionId: "s1",
      command: "ls -la",
      exitCode: 0,
      output: "total 0",
      truncated: false,
      durationMs: 12,
      at: "2026-09-11T22:00:00.000Z",
    });
    store.addShellRun({
      id: "r2",
      sessionId: "s1",
      command: "false",
      exitCode: 1,
      output: "",
      truncated: true,
      durationMs: null,
      at: "2026-09-11T22:00:01.000Z",
    });
    const runs = store.listShellRuns("s1");
    assert.deepEqual(runs.map((r) => r.id), ["r1", "r2"]);
    assert.equal(runs[0]?.output, "total 0");
    assert.equal(runs[1]?.exitCode, 1);
    assert.equal(runs[1]?.truncated, true);
    assert.equal(runs[1]?.durationMs, null);
    assert.deepEqual(store.listShellRuns("other"), []);
  });

  it("keeps the bytes of files sent with a prompt", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    store.recordSession({ id: "s1", projectId: project.id });
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const saved = store.addAttachment({
      id: "a1",
      sessionId: "s1",
      turnId: "t1",
      ord: 0,
      name: "shot.png",
      mediaType: "image/png",
      kind: "image",
      width: 10,
      height: 20,
      bytes,
    });
    assert.equal(saved.name, "shot.png");
    assert.equal(saved.kind, "image");
    assert.equal(saved.turnId, "t1");
    assert.deepEqual(store.listAttachments("s1").map((a) => a.id), ["a1"]);
    assert.deepEqual(store.readAttachment("a1")?.bytes, bytes);
    assert.equal(store.readAttachment("missing"), null);
  });

  it("never lets a weaker title source overwrite a stronger one", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    const created = store.recordSession({ id: "s1", projectId: project.id });
    assert.equal(created.titleSource, "placeholder");
    store.recordSession({ id: "s1", projectId: project.id, title: "Fix the build", titleSource: "auto" });
    assert.equal(store.getSession("s1")?.title, "Fix the build");
    store.updateSession("s1", { title: "Renamed", titleSource: "user" });
    store.recordSession({ id: "s1", projectId: project.id, title: "Auto again", titleSource: "auto" });
    assert.equal(store.getSession("s1")?.title, "Renamed");
    assert.equal(store.findSession("s1")?.cwd, "/work/p");
  });

  it("archives sessions and hides projects without deleting them", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    store.recordSession({ id: "s1", projectId: project.id });
    store.recordSession({ id: "s2", projectId: project.id });
    store.updateSession("s1", { archived: true });
    assert.deepEqual(
      store.listSessionsByProject(project.id).map((s) => s.id),
      ["s2"],
    );
    assert.equal(store.listSessionsByProject(project.id, { includeArchived: true }).length, 2);
    store.setHidden("/work/p", true);
    assert.equal(store.listProjects().length, 0);
    assert.equal(store.listProjects({ includeHidden: true }).length, 1);
    store.upsertProject("/work/p");
    assert.equal(store.listProjects().length, 0, "discovery alone must not unhide a project");
  });

  it("orders projects by their latest session activity", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const a = store.upsertProject("/work/a");
    const b = store.upsertProject("/work/b");
    store.recordSession({ id: "a1", projectId: a.id, activityAt: "2026-01-01T00:00:00.000Z" });
    store.recordSession({ id: "b1", projectId: b.id, activityAt: "2026-02-01T00:00:00.000Z" });
    assert.deepEqual(
      store.listProjects().map((p) => p.cwd),
      ["/work/b", "/work/a"],
    );
    store.recordSession({ id: "a1", projectId: a.id, activityAt: "2026-03-01T00:00:00.000Z" });
    assert.equal(store.listProjects()[0]?.cwd, "/work/a");
  });

  it("keeps the order the user dragged projects into", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    store.upsertProject("/work/a");
    store.upsertProject("/work/b");
    store.upsertProject("/work/c");
    store.setProjectOrder(["/work/c", "/work/a", "/work/b"]);
    assert.deepEqual(
      store.listProjects().map((p) => p.cwd),
      ["/work/c", "/work/a", "/work/b"],
    );
    store.setPinned("/work/b", true);
    assert.equal(store.listProjects()[0]?.cwd, "/work/b", "a pinned project still comes first");
  });

  it("pins projects to the top of the sidebar order", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    store.upsertProject("D:\\work\\b");
    store.upsertProject("D:\\work\\a");
    store.setPinned("D:\\work\\a", true);
    const projects = store.listProjects();
    assert.equal(projects[0]?.cwd, "D:\\work\\a");
    assert.equal(projects[0]?.pinned, true);
  });

  it("keeps thread-title settings, defaulting on and merging patches", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    assert.deepEqual(store.getTitleSettings(), { enabled: true, modelId: null });
    assert.deepEqual(store.setTitleSettings({ modelId: "m1" }), { enabled: true, modelId: "m1" });
    assert.deepEqual(store.setTitleSettings({ enabled: false }), { enabled: false, modelId: "m1" });
    assert.deepEqual(store.getTitleSettings(), { enabled: false, modelId: "m1" });
    assert.deepEqual(store.setTitleSettings({ enabled: true, modelId: null }), { enabled: true, modelId: null });
  });

  it("keeps sandbox settings, defaulting to sandbox-on", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    assert.deepEqual(store.getSandboxSettings(), { disabled: false });
    assert.deepEqual(store.setSandboxSettings({ disabled: true }), { disabled: true });
    assert.deepEqual(store.getSandboxSettings(), { disabled: true });
    assert.deepEqual(store.setSandboxSettings({}), { disabled: true }, "an empty patch changes nothing");
    assert.deepEqual(store.setSandboxSettings({ disabled: false }), { disabled: false });
  });

  it("keeps YOLO settings, defaulting to off", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    assert.deepEqual(store.getYoloSettings(), { enabled: false });
    assert.deepEqual(store.setYoloSettings({ enabled: true }), { enabled: true });
    assert.deepEqual(store.getYoloSettings(), { enabled: true });
    assert.deepEqual(store.setYoloSettings({}), { enabled: true }, "an empty patch changes nothing");
    assert.deepEqual(store.setYoloSettings({ enabled: false }), { enabled: false });
  });

  it("keeps feed settings, defaulting to catch-up off", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    assert.deepEqual(store.getFeedSettings(), { catchUp: false });
    assert.deepEqual(store.setFeedSettings({ catchUp: true }), { catchUp: true });
    assert.deepEqual(store.getFeedSettings(), { catchUp: true });
    assert.deepEqual(store.setFeedSettings({}), { catchUp: true }, "an empty patch changes nothing");
    assert.deepEqual(store.setFeedSettings({ catchUp: false }), { catchUp: false });
  });

  it("records each session's sandbox posture at creation, never on touch", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    const created = store.recordSession({ id: "s1", projectId: project.id, sandboxDisabled: true });
    assert.equal(created.sandboxDisabled, true);
    const touched = store.recordSession({ id: "s1", projectId: project.id, turnCount: 2 });
    assert.equal(touched.sandboxDisabled, true, "a later touch keeps the creation posture");
    const unknown = store.recordSession({ id: "s2", projectId: project.id });
    assert.equal(unknown.sandboxDisabled, null, "sessions recorded before tracking stay unknown");
  });

  it("records a session's account and reads it back, defaulting to null", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const project = store.upsertProject("/work/proj");
    const noAccount = store.recordSession({ id: "s1", projectId: project.id });
    assert.equal(noAccount.accountId, null);
    const withAccount = store.recordSession({ id: "s2", projectId: project.id, accountId: "work" });
    assert.equal(withAccount.accountId, "work");
    assert.equal(store.findSession("s2")?.session.accountId, "work");
    assert.equal(store.findSession("s1")?.session.accountId, null);
  });

  it("records which thread a side chat came from, once", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const project = store.upsertProject("/work/proj");
    assert.equal(store.recordSession({ id: "s1", projectId: project.id }).sideOf, null);
    // Seen first without its link, then linked on a later touch.
    store.recordSession({ id: "s2", projectId: project.id });
    assert.equal(store.recordSession({ id: "s2", projectId: project.id, sideOf: "s1" }).sideOf, "s1");
    assert.equal(store.recordSession({ id: "s2", projectId: project.id, sideOf: "other" }).sideOf, "s1", "the link never changes");
    assert.equal(store.findSession("s2")?.session.sideOf, "s1");
  });

  it("never overwrites a session's account on a later touch", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const project = store.upsertProject("/work/proj");
    store.recordSession({ id: "s1", projectId: project.id, accountId: "work" });
    store.recordSession({ id: "s1", projectId: project.id, title: "Renamed" });
    assert.equal(store.findSession("s1")?.session.accountId, "work");
  });

  it("sets and clears a project's default account", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const project = store.upsertProject("/work/proj");
    assert.equal(project.defaultAccountId, null);
    store.setDefaultAccount("/work/proj", "work");
    assert.equal(store.listProjects().find((p) => p.cwd === "/work/proj")?.defaultAccountId, "work");
    store.setDefaultAccount("/work/proj", null);
    assert.equal(store.listProjects().find((p) => p.cwd === "/work/proj")?.defaultAccountId, null);
  });

  it("pins threads and keeps them out of auto-settle", () => {
    const store = new MuseGuiStore();
    after(() => store.close());
    const project = store.upsertProject("/work/proj");
    store.recordSession({ id: "s1", projectId: project.id, activityAt: "2026-01-01T00:00:00.000Z" });
    store.recordSession({ id: "s2", projectId: project.id, activityAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(store.getSession("s1")?.pinned, false);
    store.updateSession("s1", { pinned: true });
    assert.equal(store.getSession("s1")?.pinned, true);
    assert.deepEqual(
      store.listSettleCandidates("2026-06-01T00:00:00.000Z").map((s) => s.id),
      ["s2"],
    );
    store.updateSession("s1", { pinned: false });
    assert.deepEqual(
      store.listSettleCandidates("2026-06-01T00:00:00.000Z").map((s) => s.id).sort(),
      ["s1", "s2"],
    );
  });
});
