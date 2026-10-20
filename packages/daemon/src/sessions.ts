export type ApprovalMode = "allowAll" | "denyUnmatched" | "onRequest" | "promptUnmatched";

export const APPROVAL_MODES: readonly ApprovalMode[] = [
  "allowAll",
  "denyUnmatched",
  "onRequest",
  "promptUnmatched",
];

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return (
    typeof value === "string" &&
    (APPROVAL_MODES as readonly string[]).includes(value)
  );
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export type IfBusy = "queue" | "steer" | "replace";

export function isIfBusy(value: unknown): value is IfBusy {
  return value === "queue" || value === "steer" || value === "replace";
}

export interface TextPart {
  type: "text";
  text: string;
}

export function textInput(text: string): TextPart[] {
  return [{ type: "text", text }];
}

export interface MspNotification {
  method: string;
  params?: unknown;
  emittedAtMs?: number;
}

export type NotificationHandler = (notification: MspNotification) => void;

/** A frame the SDK could not deliver: malformed, oversized, or otherwise refused before parsing. */
export type ProtocolErrorHandler = (error: unknown) => void;

/**
 * The slice of the SDK connection Muse Code GUI uses. `command` mints a `commandId` for
 * state-changing verbs; `request` sends read-only queries (lists, reads, pages) as-is.
 */
export interface CommandConnection {
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
  request?(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onNotification(handler: NotificationHandler): void;
  /** Optional: older connections and the test doubles do not have it. */
  onProtocolError?(handler: ProtocolErrorHandler): void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return null;
}

function nestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) {
      return null;
    }
    current = record[key];
  }
  return typeof current === "string" ? current : null;
}

function sessionIdOf(result: unknown): string {
  const id = nestedString(result, ["session", "sessionId"]);
  if (!id) {
    throw new Error("MSP reply carried no session.sessionId.");
  }
  return id;
}

export interface StartSessionOptions {
  workspaceRoot?: string;
  approvalMode?: ApprovalMode;
  modelId?: string;
}

export interface StartedSession {
  sessionId: string;
  raw: unknown;
}

export interface TurnAck {
  turnId: string | null;
  status: unknown;
  disposition: unknown;
  raw: unknown;
}

function toTurnAck(raw: unknown): TurnAck {
  const record = asRecord(raw);
  return {
    turnId: record ? nestedString(record, ["turnId"]) : null,
    status: record ? record["status"] : undefined,
    disposition: record ? record["disposition"] : undefined,
    raw,
  };
}

/** An image the user attached to a prompt: the only non-text part MSP v1 takes (tdd SS3.2). */
export interface TurnImage {
  base64Data: string;
  mediaType: string;
  width?: number;
  height?: number;
}

export interface SendTurnOptions {
  displayText?: string;
  ifBusy?: string;
  reasoningEffort?: string;
  images?: TurnImage[];
}

/** Prompt parts in order: the text the user typed, then each image they attached. */
export function turnInput(text: string, images: TurnImage[] = []): unknown[] {
  const parts: unknown[] = text.length > 0 ? textInput(text) : [];
  for (const image of images) {
    parts.push({
      type: "image",
      base64Data: image.base64Data,
      mediaType: image.mediaType,
      // Muse takes the pair or neither.
      ...(image.width !== undefined && image.height !== undefined ? { width: image.width, height: image.height } : {}),
    });
  }
  return parts;
}

export interface ApprovalDecision {
  sessionId: string;
  approvalId: string;
  requirementId: unknown;
  choiceId: string;
  feedback?: string | null;
}

export interface UserInputAnswerItem {
  questionId: string;
  selectedLabel?: string;
  selectedLabels?: string[];
  freeText?: string;
  note?: string;
}

export interface SessionPage {
  sessions: unknown[];
  nextCursor: string | null;
}

export interface ViewPage {
  events: unknown[];
  nextCursor: string | null;
}

export interface PendingRequests {
  approvals: unknown[];
  userInputs: unknown[];
}

export class SessionManager {
  constructor(private readonly connection: CommandConnection) {}

  onNotification(handler: NotificationHandler): void {
    this.connection.onNotification(handler);
  }

