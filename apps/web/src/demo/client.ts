/**
 * An in-memory MuseGuiClient for demo mode (`npm run dev:demo`), so the UI runs without muse or a
 * server. It seeds realistic sample projects, threads, usage and models, and plays back turns as MSP
 * events. Copied from the landing page's demo client (landing/src/demo/client.ts).
 */
import { listedPrice, type EventHandler, type MuseGuiClient, type TurnOptions } from "@musegui/ui";
import { DemoFiles } from "./files.js";
import type {
  ApprovalRequest,
  EnvironmentStatus,
  GoalAction,
  ModelOption,
  OmpImportResult,
  OutputRange,
  PlanUsage,
  ProjectView,
  SessionSummary,
  ShellRun,
  TranscriptLoad,
  UsageBucket,
  UsageReport,
  UsageThread,
  ViewEvent,
} from "@musegui/ui";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const PROJECTS = {
  readme: "/Users/you/code/readme-demo",
  musegui: "/Users/you/code/musegui",
  api: "/Users/you/code/api-server",
};

const MODEL = "muse-spark-1.3-contributor";

let seq = 0;
const uid = (prefix: string) => `${prefix}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Builds one thread's MSP history: turns made of prompts, tool calls and replies. */
class Script {
  events: ViewEvent[] = [];
  at: number;
  cumulativePrompt = 0;
  cumulativeOutput = 0;

  constructor(
    readonly sessionId: string,
    readonly cwd: string,
    start: number,
  ) {
    this.at = start;
    this.push("session/started", {
      session: {
        sessionId,
        status: "idle",
        modelId: MODEL,
        workspaceRoot: cwd,
        approvalMode: { mode: "onRequest", source: "startup", lastCommandId: null },
        turnCount: 0,
      },
    });
  }

  push(method: string, params: Record<string, unknown>, gap = 40) {
    this.at += gap;
    this.events.push({ method, params: { sessionId: this.sessionId, ...params }, at: this.at });
  }

  item(item: Record<string, unknown>, gap = 40) {
    this.push("item/completed", { item: { revision: 1, status: "completed", recordedAt: new Date(this.at).toISOString(), ...item } }, gap);
  }

  turn(
    prompt: string,
    steps: ((turnId: string) => void)[],
    reply: string,
    options: { durationMs: number; promptTokens: number; outputTokens: number; open?: boolean },
  ): string {
    const turnId = uid("turn");
    const startedAt = this.at + 400;
    this.push("turn/started", { turnId, commandId: turnId }, 400);
    this.item({ itemId: uid("item"), kind: "userMessage", text: prompt, turnId });
    for (const step of steps) step(turnId);
    if (options.open) return turnId;
    this.at = Math.max(this.at, startedAt + options.durationMs - 600);
    this.item({ itemId: uid("item"), kind: "agentMessage", text: reply, turnId }, 200);
    this.cumulativePrompt += options.promptTokens;
    this.cumulativeOutput += options.outputTokens;
    this.push("session/tokenUsage", {
      turnId,
      modelId: MODEL,
      durationMs: Math.round(options.durationMs * 0.8),
      promptTokens: options.promptTokens,
      totalTokens: options.promptTokens + options.outputTokens,
      usage: { inputTokens: options.promptTokens, outputTokens: options.outputTokens, cachedTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 12 },
      cumulative: {
        promptTokens: this.cumulativePrompt,
        outputTokens: this.cumulativeOutput,
        totalTokens: this.cumulativePrompt + this.cumulativeOutput,
      },
    });
    this.push("session/contextUsage", { usedTokens: this.cumulativePrompt, windowTokens: 1_000_000, pressure: "normal" });
    this.at = startedAt + options.durationMs;
    this.push("turn/completed", { turnId, terminal: "completed", durationMs: options.durationMs, timeToFirstTokenMs: 1800 }, 0);
    return turnId;
  }

  tool(turnId: string, tool: string, args: Record<string, unknown>, output: string, gap = 2500) {
    this.item({ itemId: uid("tool"), kind: "toolCall", tool, callId: uid("call"), args: JSON.stringify(args), visibleOutput: output, turnId }, gap);
  }
}

type Seeded = {
  summary: SessionSummary;
  events: ViewEvent[];
  approvals: ApprovalRequest[];
};

function summary(sessionId: string, cwd: string, title: string, activityAt: number, turnCount: number, live: SessionSummary["live"] = null): SessionSummary {
  return {
    sessionId,
    cwd,
    title,
    titleSource: "auto",
    turnCount,
    modelId: MODEL,
    origin: "musegui",
    archived: false,
    createdAt: new Date(activityAt - 20 * MIN).toISOString(),
    activityAt: new Date(activityAt).toISOString(),
    settled: false,
    settledAt: null,
    unsettledAt: null,
    pinned: false,
    sandboxDisabled: false,
    accountId: null,
    live,
  };
}

function seed(now: number): Seeded[] {
  const out: Seeded[] = [];

  // The thread from the product screenshots: a README one-liner.
  {
    const id = "readme-oneliner";
    const s = new Script(id, PROJECTS.readme, now - 3 * MIN);
    s.turn(
      "Look at this project, then add a one-line description of what it does to the top of README.md.",
      [
        (t) => s.tool(t, "bash", { command: "ls -la", description: "List the project files" }, "total 24\n-rw-r--r--  1 you  staff   42 README.md\n-rw-r--r--  1 you  staff  118 greeter.py\n-rw-r--r--  1 you  staff  201 test_greeter.py\n", 1800),
        (t) => s.tool(t, "read", { file_path: "README.md" }, "# readme-demo\n"),
        (t) => s.tool(t, "read", { file_path: "greeter.py" }, 'def greet(name: str) -> str:\n    return f"Hello, {name}!"\n\n\nif __name__ == "__main__":\n    print(greet("world"))\n'),
        (t) => s.tool(t, "read", { file_path: "test_greeter.py" }, 'from greeter import greet\n\n\ndef test_greet():\n    assert greet("Ada") == "Hello, Ada!"\n'),
        (t) =>
          s.tool(
            t,
            "edit",
            {
              file_path: "README.md",
              old_string: "# readme-demo\n",
              new_string: "# readme-demo\n\nA tiny Python greeter: `greet(name)` returns `Hello, {name}!`.\n",
            },
            "Edited README.md",
          ),
        (t) => s.tool(t, "bash", { command: "python -m pytest -q", description: "Run the tests" }, "1 passed in 0.02s\n"),
      ],
      "Done. The project is a tiny Python greeter (`greet(name)` in [greeter.py](greeter.py) returns `Hello, {name}!`), so I added that as a one-liner under the title in [README.md](README.md).",
      { durationMs: 29_000, promptTokens: 21_400, outputTokens: 1_180 },
    );
    out.push({ summary: summary(id, PROJECTS.readme, "Look at this project, then add a one-line description of what it does to the top of README.md.", now - 2 * MIN, 1), events: s.events, approvals: [] });
  }

  // A thread waiting on an approval, so the sidebar and the request card show real state.
  {
    const id = "api-paginate";
    const s = new Script(id, PROJECTS.api, now - 9 * MIN);
    let toolItem = "";
    const turnId = s.turn(
      "Paginate GET /v1/projects with a cursor, then run the route tests.",
      [
        (t) => s.tool(t, "read", { file_path: "src/routes/projects.ts" }, "export async function listProjects(req, res) {\n  const rows = await db.project.findMany();\n  res.json(rows);\n}\n", 1500),
        (t) =>
          s.tool(
            t,
            "edit",
            {
              file_path: "src/routes/projects.ts",
              old_string: "  const rows = await db.project.findMany();\n  res.json(rows);",
              new_string:
                "  const take = Math.min(Number(req.query.limit ?? 50), 200);\n  const cursor = req.query.cursor ? { id: String(req.query.cursor) } : undefined;\n  const rows = await db.project.findMany({ take: take + 1, cursor, skip: cursor ? 1 : 0 });\n  const next = rows.length > take ? rows.pop()!.id : null;\n  res.json({ data: rows, next });",
            },
            "Edited src/routes/projects.ts",
          ),
        (t) => {
          toolItem = uid("tool");
          s.push("item/started", {
            item: { itemId: toolItem, kind: "toolCall", tool: "bash", callId: uid("call"), status: "inProgress", revision: 1, turnId: t, args: JSON.stringify({ command: "npm test -- routes/projects", description: "Run the route tests" }) },
          }, 2200);
        },
      ],
      "",
      { durationMs: 0, promptTokens: 0, outputTokens: 0, open: true },
    );
    const approval: ApprovalRequest = {
      approvalId: "approve-tests",
      sessionId: id,
      itemId: toolItem,
      turnId,
      toolName: "bash",
      currentRequirementId: "req-1",
      subject: { kind: "shell", command: "npm test -- routes/projects", workspaceRoot: PROJECTS.api },
      availableChoices: [
        { choiceId: "remember", label: "Allow and remember", decision: "approved", scope: "session", rulePreview: "npm test *" },
        { choiceId: "once", label: "Allow once", decision: "approved", scope: "once" },
        { choiceId: "no", label: "Reject", decision: "denied", scope: "once", acceptsFeedback: true },
      ],
    };
    s.push("approval/requested", approval as unknown as Record<string, unknown>, 300);
    out.push({
      summary: summary(id, PROJECTS.api, "Paginate GET /v1/projects with a cursor", now - 1 * MIN, 1, {
        activeTurnId: turnId,
        turnStartedAt: new Date(now - 9 * MIN).toISOString(),
        pendingApprovals: 1,
        pendingInputs: 0,
        lastTerminal: null,
        lastError: null,
      }),
      events: s.events,
      approvals: [approval],
    });
  }

  // Muse Code's Monitor: a PR's checks watched in the background, and the turn Muse started when one failed.
  {
    const id = "api-ci-watch";
    const s = new Script(id, PROJECTS.api, now - 40 * MIN);
    let monitorItem: Record<string, unknown> = {};
    s.turn(
      "Open the PR, watch the checks, and fix anything that fails.",
      [
        (t) => s.tool(t, "bash", { command: "gh pr create --fill", description: "Open the pull request" }, "https://github.com/you/api-server/pull/42\n", 1800),
        (t) => {
          monitorItem = { itemId: "api-ci-monitor", kind: "toolCall", tool: "monitor", callId: uid("call"), status: "inProgress", turnId: t, args: JSON.stringify({ command: "gh pr checks 42 --watch --fail-fast", description: "Watch PR 42 checks", persistent: true }) };
          s.item(monitorItem, 1200);
        },
      ],
      "PR #42 is open. I'm watching its checks and will jump back in if one fails.",
      { durationMs: 21_000, promptTokens: 18_200, outputTokens: 640 },
    );
    // No prompt: the monitor saw a failing check and Muse woke up on its own.
    const wake = uid("turn");
    s.push("turn/started", { turnId: wake, commandId: wake }, 6 * 60_000);
    s.tool(wake, "bash", { command: "gh run view --log-failed", description: "Read the failing check" }, "lint  src/routes/projects.ts:14:7  'cursor' is assigned a value but never used\n", 1500);
    s.tool(wake, "edit", { file_path: "src/routes/projects.ts", old_string: "  const cursor = req.query.cursor;\n", new_string: "" }, "Edited src/routes/projects.ts");
    s.tool(wake, "bash", { command: "git commit -am \"Drop the unused cursor variable\" && git push", description: "Push the fix" }, "[feat/paginate 3f2c1a9] Drop the unused cursor variable\n", 1600);
    s.item({ itemId: uid("item"), kind: "agentMessage", text: "The `lint` check failed on an unused `cursor` variable in `src/routes/projects.ts`. I removed it and pushed; still watching the rest of the checks.", turnId: wake }, 600);
    s.push("turn/completed", { turnId: wake, terminal: "completed", durationMs: 19_000, timeToFirstTokenMs: 1500 }, 0);
    out.push({
      summary: summary(id, PROJECTS.api, "Open the PR and watch the checks", now - 30 * MIN, 2, {
        activeTurnId: null,
        turnStartedAt: null,
        pendingApprovals: 0,
        pendingInputs: 0,
        lastTerminal: "completed",
        lastError: null,
        monitors: 1,
      }),
      events: s.events,
      approvals: [],
    });
  }

  const simple: [string, string, string, number, string, string][] = [
    [
      "musegui-resize",
      PROJECTS.musegui,
      "Fix the flaky sidebar resize test",
      18 * MIN,
      "The sidebar resize test fails about one run in five. Find out why and fix it.",
      "The test read the sidebar width before the resize transition finished. I made it wait for `transitionend` instead of a fixed 100ms timeout in `sidebar.test.ts`, and it passed 50 runs in a row.",
    ],
    [
      "musegui-usage-col",
      PROJECTS.musegui,
      "Add a cache-read column to the usage table",
      62 * MIN,
      "Add a cache-read tokens column to the usage table, right after output tokens.",
      "Added a **Cache read** column after **Output** in `UsagePage.tsx`, using `formatTokens` like its neighbours. Totals include it too.",
    ],
    [
      "musegui-wsl",
      PROJECTS.musegui,
      "Why does WSL path translation drop drive letters?",
      3 * HOUR,
      "Why does WSL path translation drop the drive letter for paths like D:\\work?",
      "`toWslPath` lowercased the path before matching the drive pattern, and the pattern only accepted uppercase letters. I changed the regex to `/^([a-z]):/i`; `D:\\work` now maps to `/mnt/d/work`.",
    ],
    [
      "api-rate-limit",
      PROJECTS.api,
      "Rate limit the login endpoint",
      5 * HOUR,
      "Rate limit POST /v1/login to 10 attempts a minute per IP.",
      "Added a sliding-window limiter on `POST /v1/login`: 10 attempts per IP per minute, answering `429` with a `Retry-After` header. Covered by two new tests.",
    ],
    [
      "readme-tests",
      PROJECTS.readme,
      "Add a test for empty names",
      26 * HOUR,
      "What should greet('') return? Add a test for it.",
      "It returns `Hello, !`, which reads like a bug, so I made `greet('')` return `Hello, there!` and added `test_greet_empty`.",
    ],
  ];

  for (const [id, cwd, title, ago, prompt, reply] of simple) {
    const s = new Script(id, cwd, now - ago - 4 * MIN);
    s.turn(
      prompt,
      [
        (t) => s.tool(t, "grep", { pattern: title.split(" ")[1] ?? "test", path: "src" }, "src/index.ts\n", 1600),
        (t) => s.tool(t, "read", { file_path: "src/index.ts" }, "// ...\n"),
      ],
      reply,
      { durationMs: 38_000 + (ago % 20_000), promptTokens: 34_000 + (ago % 9000), outputTokens: 900 + (ago % 700) },
    );
    out.push({ summary: summary(id, cwd, title, now - ago, 1), events: s.events, approvals: [] });
  }
  return out;
}

function usageReport(now: number, sessions: SessionSummary[], days = 30): UsageReport {
  const window = Math.min(365, Math.max(1, Math.round(days)));
  const buckets: UsageBucket[] = [];
  for (let d = window - 1; d >= 0; d--) {
    const at = now - d * DAY;
    const day = new Date(at).toISOString().slice(0, 10);
    const weekday = new Date(at).getDay();
    const weekend = weekday === 0 || weekday === 6;
    const wave = 0.55 + 0.45 * Math.sin((d / Math.max(1, window - 1)) * Math.PI * 3.2 + 1.1);
    const calls = Math.round((weekend ? 14 : 58) * wave + 6);
    buckets.push({
      day,
      modelId: MODEL,
      calls,
      promptTokens: calls * 21_300,
      outputTokens: calls * 640,
      cachedTokens: calls * 14_900,
      cacheReadTokens: calls * 14_900,
      cacheWriteTokens: calls * 1_200,
      reasoningTokens: calls * 90,
      durationMs: calls * 5200,
    });
    if (!weekend && d % 3 !== 1) {
      const deep = Math.round(calls * 0.35);
      buckets.push({
        day,
        modelId: "muse-spark-1.3",
        calls: deep,
        promptTokens: deep * 30_100,
        outputTokens: deep * 1_450,
        cachedTokens: deep * 19_000,
        cacheReadTokens: deep * 19_000,
        cacheWriteTokens: deep * 2_000,
        reasoningTokens: deep * 420,
        durationMs: deep * 9100,
      });
    }
  }
  const scale = window / 30;
  const threads: UsageThread[] = sessions.map((s, i) => {
    const calls = Math.max(1, Math.round((180 - i * 22) * scale));
    return {
      sessionId: s.sessionId,
      title: s.title,
      cwd: s.cwd,
      calls,
      promptTokens: calls * 24_000,
      outputTokens: calls * 760,
      cachedTokens: calls * 16_000,
      modelIds: [MODEL],
      lastAt: s.activityAt,
    };
  });
  return { since: new Date(now - (window - 1) * DAY).toISOString(), days: window, buckets, threads };
}

const MODELS: ModelOption[] = [
  {
    modelId: MODEL,
    displayLabel: "muse-spark-1.3",
    description: "Fast everyday model. Contributor tier: prompts may be used for product improvement.",
    isDefault: true,
    isActive: true,
    contextLimit: 1_000_000,
    outputLimit: 64_000,
    cost: listedPrice(MODEL),
    contributor: true,
  },
  {
    modelId: "muse-spark-1.3",
    displayLabel: "muse-spark-1.3",
    description: "The same model without data sharing.",
    isDefault: false,
    isActive: false,
    contextLimit: 1_000_000,
    outputLimit: 64_000,
    cost: listedPrice("muse-spark-1.3"),
    contributor: false,
  },
];

const REPLY =
  "This is the real Muse Code GUI interface running on sample data in your browser, so nothing ran on your machine. " +
  "Install Muse Code GUI and this thread would stream from `muse serve` in your own project, with every tool call, diff and approval shown right here.";

export class DemoClient implements MuseGuiClient {
  private handlers = new Set<EventHandler>();
  private sessions = new Map<string, Seeded>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly now = Date.now();
  private readonly files = new DemoFiles(this.now);

  constructor() {
    for (const entry of seed(this.now)) this.sessions.set(entry.summary.sessionId, entry);
  }

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private emit(sessionId: string, method: string, params: Record<string, unknown>) {
    const entry = this.sessions.get(sessionId);
    const event: ViewEvent = { method, params: { sessionId, ...params }, at: Date.now() };
    entry?.events.push(event);
    for (const h of this.handlers) h({ type: "msp", sessionId, method, params: event.params, at: event.at! });
  }

  private setLive(sessionId: string, live: SessionSummary["live"]) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.summary = { ...entry.summary, live, activityAt: new Date().toISOString() };
    for (const h of this.handlers) h({ type: "session-status", sessionId, live });
  }

  async probeEnvironment(): Promise<EnvironmentStatus> {
    return { platform: "darwin", wslAvailable: false, defaultDistro: null, museFound: true, musePath: "/usr/local/bin/muse", version: "1.1.1", persistent: true };
  }

  async listProjects(): Promise<ProjectView[]> {
    const latest = (cwd: string) =>
      [...this.sessions.values()].filter((s) => s.summary.cwd === cwd).map((s) => s.summary.activityAt).sort().pop() ?? new Date(this.now).toISOString();
    return [
      { cwd: PROJECTS.readme, displayName: "readme-demo", pinned: false, activityAt: latest(PROJECTS.readme), defaultAccountId: null },
      { cwd: PROJECTS.api, displayName: "api-server", pinned: false, activityAt: latest(PROJECTS.api), defaultAccountId: null },
      { cwd: PROJECTS.musegui, displayName: "musegui", pinned: false, activityAt: latest(PROJECTS.musegui), defaultAccountId: null },
    ];
  }

  async addProject(cwd: string) {
    return { cwd, warning: "Adding projects is disabled in this demo." };
  }
  async cloneProject(_url: string, path: string) {
    return { cwd: path, warning: "Cloning is disabled in this demo." };
  }
  async listDirectory(path: string) {
    return { directory: path, parent: null, separator: "/" as const, exists: true, entries: [] };
  }
  async revealPath() {}
  async hideProject() {}
  async setPinned() {}
  async setProjectOrder() {}

  async listAccounts() {
    return [];
  }
  async createAccount(id: string, options?: { name?: string; seedFromDefault?: boolean }) {
    return { id, name: options?.name ?? id };
  }
  async renameAccount() {}
  async removeAccount() {}
  async setProjectDefaultAccount() {}
  async accountsHealth() {
    return { metaApiKeyInherited: false };
  }
  async loginAccount() {
    return { fallback: "In-app login is not available in the demo." };
  }

  async usage(days?: number): Promise<UsageReport> {
    return usageReport(this.now, [...this.sessions.values()].map((s) => s.summary), days ?? 30);
  }

  async importOmpUsage(): Promise<OmpImportResult> {
    return { files: 0, sessions: 0, calls: 0, skipped: 0 };
  }

  async listSessions(options?: { archived?: boolean }) {
    return [...this.sessions.values()].map((s) => s.summary).filter((s) => s.archived === (options?.archived ?? false));
  }
  async discover() {}

  async startSession(cwd: string, _options?: { approvalMode?: string; modelId?: string; accountId?: string | null }): Promise<SessionSummary> {
    const id = uid("demo");
    const s = new Script(id, cwd, Date.now() - 1000);
    const entry: Seeded = { summary: summary(id, cwd, "New thread", Date.now(), 0), events: s.events, approvals: [] };
    entry.summary.titleSource = "placeholder";
    this.sessions.set(id, entry);
    for (const h of this.handlers) h({ type: "sessions-changed" });
    return entry.summary;
  }

  async loadTranscript(sessionId: string): Promise<TranscriptLoad> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error("Thread not found");
    const live = entry.summary.live;
    return {
      session: entry.summary,
      msp: {
        status: live?.activeTurnId ? "running" : "idle",
        activeTurnId: live?.activeTurnId ?? null,
        modelId: MODEL,
        approvalMode: "onRequest",
        workspaceRoot: entry.summary.cwd,
        turnCount: entry.summary.turnCount,
      },
      events: [...entry.events],
      truncated: false,
      pending: { approvals: [...entry.approvals], userInputs: [] },
      readOnly: false,
      readOnlyReason: null,
    };
  }

  assetUrl(path: string) {
    return path;
  }

  async updateSession(sessionId: string, patch: { title?: string; archived?: boolean; settled?: boolean; pinned?: boolean }) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    entry.summary = { ...entry.summary, ...patch, ...(patch.title ? { titleSource: "user" as const } : {}) };
    return entry.summary;
  }

  async sendTurn(sessionId: string, text: string, options?: TurnOptions) {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error("Thread not found");
    const turnId = uid("turn");
    const started = Date.now();
    if (entry.summary.titleSource === "placeholder") {
      entry.summary = { ...entry.summary, title: (options?.displayText ?? text).slice(0, 80), titleSource: "auto" };
    }
    entry.summary = { ...entry.summary, turnCount: entry.summary.turnCount + 1 };
    this.setLive(sessionId, { activeTurnId: turnId, turnStartedAt: new Date().toISOString(), pendingApprovals: 0, pendingInputs: 0, lastTerminal: null, lastError: null });
    this.later(() => {
      this.emit(sessionId, "turn/started", { turnId, commandId: turnId });
      this.emit(sessionId, "item/completed", { item: { itemId: uid("item"), kind: "userMessage", status: "completed", revision: 1, text: options?.displayText ?? text, turnId } });
    }, 250);
    const toolId = uid("tool");
    const args = JSON.stringify({ command: "git status --short", description: "Check the working tree" });
    this.later(() => this.emit(sessionId, "item/started", { item: { itemId: toolId, kind: "toolCall", tool: "bash", status: "inProgress", revision: 1, turnId, args } }), 900);
    this.later(
      () => this.emit(sessionId, "item/completed", { item: { itemId: toolId, kind: "toolCall", tool: "bash", status: "completed", revision: 2, turnId, args, visibleOutput: "" } }),
      1900,
    );
    const replyId = uid("item");
    this.later(() => this.emit(sessionId, "item/started", { item: { itemId: replyId, kind: "agentMessage", status: "inProgress", revision: 1, text: "", turnId } }), 2400);
    const words = REPLY.split(/(?<= )/);
    let at = 2500;
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3).join("");
      this.later(() => this.emit(sessionId, "item/delta", { itemId: replyId, field: "text", delta: chunk }), at);
      at += 70;
    }
    this.later(() => {
      this.emit(sessionId, "item/completed", { item: { itemId: replyId, kind: "agentMessage", status: "completed", revision: 2, text: REPLY, turnId } });
      this.emit(sessionId, "session/tokenUsage", {
        turnId,
        modelId: MODEL,
        durationMs: Date.now() - started,
        promptTokens: 18_200,
        totalTokens: 18_430,
        usage: { inputTokens: 18_200, outputTokens: 230, cachedTokens: 12_000, cacheReadTokens: 12_000, cacheWriteTokens: 0, reasoningTokens: 20 },
        cumulative: { promptTokens: 18_200, outputTokens: 230, totalTokens: 18_430 },
      });
      this.emit(sessionId, "turn/completed", { turnId, terminal: "completed", durationMs: Date.now() - started, timeToFirstTokenMs: 2400 });
      this.setLive(sessionId, { activeTurnId: null, turnStartedAt: null, pendingApprovals: 0, pendingInputs: 0, lastTerminal: "completed", lastError: null });
    }, at + 200);
    return { turnId, disposition: "started" };
  }

  async interruptTurn(sessionId: string, turnId?: string) {
    this.dispose();
    if (turnId) this.emit(sessionId, "turn/completed", { turnId, terminal: "interrupted", durationMs: 0 });
    this.setLive(sessionId, { activeTurnId: null, turnStartedAt: null, pendingApprovals: 0, pendingInputs: 0, lastTerminal: "interrupted", lastError: null });
  }
  async unqueueTurn() {}

  async decideApproval(input: { sessionId: string; approvalId: string; choiceId: string }) {
    const entry = this.sessions.get(input.sessionId);
    const request = entry?.approvals.find((a) => a.approvalId === input.approvalId);
    if (!entry || !request) return;
    entry.approvals = entry.approvals.filter((a) => a !== request);
    const approved = input.choiceId !== "no";
    this.emit(input.sessionId, "approval/resolved", { approvalId: input.approvalId, decision: approved ? "approved" : "denied", resolvedBy: "user" });
    const turnId = request.turnId!;
    const args = JSON.stringify({ command: "npm test -- routes/projects", description: "Run the route tests" });
    this.setLive(input.sessionId, { activeTurnId: turnId, turnStartedAt: new Date().toISOString(), pendingApprovals: 0, pendingInputs: 0, lastTerminal: null, lastError: null });
    this.later(() => {
      this.emit(input.sessionId, "item/completed", {
        item: {
          itemId: request.itemId,
          kind: "toolCall",
          tool: "bash",
          status: approved ? "completed" : "failed",
          revision: 2,
          turnId,
          args,
          visibleOutput: approved ? " PASS  routes/projects.test.ts\n  ✓ returns the first page (12 ms)\n  ✓ follows the cursor (9 ms)\n\nTests: 2 passed, 2 total\n" : "",
        },
      });
    }, 1400);
    const text = approved
      ? "`GET /v1/projects` now takes `limit` (default 50, max 200) and `cursor`, and answers `{ data, next }`. Both route tests pass."
      : "Understood, I did not run the tests. The pagination change is in `src/routes/projects.ts` whenever you want to check it.";
    this.later(() => {
      this.emit(input.sessionId, "item/completed", { item: { itemId: uid("item"), kind: "agentMessage", status: "completed", revision: 1, text, turnId } });
      this.emit(input.sessionId, "turn/completed", { turnId, terminal: "completed", durationMs: 9 * MIN + 12_000 });
      this.setLive(input.sessionId, { activeTurnId: null, turnStartedAt: null, pendingApprovals: 0, pendingInputs: 0, lastTerminal: "completed", lastError: null });
    }, 2600);
  }

  async answerUserInput() {}
  async cancelUserInput() {}
  async clarifyUserInput() {}

  async listModels() {
    return MODELS;
  }
  async setSessionModel() {}
  async setApprovalMode() {}

  async compact() {
    return { noop: true, reason: "no_compactable_history" };
  }

  async runShell() {}

  async runShellProxy(sessionId: string, command: string): Promise<ShellRun> {
    return { id: uid("run"), sessionId, command, exitCode: 0, output: `demo: ${command} was not run (sample data)\n`, truncated: false, durationMs: 4, at: new Date().toISOString() };
  }

  async forkSession(sessionId: string): Promise<SessionSummary> {
    const entry = this.sessions.get(sessionId);
    const id = uid("fork");
    const copy: Seeded = {
      summary: { ...(entry?.summary ?? summary(id, PROJECTS.readme, "Fork", Date.now(), 0)), sessionId: id, title: `${entry?.summary.title ?? "Thread"} (fork)`, live: null },
      events: [...(entry?.events ?? [])],
      approvals: [],
    };
    this.sessions.set(id, copy);
    for (const h of this.handlers) h({ type: "sessions-changed" });
    return copy.summary;
  }

  async sideChat(sessionId: string): Promise<SessionSummary> {
    const entry = this.sessions.get(sessionId);
    const id = uid("side");
    const side: Seeded = {
      summary: { ...(entry?.summary ?? summary(id, PROJECTS.readme, "Side chat", Date.now(), 0)), sessionId: id, title: `${(entry?.summary.title ?? "Thread").replace(/ \(side chat\)$/, "")} (side chat)`, turnCount: 0, sideOf: sessionId, pinned: false, live: null },
      events: [],
      approvals: [],
    };
    this.sessions.set(id, side);
    for (const h of this.handlers) h({ type: "sessions-changed" });
    return side.summary;
  }

  async listSkills() {
    return {
      skills: [
        { id: "review", name: "review", displayName: "Review", description: "Review the current diff for bugs.", shortDescription: "Review the current diff", scope: "user", activation: "on" },
        { id: "release", name: "release", displayName: "Release", description: "Cut a release: bump, tag and changelog.", shortDescription: "Cut a release", scope: "project", activation: "user-invocable-only" },
      ],
      error: null,
    };
  }
  async skillBody(_cwd: string, skillId: string) {
    return `Instructions for ${skillId}.`;
  }
  async openFolder() {}

  /** The demo makes no model calls, so the switch just remembers what the visitor picked. */
  private titleSettings = { enabled: true, modelId: null as string | null };
  private sandboxSettings = { disabled: false };
  private yoloSettings = { enabled: false };
  private feedSettings = { catchUp: false };
  async getSandboxSettings() {
    return this.sandboxSettings;
  }
  async setSandboxSettings(patch: { disabled?: boolean }) {
    this.sandboxSettings = { ...this.sandboxSettings, ...patch };
    return this.sandboxSettings;
  }

  async getYoloSettings() {
    return this.yoloSettings;
  }
  async setYoloSettings(patch: { enabled?: boolean }) {
    this.yoloSettings = { ...this.yoloSettings, ...patch };
    return this.yoloSettings;
  }

  async getFeedSettings() {
    return this.feedSettings;
  }
  async setFeedSettings(patch: { catchUp?: boolean }) {
    this.feedSettings = { ...this.feedSettings, ...patch };
    return this.feedSettings;
  }

  async getTitleSettings() {
    return this.titleSettings;
  }
  async setTitleSettings(patch: { enabled?: boolean; modelId?: string | null }) {
    this.titleSettings = { ...this.titleSettings, ...patch };
    return this.titleSettings;
  }

  async listFiles(cwd: string, path: string) {
    return this.files.list(cwd, path);
  }
  async readFile(cwd: string, path: string) {
    return this.files.read(cwd, path);
  }
  async writeFile(cwd: string, path: string, content: string) {
    return this.files.write(cwd, path, content);
  }
  async revertChanges(): Promise<{ path: string; outcome: "reverted" | "deleted" }> {
    throw new Error("Undoing changes is disabled in this demo.");
  }
  async searchFiles(cwd: string, query: string) {
    return this.files.search(cwd, query);
  }
  async openFileExternally() {
    throw new Error("Opening files in other apps is disabled in this demo.");
  }
  fileUrl(cwd: string, path: string) {
    return this.files.url(cwd, path);
  }

  async setReasoningEffort() {}

  /** Goals play back as Muse reports them, so the goal panel shows and reacts in the demo. */
  async goal(sessionId: string, action: GoalAction, objective?: string) {
    const entry = this.sessions.get(sessionId);
    const current = [...(entry?.events ?? [])].reverse().find((e) => e.method === "session/goalChanged")?.params["goal"] as
      | { objective: string; status: string; percentComplete: number }
      | null
      | undefined;
    if (action === "clear") {
      this.emit(sessionId, "session/goalChanged", { goal: null });
      return { turnId: null };
    }
    const text = objective ?? current?.objective;
    if (!text) throw new Error("There is no goal in this thread yet.");
    const status = action === "pause" ? "paused" : "active";
    this.emit(sessionId, "session/goalChanged", {
      goal: { objective: text, status, percentComplete: action === "set" ? 0 : (current?.percentComplete ?? 0) },
    });
    return { turnId: null };
  }

  async subagent() {}
  /** Stopping the demo monitor cancels its tool call, the way Muse does. */
  async task(sessionId: string, action: string, taskId?: string) {
    const events = this.sessions.get(sessionId)?.events ?? [];
    const found = [...events].reverse().find((e) => (e.params as { item?: { itemId?: string } }).item?.itemId === taskId);
    const item = (found?.params as { item?: Record<string, unknown> } | undefined)?.item;
    if (action === "stop" && item?.["tool"] === "monitor") {
      this.emit(sessionId, "item/completed", { item: { ...item, status: "cancelled", revision: Number(item["revision"] ?? 1) + 1 } });
    }
  }
  async workflow() {}

  async readOutput(): Promise<OutputRange> {
    return { content: "", encoding: "utf8", mediaType: "text/plain", offsetBytes: 0, byteLen: 0, eof: true };
  }

  /** A plausible mid-afternoon plan meter, so the usage page and sidebar show what the real one looks like. */
  async planUsage(): Promise<{ usage: PlanUsage | null; byAccount: Record<string, PlanUsage> }> {
    return {
      usage: {
        tier: "high",
        observedAtMs: this.now - 4 * MIN,
        window: { usedPercent: 38, resetsAtMs: this.now + 2 * HOUR + 17 * MIN, windowDurationMins: 300 },
        weekly: { usedPercent: 21, resetsAtMs: this.now + 3 * DAY + 5 * HOUR, windowDurationMins: null },
      },
      byAccount: {},
    };
  }

  subscribe(handler: EventHandler) {
    this.handlers.add(handler);
    handler({ type: "hello", version: "demo" });
    return () => {
      this.handlers.delete(handler);
    };
  }
}
