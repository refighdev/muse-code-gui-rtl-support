import type { ThreadFold } from "./fold.js";
import { describeApproval } from "./format.js";

/**
 * What a screen reader hears about the open thread: only the changes worth interrupting for. The working
 * label, timers and speeds change every second and stay out of it; VoiceOver would read each tick.
 */
export interface ThreadSpeech {
  /** The turn running now, if any. */
  turnId: string | null;
  /** The most recently finished turn and how it ended. */
  ended: { turnId: string; terminal: string; error: string | null } | null;
  /** Pending approvals and questions, by id, with what to say about each. */
  approvals: Record<string, string>;
  questions: Record<string, string>;
  plan: { text: string; done: boolean }[];
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function threadSpeech(fold: ThreadFold): ThreadSpeech {
  let ended: ThreadSpeech["ended"] = null;
  let endedAt = -Infinity;
  for (const turn of Object.values(fold.turns)) {
    if (turn.turnId === fold.activeTurnId || !turn.terminal || turn.completedAt === undefined) {
      continue;
    }
    if (turn.completedAt > endedAt) {
      endedAt = turn.completedAt;
      ended = { turnId: turn.turnId, terminal: turn.terminal, error: turn.error?.message ?? null };
    }
  }
  const approvals: Record<string, string> = {};
  for (const request of Object.values(fold.approvals)) {
    const { title, detail } = describeApproval(request);
    const line = detail?.split("\n")[0]?.trim();
    const short = line && line.length > 80 ? `${line.slice(0, 80)}…` : line;
    approvals[request.approvalId] = `Muse wants to ${lowerFirst(title)}${short ? `: ${short}` : ""}`;
  }
  const questions: Record<string, string> = {};
  for (const request of Object.values(fold.userInputs)) {
    const first = request.questions?.[0]?.question;
    questions[request.userInputId] = first ? `Muse has a question: ${first}` : "Muse has a question";
  }
  const plan = (fold.meta.todoList ?? []).map((item) => ({ text: item.text, done: item.status === "completed" }));
  return { turnId: fold.activeTurnId, ended, approvals, questions, plan };
}

/**
 * The sentences to announce for a change between two snapshots, in reading order. A turn that starts and
 * a request that appears are said once; a plan step is said when it is ticked off.
 */
export function speechChanges(prev: ThreadSpeech, next: ThreadSpeech): string[] {
  const out: string[] = [];
  if (next.ended && next.ended.turnId !== prev.ended?.turnId) {
    if (next.ended.terminal === "failed") {
      out.push(next.ended.error ? `The turn failed: ${next.ended.error}` : "The turn failed");
    } else if (next.ended.terminal === "cancelled") {
      out.push("Stopped");
    } else {
      out.push("Muse finished");
    }
  }
  if (prev.plan.length === next.plan.length) {
    const ticked = next.plan.filter((step, index) => step.done && !prev.plan[index]?.done);
    if (ticked.length > 0) {
      const done = next.plan.filter((step) => step.done).length;
      const names = ticked.map((step) => step.text).join(", ");
      out.push(`Plan step done: ${names}. ${done} of ${next.plan.length} done`);
    }
  } else if (next.plan.length > 0 && prev.plan.length === 0) {
    out.push(`Muse made a plan with ${next.plan.length} ${next.plan.length === 1 ? "step" : "steps"}`);
  }
  if (next.turnId && next.turnId !== prev.turnId) {
    out.push("Muse is working");
  }
  for (const [id, text] of Object.entries(next.approvals)) {
    if (!(id in prev.approvals)) {
      out.push(text);
    }
  }
  for (const [id, text] of Object.entries(next.questions)) {
    if (!(id in prev.questions)) {
      out.push(text);
    }
  }
  return out;
}