  /**
   * Frames the SDK dropped before they could become notifications. Without this a drop is silent,
   * which is exactly the gap that made #42 impossible to tell apart from a backend that went quiet.
   * Returns false when the connection cannot report them.
   */
  onProtocolError(handler: ProtocolErrorHandler): boolean {
    if (!this.connection.onProtocolError) {
      return false;
    }
    this.connection.onProtocolError(handler);
    return true;
  }

  /** Read-only queries go out without a minted `commandId` when the connection allows it. */
  private query(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.connection.request) {
      return this.connection.request(method, params);
    }
    return this.connection.command(method, params);
  }

  async listSessions(workspaceRoot?: string, limit = 50): Promise<unknown[]> {
    const page = await this.listSessionsPage({ workspaceRoot, limit });
    return page.sessions;
  }

  async listSessionsPage(options: {
    workspaceRoot?: string;
    limit?: number;
    cursor?: string | null;
  } = {}): Promise<SessionPage> {
    const params: Record<string, unknown> = { limit: options.limit ?? 50 };
    if (options.workspaceRoot !== undefined) {
      params["workspaceRoot"] = options.workspaceRoot;
    }
    if (options.cursor) {
      params["cursor"] = options.cursor;
    }
    const result = await this.query("session/list", params);
    const record = asRecord(result);
    if (record && Array.isArray(record["sessions"])) {
      return {
        sessions: record["sessions"],
        nextCursor: typeof record["nextCursor"] === "string" ? record["nextCursor"] : null,
      };
    }
    if (Array.isArray(result)) {
      return { sessions: result, nextCursor: null };
    }
    return { sessions: [], nextCursor: null };
  }

  async startSession(options: StartSessionOptions = {}): Promise<StartedSession> {
    const params: Record<string, unknown> = {};
    if (options.workspaceRoot !== undefined) {
      params["workspaceRoot"] = options.workspaceRoot;
    }
    if (options.approvalMode !== undefined) {
      params["approvalMode"] = options.approvalMode;
    }
    const result = await this.connection.command("session/start", params);
    const sessionId = sessionIdOf(result);
    // Muse 1.4.6 records a `modelId` passed to session/start but still runs the session on its own default, and a
    // later session/setModel to that same id is then a no-op. So the model is only ever set with session/setModel.
    if (options.modelId !== undefined) {
      await this.connection.command("session/setModel", { sessionId, model: { modelId: options.modelId } });
    }
    return { sessionId, raw: result };
  }

  async resumeSession(sessionId: string, excludeItems = false): Promise<unknown> {
    return this.connection.command("session/resume", { sessionId, excludeItems });
  }

  async readSession(sessionId: string, excludeItems = true): Promise<unknown> {
    return this.query("session/read", { sessionId, excludeItems });
  }

  /** One page of the durable view log. Backward pages walk from the head toward the start. */
  async pageView(
    sessionId: string,
    options: { cursor?: string; direction?: "forward" | "backward"; limit?: number } = {},
  ): Promise<ViewPage> {
    const params: Record<string, unknown> = { sessionId, limit: options.limit ?? 200 };
    if (options.cursor) {
      params["cursor"] = options.cursor;
    }
    if (options.direction) {
      params["direction"] = options.direction;
    }
    const record = asRecord(await this.query("view/page", params)) ?? {};
    return {
      events: Array.isArray(record["events"]) ? record["events"] : [],
      nextCursor: typeof record["nextCursor"] === "string" ? record["nextCursor"] : null,
    };
  }

  async listPending(sessionId: string): Promise<PendingRequests> {
    const record = asRecord(await this.query("approval/listPending", { sessionId })) ?? {};
    return {
      approvals: Array.isArray(record["approvals"]) ? record["approvals"] : [],
      userInputs: Array.isArray(record["userInputs"]) ? record["userInputs"] : [],
    };
  }

  async sendTurn(
    sessionId: string,
    text: string,
    options: SendTurnOptions = {},
  ): Promise<TurnAck> {
    const params: Record<string, unknown> = {
      sessionId,
      input: turnInput(text, options.images ?? []),
    };
    if (options.displayText !== undefined) {
      params["displayText"] = options.displayText;
    }
    if (options.ifBusy !== undefined) {
      params["ifBusy"] = options.ifBusy;
    }
    if (options.reasoningEffort !== undefined) {
      params["reasoningEffort"] = options.reasoningEffort;
    }
    return toTurnAck(await this.connection.command("turn/start", params));
  }

  async steerTurn(
    sessionId: string,
    expectedTurnId: string,
    text: string,
  ): Promise<unknown> {
    return this.connection.command("turn/steer", {
      sessionId,
      expectedTurnId,
      input: textInput(text),
    });
  }

  async interruptTurn(
    sessionId: string,
    turnId?: string,
    retract = false,
  ): Promise<unknown> {
    const params: Record<string, unknown> = { sessionId, retract };
    if (turnId !== undefined) {
      params["turnId"] = turnId;
    }
    return this.connection.command("turn/interrupt", params);
  }

  async cancelTurn(sessionId: string, turnId: string): Promise<unknown> {
    return this.connection.command("turn/cancel", { sessionId, turnId });
  }

  async unqueueTurn(sessionId: string, turnId: string): Promise<unknown> {
    return this.connection.command("turn/unqueue", { sessionId, turnId });
  }

  async compactSession(sessionId: string): Promise<unknown> {
    return this.connection.command("session/compact", { sessionId });
  }

  /** Runs a shell command the user typed (the terminal UI's `!`) in the session's workspace. Needs the `userShell` capability. */
  async userShell(sessionId: string, commandText: string): Promise<unknown> {
    return this.connection.command("session/userShell", { sessionId, commandText });
  }

  /** Branches a session into a new one that carries every completed turn. */
  async forkSession(sessionId: string): Promise<StartedSession> {
    const result = await this.connection.command("session/fork", { sessionId, excludeItems: true });
    return { sessionId: sessionIdOf(result), raw: result };
  }

  /**
   * Opens a side chat beside a session: a new, empty session that Muse links back to it through
   * `sideFrom`. Nothing flows back into the main session; it only gains a `sideChat` item.
   */
  async sideChat(sessionId: string): Promise<StartedSession> {
    const result = await this.connection.command("session/sideChat", { sessionId });
    return { sessionId: sessionIdOf(result), raw: result };
  }

  async decideApproval(decision: ApprovalDecision): Promise<unknown> {
    return this.connection.command("approval/decide", {
      sessionId: decision.sessionId,
      approvalId: decision.approvalId,
      requirementId: decision.requirementId,
      choiceId: decision.choiceId,
      feedback: decision.feedback ?? null,
    });
  }

  async listModels(sessionId?: string): Promise<unknown> {
    const params: Record<string, unknown> = {};
    if (sessionId !== undefined) {
      params["sessionId"] = sessionId;
    }
    return this.query("model/list", params);
  }

  async setSessionModel(sessionId: string, model: unknown): Promise<unknown> {
    return this.connection.command("session/setModel", { sessionId, model });
  }

  async setSessionApprovalMode(
    sessionId: string,
    mode: ApprovalMode,
  ): Promise<unknown> {
    return this.connection.command("session/setApprovalMode", { sessionId, mode });
  }

  async answerUserInput(
    sessionId: string,
    userInputId: string,
    answers: UserInputAnswerItem[],
  ): Promise<unknown> {
    return this.connection.command("userInput/answer", {
      sessionId,
      userInputId,
      answers,
    });
  }

  async cancelUserInput(sessionId: string, userInputId: string, reason?: string): Promise<unknown> {
    const params: Record<string, unknown> = { sessionId, userInputId };
    if (reason) {
      params["reason"] = reason;
    }
    return this.connection.command("userInput/cancel", params);
  }

  async clarifyUserInput(sessionId: string, userInputId: string, content: string): Promise<unknown> {
    return this.connection.command("userInput/clarify", {
      sessionId,
      userInputId,
      clarification: { format: "text", content },
    });
  }

  /**
   * The session's standing reasoning effort. On Muse 1.3.0 this is the only knob `muse serve` honours: an effort
   * sent with `turn/start` is accepted and then dropped before the provider call (muse-code-sdk#6).
   */
  async setReasoningEffort(sessionId: string, reasoningEffort: ReasoningEffort): Promise<unknown> {
    return this.connection.command("session/setReasoningEffort", { sessionId, reasoningEffort });
  }

  /** Muse's own name for the session, the one `/name` sets and other sessions address it by. */
  async renameSession(sessionId: string, name: string): Promise<string | null> {
    const result = await this.connection.command("session/rename", { sessionId, name });
    return nestedString(result, ["name"]);
  }

  /** The host's last-observed subscription window; null when it has not seen one yet, which is not an error. */
  async readSubscriptionUsage(): Promise<SubscriptionUsage | null> {
    return parseSubscriptionUsage(asRecord(await this.query("usage/read", {}))?.["usage"]);
  }

  /** Every goal verb answers the same admission ack; `set` and `edit` carry the objective, the rest must not. */
  async goal(sessionId: string, action: GoalAction, objective?: string): Promise<GoalAck> {
    const params: Record<string, unknown> = { sessionId };
    if (action === "set" || action === "edit") {
      const text = objective?.trim();
      if (!text) {
        throw new Error(`goal/${action} needs an objective.`);
      }
      params["objective"] = text;
    }
    const result = asRecord(await this.connection.command(`goal/${action}`, params));
    return { turnId: typeof result?.["turnId"] === "string" ? result["turnId"] : null };
  }

  /** A control on a `subagent` item, addressed by its `subagentId`. `body` is the note or follow-up task text. */
  async subagent(
    sessionId: string,
    action: SubagentAction,
    subagentId: string,
    options: { reason?: string; body?: string } = {},
  ): Promise<unknown> {
    const params: Record<string, unknown> = { sessionId, subagentId };
    if (action === "sendMessage" || action === "followupTask") {
      const body = options.body?.trim();
      if (!body) {
        throw new Error(`subagent/${action} needs a message.`);
      }
      params["body"] = body;
    } else if ((action === "stop" || action === "interrupt" || action === "close") && options.reason) {
      params["reason"] = options.reason;
    }
    return this.connection.command(`subagent/${action}`, params);
  }

  /** A running foreground tool call moved to the background. Its task id is the `toolCall` item's `itemId`. */
  async backgroundTask(sessionId: string, taskId: string): Promise<unknown> {
    return this.connection.command("task/background", { sessionId, taskId });
  }

  async stopTask(sessionId: string, taskId: string): Promise<unknown> {
    return this.connection.command("task/stop", { sessionId, taskId });
  }

  /** Stops every background task live in the session at admission. */
  async stopAllTasks(sessionId: string): Promise<unknown> {
    return this.connection.command("task/stopAll", { sessionId });
  }

  /** The session's user-invocable skills as the host resolves them; the session must be loaded. */
  async listSessionSkills(sessionId: string): Promise<SessionSkill[]> {
    const result = asRecord(await this.query("skill/list", { sessionId }));
    const rows = Array.isArray(result?.["skills"]) ? result["skills"] : [];
    const skills: SessionSkill[] = [];
    for (const row of rows) {
      const r = asRecord(row);
      const selector = typeof r?.["selector"] === "string" ? r["selector"] : null;
      if (!r || !selector) {
        continue;
      }
      skills.push({
        selector,
        displayName: typeof r["displayName"] === "string" && r["displayName"] ? r["displayName"] : selector,
        description: typeof r["description"] === "string" ? r["description"] : "",
        source: typeof r["source"] === "string" ? r["source"] : "unknown",
        argumentHint: typeof r["argumentHint"] === "string" ? r["argumentHint"] : null,
        pluginId: typeof r["pluginId"] === "string" ? r["pluginId"] : null,
      });
    }
    return skills;
  }

  async cancelWorkflow(sessionId: string, workflowRunId: string): Promise<unknown> {
    return this.connection.command("workflow/cancel", { sessionId, workflowRunId });
  }

  /** Pauses a live run. Muse acks admission only; the run's item then carries `paused: true`. */
  async pauseWorkflow(sessionId: string, workflowRunId: string): Promise<unknown> {
    return this.connection.command("workflow/pause", { sessionId, workflowRunId });
  }

  /** Resumes a paused run (Muse Code 1.4.6). Muse drives the turn itself: a fresh one on an idle thread, a steer on a busy one. */
  async resumeWorkflow(sessionId: string, workflowRunId: string): Promise<unknown> {
    return this.connection.command("workflow/resume", { sessionId, workflowRunId });
  }

  /** Skips or retries one workflow child. `attempt` must be the child's current one, or Muse rejects it as stale. */
  async controlWorkflowChild(
    sessionId: string,
    workflowRunId: string,
    childId: string,
    attempt: number,
    action: WorkflowChildAction,
  ): Promise<unknown> {
    return this.connection.command("workflow/childControl", { sessionId, workflowRunId, childId, attempt, action });
  }

  /** One byte range of a tool's stored output, for output the view truncated. `outputRef` is `outputRef.id`, never its uri. */
  async readItemOutput(
    sessionId: string,
    itemId: string,
    outputRef: string,
    options: { offsetBytes?: number; lengthBytes?: number } = {},
  ): Promise<ItemOutputRange> {
    const params: Record<string, unknown> = { sessionId, itemId, outputRef };
    if (options.offsetBytes !== undefined) {
      params["offsetBytes"] = options.offsetBytes;
    }
    if (options.lengthBytes !== undefined) {
      params["lengthBytes"] = options.lengthBytes;
    }
    const r = asRecord(await this.query("item/readOutput", params)) ?? {};
    return {
      content: typeof r["content"] === "string" ? r["content"] : "",
      encoding: typeof r["encoding"] === "string" ? r["encoding"] : "utf8",
      mediaType: typeof r["mediaType"] === "string" ? r["mediaType"] : "application/octet-stream",
      offsetBytes: typeof r["offsetBytes"] === "number" ? r["offsetBytes"] : 0,
      byteLen: typeof r["byteLen"] === "number" ? r["byteLen"] : 0,
      eof: r["eof"] === true,
    };
  }
}

