import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SessionManager,
  isApprovalMode,
  isGoalAction,
  isSubagentAction,
  isWorkflowChildAction,
  parseSubscriptionUsage,
  textInput,
  turnInput,
  type CommandConnection,
} from "../src/sessions.js";

class FakeConnection implements CommandConnection {
  calls: { method: string; params?: Record<string, unknown> }[] = [];
  private replies = new Map<string, unknown>();

  reply(method: string, value: unknown): void {
    this.replies.set(method, value);
  }

  async command(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, params });
    if (this.replies.has(method)) {
      return this.replies.get(method);
    }
    return { ok: true };
  }

  onNotification(): void {}
}

function lastCall(conn: FakeConnection) {
  const call = conn.calls[conn.calls.length - 1];
  assert.ok(call);
  return call as { method: string; params?: Record<string, unknown> };
}

describe("SessionManager", () => {
  it("runs a user shell command and forks a session", async () => {
    const conn = new FakeConnection();
    const manager = new SessionManager(conn);
    await manager.userShell("s1", "git status");
    assert.deepEqual(lastCall(conn), { method: "session/userShell", params: { sessionId: "s1", commandText: "git status" } });
    conn.reply("session/fork", { session: { sessionId: "s2", forkedFrom: { sessionId: "s1" } } });
    const forked = await manager.forkSession("s1");
    assert.equal(forked.sessionId, "s2");
    assert.deepEqual(lastCall(conn), { method: "session/fork", params: { sessionId: "s1", excludeItems: true } });
    conn.reply("session/sideChat", { session: { sessionId: "s3", sideFrom: { sessionId: "s1", commandId: "c1", cutCursor: "x" } } });
    const side = await manager.sideChat("s1");
    assert.equal(side.sessionId, "s3");
    assert.deepEqual(lastCall(conn), { method: "session/sideChat", params: { sessionId: "s1" } });
  });

  it("lists sessions scoped to a workspace", async () => {
    const conn = new FakeConnection();
    conn.reply("session/list", { sessions: [{ session: { sessionId: "s1" } }] });
    const manager = new SessionManager(conn);
    const sessions = await manager.listSessions("/work/proj", 25);
    assert.deepEqual(lastCall(conn), {
      method: "session/list",
      params: { limit: 25, workspaceRoot: "/work/proj" },
    });
    assert.equal(sessions.length, 1);
  });

  it("falls back to an empty list on unexpected shapes", async () => {
    const conn = new FakeConnection();
    conn.reply("session/list", { unexpected: true });
    const manager = new SessionManager(conn);
    assert.deepEqual(await manager.listSessions(), []);
  });

  it("sends attached images as their own prompt parts", async () => {
    const conn = new FakeConnection();
    const manager = new SessionManager(conn);
    await manager.sendTurn("s1", "what is this?", {
      images: [
        { base64Data: "AAAB", mediaType: "image/png", width: 12, height: 8 },
        { base64Data: "AAAC", mediaType: "image/jpeg" },
      ],
    });
    assert.deepEqual(lastCall(conn).params?.["input"], [
      { type: "text", text: "what is this?" },
      { type: "image", base64Data: "AAAB", mediaType: "image/png", width: 12, height: 8 },
      { type: "image", base64Data: "AAAC", mediaType: "image/jpeg" },
    ]);

    await manager.sendTurn("s1", "", { images: [{ base64Data: "AAAD", mediaType: "image/png" }] });
    assert.deepEqual(lastCall(conn).params?.["input"], [{ type: "image", base64Data: "AAAD", mediaType: "image/png" }]);

    assert.deepEqual(turnInput("hello"), [{ type: "text", text: "hello" }]);
  });

  it("starts a session with mode and model, and rejects missing ids", async () => {
    const conn = new FakeConnection();
    conn.reply("session/start", { session: { sessionId: "abc" } });
    const manager = new SessionManager(conn);
    const started = await manager.startSession({
      workspaceRoot: "/work/proj",
      approvalMode: "onRequest",
      modelId: "muse-spark-1.3",
    });
    assert.equal(started.sessionId, "abc");
    assert.deepEqual(conn.calls.at(-2)?.params, {
      workspaceRoot: "/work/proj",
      approvalMode: "onRequest",
    });
    // Muse ignores modelId on session/start, so the model is set with session/setModel instead.
    assert.deepEqual(lastCall(conn), { method: "session/setModel", params: { sessionId: "abc", model: { modelId: "muse-spark-1.3" } } });
    const before = conn.calls.length;
    await manager.startSession({ workspaceRoot: "/work/proj" });
    assert.deepEqual(conn.calls.slice(before).map((c) => c.method), ["session/start"]);
    conn.reply("session/start", { session: {} });
    await assert.rejects(() => manager.startSession({}), /sessionId/);
  });

  it("drives turns: send, steer, interrupt, cancel, unqueue", async () => {
    const conn = new FakeConnection();
    conn.reply("turn/start", { status: "accepted", turnId: "t1", disposition: "started" });
    const manager = new SessionManager(conn);
    const ack = await manager.sendTurn("s1", "hello", { ifBusy: "queue" });
    assert.equal(ack.turnId, "t1");
    assert.equal(ack.status, "accepted");
    assert.deepEqual(lastCall(conn).params, {
      sessionId: "s1",
      input: textInput("hello"),
      ifBusy: "queue",
    });
    await manager.steerTurn("s1", "t1", "actually do X");
    assert.deepEqual(lastCall(conn), {
      method: "turn/steer",
      params: { sessionId: "s1", expectedTurnId: "t1", input: textInput("actually do X") },
    });
    await manager.interruptTurn("s1", "t1", true);
    assert.deepEqual(lastCall(conn).params, { sessionId: "s1", turnId: "t1", retract: true });
    await manager.cancelTurn("s1", "t1");
    assert.deepEqual(lastCall(conn).params, { sessionId: "s1", turnId: "t1" });
    await manager.unqueueTurn("s1", "t2");
    assert.deepEqual(lastCall(conn), {
      method: "turn/unqueue",
      params: { sessionId: "s1", turnId: "t2" },
    });
  });

  it("decides approvals with the race guard intact", async () => {
    const conn = new FakeConnection();
    const manager = new SessionManager(conn);
    await manager.decideApproval({
      sessionId: "s1",
      approvalId: "a1",
      requirementId: { approvalId: "a1", sourceIndex: 0 },
      choiceId: "allow_once",
      feedback: null,
    });
    assert.deepEqual(lastCall(conn), {
      method: "approval/decide",
      params: {
        sessionId: "s1",
        approvalId: "a1",
        requirementId: { approvalId: "a1", sourceIndex: 0 },
        choiceId: "allow_once",
        feedback: null,
      },
    });
  });

  it("resumes, reads, lists models, switches model and mode, answers input", async () => {
    const conn = new FakeConnection();
    const manager = new SessionManager(conn);
    await manager.resumeSession("s1");
    assert.deepEqual(lastCall(conn).params, { sessionId: "s1", excludeItems: false });
    await manager.readSession("s1");
    assert.deepEqual(lastCall(conn).params, { sessionId: "s1", excludeItems: true });
    await manager.listModels("s1");
    assert.deepEqual(lastCall(conn).params, { sessionId: "s1" });
    await manager.setSessionModel("s1", { modelId: "muse-spark-1.3" });
    assert.deepEqual(lastCall(conn).params, {
      sessionId: "s1",
      model: { modelId: "muse-spark-1.3" },
    });
    await manager.setSessionApprovalMode("s1", "denyUnmatched");
    assert.deepEqual(lastCall(conn).params, { sessionId: "s1", mode: "denyUnmatched" });
    await manager.answerUserInput("s1", "u1", [{ questionId: "q1", freeText: "yes" }]);
    assert.deepEqual(lastCall(conn).params, {
      sessionId: "s1",
      userInputId: "u1",
      answers: [{ questionId: "q1", freeText: "yes" }],
    });
  });

  it("sends read-only queries without a minted commandId when the connection supports it", async () => {
    const conn = new FakeConnection();
    const requests: { method: string; params?: Record<string, unknown> }[] = [];
    const queryable: CommandConnection = {
      command: (method, params) => conn.command(method, params),
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === "view/page") {
          return { events: [{ method: "turn/started", params: {} }], nextCursor: "c2" };
        }
        if (method === "approval/listPending") {
          return { approvals: [{ approvalId: "a1" }], userInputs: [] };
        }
        return { sessions: [], nextCursor: null };
      },
      onNotification: () => {},
    };
    const manager = new SessionManager(queryable);
    await manager.listSessions();
    const page = await manager.pageView("s1", { direction: "backward", limit: 10 });
    assert.equal(page.nextCursor, "c2");
    assert.equal(page.events.length, 1);
    const pending = await manager.listPending("s1");
    assert.equal(pending.approvals.length, 1);
    assert.deepEqual(
      requests.map((r) => r.method),
      ["session/list", "view/page", "approval/listPending"],
    );
    assert.deepEqual(requests[1]?.params, { sessionId: "s1", limit: 10, direction: "backward" });
    assert.equal(conn.calls.length, 0);
  });

  it("cancels and clarifies user input prompts", async () => {
    const conn = new FakeConnection();
    const manager = new SessionManager(conn);
    await manager.cancelUserInput("s1", "u1", "not now");
    assert.deepEqual(lastCall(conn), {
      method: "userInput/cancel",
      params: { sessionId: "s1", userInputId: "u1", reason: "not now" },
    });
    await manager.clarifyUserInput("s1", "u1", "Use blue for links only");
    assert.deepEqual(lastCall(conn).params, {
      sessionId: "s1",
      userInputId: "u1",
      clarification: { format: "text", content: "Use blue for links only" },
    });
  });

  it("sets the session's standing reasoning effort and renames the session", async () => {
    const conn = new FakeConnection();
    const manager = new SessionManager(conn);
    await manager.setReasoningEffort("s1", "low");
    assert.deepEqual(lastCall(conn), { method: "session/setReasoningEffort", params: { sessionId: "s1", reasoningEffort: "low" } });
    conn.reply("session/rename", { commandId: "c1", status: "accepted", name: "tidy-api" });
    assert.equal(await manager.renameSession("s1", "tidy-api"), "tidy-api");
    assert.deepEqual(lastCall(conn), { method: "session/rename", params: { sessionId: "s1", name: "tidy-api" } });
  });

  it("drives goals with the objective only on set and edit", async () => {
    const conn = new FakeConnection();
    const manager = new SessionManager(conn);
    conn.reply("goal/set", { commandId: "c1", status: "accepted", turnId: "t9" });
    assert.deepEqual(await manager.goal("s1", "set", "  get tests green  "), { turnId: "t9" });
    assert.deepEqual(lastCall(conn), { method: "goal/set", params: { sessionId: "s1", objective: "get tests green" } });
    await manager.goal("s1", "edit", "ship it");
    assert.deepEqual(lastCall(conn).params, { sessionId: "s1", objective: "ship it" });
    for (const action of ["pause", "resume", "clear"] as const) {
      // An objective on a bare verb is an unknown field Muse rejects, so it never goes out.
      assert.deepEqual(await manager.goal("s1", action, "ignored"), { turnId: null });
      assert.deepEqual(lastCall(conn), { method: `goal/${action}`, params: { sessionId: "s1" } });
    }
    await assert.rejects(() => manager.goal("s1", "set", "   "), /objective/);
    assert.equal(isGoalAction("pause"), true);
    assert.equal(isGoalAction("finish"), false);
  });

  it("controls subagents, background tasks and workflow runs", async () => {
    const conn = new FakeConnection();
    const manager = new SessionManager(conn);
    await manager.subagent("s1", "stop", "sa1", { reason: "wrong file" });
    assert.deepEqual(lastCall(conn), { method: "subagent/stop", params: { sessionId: "s1", subagentId: "sa1", reason: "wrong file" } });
    await manager.subagent("s1", "sendMessage", "sa1", { body: " check the lockfile " });
    assert.deepEqual(lastCall(conn).params, { sessionId: "s1", subagentId: "sa1", body: "check the lockfile" });
    await manager.subagent("s1", "reopen", "sa1", { reason: "not sent", body: "not sent" });
    assert.deepEqual(lastCall(conn), { method: "subagent/reopen", params: { sessionId: "s1", subagentId: "sa1" } });
    await assert.rejects(() => manager.subagent("s1", "followupTask", "sa1", { body: "" }), /message/);
    assert.equal(isSubagentAction("interrupt"), true);
    assert.equal(isSubagentAction("kill"), false);

    await manager.backgroundTask("s1", "item-7");
    assert.deepEqual(lastCall(conn), { method: "task/background", params: { sessionId: "s1", taskId: "item-7" } });
    await manager.stopTask("s1", "item-7");
    assert.deepEqual(lastCall(conn), { method: "task/stop", params: { sessionId: "s1", taskId: "item-7" } });
    await manager.stopAllTasks("s1");
    assert.deepEqual(lastCall(conn), { method: "task/stopAll", params: { sessionId: "s1" } });

    await manager.cancelWorkflow("s1", "run-1");
    assert.deepEqual(lastCall(conn), { method: "workflow/cancel", params: { sessionId: "s1", workflowRunId: "run-1" } });
    await manager.pauseWorkflow("s1", "run-1");
    assert.deepEqual(lastCall(conn), { method: "workflow/pause", params: { sessionId: "s1", workflowRunId: "run-1" } });
    await manager.controlWorkflowChild("s1", "run-1", "child-a", 2, "retry");
    assert.deepEqual(lastCall(conn).params, { sessionId: "s1", workflowRunId: "run-1", childId: "child-a", attempt: 2, action: "retry" });
    assert.equal(isWorkflowChildAction("skip"), true);
    assert.equal(isWorkflowChildAction("rerun"), false);
  });

  it("reads usage, session skills and stored output as queries", async () => {
    const conn = new FakeConnection();
    const requests: { method: string; params?: Record<string, unknown> }[] = [];
    const usage = {
      tier: "high",
      observedAtMs: 1_700_000_000_000,
      window: { usedPercent: 42, resetsAtMs: 1_700_000_900_000, windowDurationMins: 300 },
      weekly: { usedPercent: 18, resetsAtMs: 1_700_400_000_000 },
    };
    const replies: Record<string, unknown> = {
      "usage/read": { usage },
      "skill/list": {
        skills: [
          { selector: "doctor", displayName: "Doctor", description: "Checks the install", source: "bundled" },
          { selector: "acme:deploy", displayName: "deploy", description: "", source: "plugin", pluginId: "acme", argumentHint: "<env>" },
          { displayName: "no selector" },
        ],
      },
      "item/readOutput": { content: "line 1\n", encoding: "utf8", mediaType: "text/plain", offsetBytes: 0, byteLen: 7, eof: true },
    };
    const queryable: CommandConnection = {
      command: (method, params) => conn.command(method, params),
      request: async (method, params) => {
        requests.push({ method, params });
        return replies[method];
      },
      onNotification: () => {},
    };
    const manager = new SessionManager(queryable);
    assert.deepEqual(await manager.readSubscriptionUsage(), { ...usage, weekly: { ...usage.weekly, windowDurationMins: null } });
    replies["usage/read"] = {};
    // No window observed yet is a truthful absence, not an error.
    assert.equal(await manager.readSubscriptionUsage(), null);

    const skills = await manager.listSessionSkills("s1");
    assert.deepEqual(skills.map((s) => s.selector), ["doctor", "acme:deploy"]);
    assert.deepEqual(skills[1], {
      selector: "acme:deploy",
      displayName: "deploy",
      description: "",
      source: "plugin",
      argumentHint: "<env>",
      pluginId: "acme",
    });

    const range = await manager.readItemOutput("s1", "item-3", "bash-ref", { offsetBytes: 0, lengthBytes: 4096 });
    assert.equal(range.eof, true);
    assert.equal(range.content, "line 1\n");
    assert.deepEqual(
      requests.map((r) => r.method),
      ["usage/read", "usage/read", "skill/list", "item/readOutput"],
    );
    assert.deepEqual(requests[3]?.params, { sessionId: "s1", itemId: "item-3", outputRef: "bash-ref", offsetBytes: 0, lengthBytes: 4096 });
    assert.equal(conn.calls.length, 0);
  });

  it("parses only complete subscription usage", () => {
    assert.equal(parseSubscriptionUsage(null), null);
    assert.equal(parseSubscriptionUsage({ tier: "x", observedAtMs: 1, window: { usedPercent: 1 } }), null);
    assert.equal(
      parseSubscriptionUsage({
        observedAtMs: 5,
        window: { usedPercent: 3, resetsAtMs: 9, windowDurationMins: 300 },
        weekly: { usedPercent: 1, resetsAtMs: 10 },
      })?.tier,
      "unknown",
    );
  });

  it("validates the closed approval mode set", () => {
    assert.equal(isApprovalMode("onRequest"), true);
    assert.equal(isApprovalMode("allowAll"), true);
    assert.equal(isApprovalMode("denyUnmatched"), true);
    assert.equal(isApprovalMode("promptUnmatched"), true);
    assert.equal(isApprovalMode("yolo"), false);
  });
});
