import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { speechChanges, threadSpeech } from "../src/model/announce.js";
import { emptyFold, type ThreadFold } from "../src/model/fold.js";
import type { ApprovalRequest, UserInputRequest } from "../src/types.js";

function fold(patch: Partial<ThreadFold> = {}, todo: { text: string; status: string }[] | null = null): ThreadFold {
  const base = emptyFold();
  return { ...base, ...patch, meta: { ...base.meta, todoList: todo ?? undefined } } as ThreadFold;
}

const approval = {
  approvalId: "ap1",
  sessionId: "s1",
  availableChoices: [],
  currentRequirementId: null,
  subject: { kind: "shell", command: "npm test" },
} as unknown as ApprovalRequest;

const question = {
  userInputId: "q1",
  sessionId: "s1",
  questions: [{ id: "a", question: "Which database?", options: [], selection: { mode: "single" } }],
} as unknown as UserInputRequest;

describe("thread speech", () => {
  it("says when a turn starts and how it ended, once each", () => {
    const idle = threadSpeech(fold());
    const running = threadSpeech(fold({ activeTurnId: "t1", turns: { t1: { turnId: "t1", startedAt: 1 } } }));
    assert.deepEqual(speechChanges(idle, running), ["Muse is working"]);
    assert.deepEqual(speechChanges(running, running), []);
    const done = threadSpeech(fold({ turns: { t1: { turnId: "t1", startedAt: 1, completedAt: 5, terminal: "completed" } } }));
    assert.deepEqual(speechChanges(running, done), ["Muse finished"]);
    const failed = threadSpeech(
      fold({ turns: { t1: { turnId: "t1", completedAt: 5, terminal: "failed", error: { kind: "x", message: "Rate limited", retryable: true } } } }),
    );
    assert.deepEqual(speechChanges(running, failed), ["The turn failed: Rate limited"]);
    const stopped = threadSpeech(fold({ turns: { t1: { turnId: "t1", completedAt: 5, terminal: "cancelled" } } }));
    assert.deepEqual(speechChanges(running, stopped), ["Stopped"]);
  });

  it("says nothing for the ticking parts of a running turn", () => {
    const a = threadSpeech(fold({ activeTurnId: "t1", turns: { t1: { turnId: "t1", startedAt: 1 } } }));
    const b = threadSpeech(
      fold({ activeTurnId: "t1", turns: { t1: { turnId: "t1", startedAt: 1, stream: { chars: 900, startAt: 1, lastAt: 2 } } } }),
    );
    assert.deepEqual(speechChanges(a, b), []);
  });

  it("announces a new approval or question with what it is about", () => {
    const idle = threadSpeech(fold());
    const asking = threadSpeech(fold({ approvals: { ap1: approval }, userInputs: { q1: question } }));
    assert.deepEqual(speechChanges(idle, asking), ["Muse wants to run a shell command: npm test", "Muse has a question: Which database?"]);
    assert.deepEqual(speechChanges(asking, asking), []);
  });

  it("announces plan steps as they are ticked off", () => {
    const none = threadSpeech(fold());
    const planned = threadSpeech(fold({}, [{ text: "Add the route", status: "pending" }, { text: "Write tests", status: "pending" }]));
    assert.deepEqual(speechChanges(none, planned), ["Muse made a plan with 2 steps"]);
    const one = threadSpeech(fold({}, [{ text: "Add the route", status: "completed" }, { text: "Write tests", status: "inProgress" }]));
    assert.deepEqual(speechChanges(planned, one), ["Plan step done: Add the route. 1 of 2 done"]);
    assert.deepEqual(speechChanges(one, one), []);
  });
});