export type GoalAction = "set" | "edit" | "pause" | "resume" | "clear";

export const GOAL_ACTIONS: readonly GoalAction[] = ["set", "edit", "pause", "resume", "clear"];

export function isGoalAction(value: unknown): value is GoalAction {
  return typeof value === "string" && (GOAL_ACTIONS as readonly string[]).includes(value);
}

export interface GoalAck {
  /** Present when the verb woke a goal-driving turn. */
  turnId: string | null;
}

export type SubagentAction = "interrupt" | "stop" | "close" | "resume" | "reopen" | "sendMessage" | "followupTask" | "readResult";

export const SUBAGENT_ACTIONS: readonly SubagentAction[] = [
  "interrupt",
  "stop",
  "close",
  "resume",
  "reopen",
  "sendMessage",
  "followupTask",
  "readResult",
];

export function isSubagentAction(value: unknown): value is SubagentAction {
  return typeof value === "string" && (SUBAGENT_ACTIONS as readonly string[]).includes(value);
}

export type WorkflowChildAction = "skip" | "retry";

export function isWorkflowChildAction(value: unknown): value is WorkflowChildAction {
  return value === "skip" || value === "retry";
}

export interface SessionSkill {
  selector: string;
  displayName: string;
  description: string;
  source: string;
  argumentHint: string | null;
  pluginId: string | null;
}

export interface ItemOutputRange {
  content: string;
  encoding: string;
  mediaType: string;
  offsetBytes: number;
  byteLen: number;
  eof: boolean;
}

/** A usage window as a percentage, with when it resets. */
export interface UsageWindow {
  usedPercent: number;
  resetsAtMs: number;
  /** Present for the short window (five hours on today's plans); the weekly block has no duration. */
  windowDurationMins: number | null;
}

/** The subscription meter Muse last saw: the short rolling window, the weekly cap, and the plan tier. */
export interface SubscriptionUsage {
  tier: string;
  observedAtMs: number;
  window: UsageWindow;
  weekly: UsageWindow;
}

function usageWindow(value: unknown): UsageWindow | null {
  const r = asRecord(value);
  if (!r || typeof r["usedPercent"] !== "number" || typeof r["resetsAtMs"] !== "number") {
    return null;
  }
  return {
    usedPercent: r["usedPercent"],
    resetsAtMs: r["resetsAtMs"],
    windowDurationMins: typeof r["windowDurationMins"] === "number" ? r["windowDurationMins"] : null,
  };
}

/** A `SubscriptionUsage` from `usage/read` or `usage/changed`; null for anything incomplete. */
export function parseSubscriptionUsage(value: unknown): SubscriptionUsage | null {
  const r = asRecord(value);
  if (!r) {
    return null;
  }
  const window = usageWindow(r["window"]);
  const weekly = usageWindow(r["weekly"]);
  if (!window || !weekly || typeof r["observedAtMs"] !== "number") {
    return null;
  }
  return { tier: typeof r["tier"] === "string" ? r["tier"] : "unknown", observedAtMs: r["observedAtMs"], window, weekly };
}
