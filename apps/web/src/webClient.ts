import {
  MuseGuiError,
  parseAccounts,
  parseFeedSettings,
  parseModelList,
  parseSandboxSettings,
  parseTitleSettings,
  parseYoloSettings,
  type AccountView,
  type ApprovalDecisionInput,
  type ApprovalMode,
  type AttachmentView,
  type DirectoryListing,
  type EnvironmentStatus,
  type EventHandler,
  type FeedSettings,
  type FileContent,
  type FileEntry,
  type FileListing,
  type GoalAction,
  type MuseGuiClient,
  type MuseGuiEvent,
  type ModelOption,
  type OmpImportResult,
  type OutputRange,
  type PlanUsage,
  type PlanUsageByAccount,
  type ProjectView,
  type ReasoningEffort,
  type SandboxSettings,
  type SessionSummary,
  type ShellRun,
  type SkillCatalog,
  type SubagentAction,
  type TaskAction,
  type TitleSettings,
  type TranscriptLoad,
  type TurnOptions,
  type UsageReport,
  type UserInputAnswer,
  type WorkflowAction,
  type YoloSettings,
} from "@musegui/ui";

/** Which daemon this page talks to. An empty base is the origin that served the page. */
export interface Daemon {
  base: string;
  token: string | null;
}

const DAEMON_KEY = "musegui:daemon";

function stored(): Daemon | null {
  try {
    const raw = window.localStorage.getItem(DAEMON_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<Daemon>;
    return { base: typeof parsed.base === "string" ? parsed.base : "", token: typeof parsed.token === "string" ? parsed.token : null };
  } catch {
    return null;
  }
}

function remember(next: Daemon): void {
  try {
    window.localStorage.setItem(DAEMON_KEY, JSON.stringify(next));
  } catch {
    /* a browser with storage switched off still works for this session */
  }
}

/**
 * The token used to ride in the query string, which put it in history and in every shared link.
 * One is still accepted there, because that is how local links were handed out, but it is taken
 * out of the address bar immediately and kept here instead.
 */
function initial(): Daemon {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("token");
  if (fromUrl) {
    const next: Daemon = { base: "", token: fromUrl };
    remember(next);
    params.delete("token");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    return next;
  }
  return stored() ?? { base: "", token: null };
}

let daemon: Daemon = initial();

export function currentDaemon(): Daemon {
  return daemon;
}

/** Points this page at another daemon; the caller reloads so every open stream starts again. */
export function setDaemon(next: Daemon): void {
  daemon = { base: next.base.replace(/\/$/, ""), token: next.token };
  remember(daemon);
}

function url(path: string): string {
  return daemon.base ? `${daemon.base}${path}` : path;
}

/** Long enough for a slow local call, short enough that a wedged one never leaves the UI waiting forever. */
const CALL_TIMEOUT_MS = 60_000;
/** A `!` command may run for two minutes on the server; the wait here has to outlast that. */
const SHELL_TIMEOUT_MS = 150_000;
/** Two missed heartbeats. The server sends one every 25s, so silence this long means the stream is gone. */
const STREAM_IDLE_MS = 70_000;

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
  let response: Response;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    response = await fetch(url(path), {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        // In a header rather than the URL, so it stays out of history, logs and shared links.
        ...(daemon.token ? { authorization: `Bearer ${daemon.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: daemon.base ? "include" : "same-origin",
      signal: abort.signal,
    });
  } catch {
    throw new MuseGuiError(
      abort.signal.aborted
        ? "The local Muse Code GUI server took too long to answer."
        : "The local Muse Code GUI server is not reachable. Is it still running?",
      0,
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const failure = (data ?? {}) as { error?: unknown; kind?: unknown };
    throw new MuseGuiError(
      typeof failure.error === "string" ? failure.error : `${method} ${path} failed with ${response.status}.`,
      response.status,
      typeof failure.kind === "string" ? failure.kind : null,
    );
  }
  return data as T;
}

const enc = encodeURIComponent;

/** The Muse Code GUI client over the local server's REST API and server-sent events. */
export class WebMuseGuiClient implements MuseGuiClient {
  private readonly handlers = new Set<EventHandler>();
  private source: EventSource | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  /** The handshake is awaited before the stream opens; this stops a second subscriber racing it. */
  private connecting = false;

  probeEnvironment(refresh = false): Promise<EnvironmentStatus> {
    return call<EnvironmentStatus>("GET", `/api/env${refresh ? "?refresh=1" : ""}`);
  }

  async listProjects(): Promise<ProjectView[]> {
    return (await call<{ projects: ProjectView[] }>("GET", "/api/projects")).projects;
  }

  async addProject(cwd: string, options?: { create?: boolean }): Promise<{ cwd: string; warning: string | null }> {
    const result = await call<{ project: { cwd: string }; warning: string | null }>("POST", "/api/projects", {
      cwd,
      create: options?.create === true,
    });
    return { cwd: result.project.cwd, warning: result.warning };
  }

  async cloneProject(url: string, path: string): Promise<{ cwd: string; warning: string | null }> {
    const result = await call<{ project: { cwd: string }; warning: string | null }>("POST", "/api/projects/clone", { url, path });
    return { cwd: result.project.cwd, warning: result.warning };
  }

  listDirectory(path: string): Promise<DirectoryListing> {
    return call<DirectoryListing>("GET", `/api/fs/list?path=${enc(path)}`);
  }

  async revealPath(path: string): Promise<void> {
    await call("POST", "/api/fs/reveal", { path });
  }

  async hideProject(cwd: string): Promise<void> {
    await call("DELETE", `/api/projects?cwd=${enc(cwd)}`);
  }

  async setPinned(cwd: string, pinned: boolean): Promise<void> {
    await call("PATCH", "/api/projects/pin", { cwd, pinned });
  }

  async setProjectOrder(cwds: string[]): Promise<void> {
    await call("PATCH", "/api/projects/order", { cwds });
  }

  usage(days?: number): Promise<UsageReport> {
    return call<UsageReport>("GET", `/api/usage${days ? `?days=${days}` : ""}`);
  }

  importOmpUsage(): Promise<OmpImportResult> {
    return call<OmpImportResult>("POST", "/api/usage/import-omp");
  }

  async runShellProxy(sessionId: string, command: string): Promise<ShellRun> {
    // The server lets a command run for two minutes, so this must outlast that rather than abandon it early.
    const result = await call<{ run: ShellRun }>("POST", `/api/sessions/${enc(sessionId)}/shell-proxy`, { command }, SHELL_TIMEOUT_MS);
    return result.run;
  }

  async listSessions(options?: { archived?: boolean }): Promise<SessionSummary[]> {
    return (await call<{ sessions: SessionSummary[] }>("GET", `/api/sessions${options?.archived ? "?archived=1" : ""}`)).sessions;
  }

  async discover(cwd?: string): Promise<void> {
    await call("POST", "/api/discover", cwd ? { cwd } : {});
  }

  async startSession(
    cwd: string,
    options?: { approvalMode?: ApprovalMode; modelId?: string; accountId?: string | null },
  ): Promise<SessionSummary> {
    const result = await call<{ session: SessionSummary }>("POST", "/api/sessions", {
      cwd,
      approvalMode: options?.approvalMode,
      modelId: options?.modelId,
      accountId: options?.accountId ?? undefined,
    });
    return result.session;
  }

  loadTranscript(sessionId: string): Promise<TranscriptLoad> {
    return call<TranscriptLoad>("POST", `/api/sessions/${enc(sessionId)}/resume`, {});
  }

  async updateSession(sessionId: string, patch: { title?: string; archived?: boolean; settled?: boolean; pinned?: boolean }): Promise<SessionSummary | null> {
    return (await call<{ session: SessionSummary | null }>("PATCH", `/api/sessions/${enc(sessionId)}`, patch)).session;
  }

  async sendTurn(
    sessionId: string,
    text: string,
    options?: TurnOptions,
  ): Promise<{ turnId: string | null; disposition: string | null; attachments?: AttachmentView[] }> {
    const result = await call<{ turnId: string | null; disposition: unknown; attachments?: AttachmentView[] }>("POST", "/api/turns", {
      sessionId,
      text,
      ifBusy: options?.ifBusy,
      reasoningEffort: options?.reasoningEffort,
      displayText: options?.displayText,
      attachments: options?.attachments,
    });
    return {
      turnId: result.turnId ?? null,
      disposition: typeof result.disposition === "string" ? result.disposition : null,
      ...(result.attachments ? { attachments: result.attachments } : {}),
    };
  }

  async interruptTurn(sessionId: string, turnId?: string): Promise<void> {
    await call("POST", "/api/turns/interrupt", { sessionId, turnId });
  }

  async unqueueTurn(sessionId: string, turnId: string): Promise<void> {
    await call("POST", "/api/turns/unqueue", { sessionId, turnId });
  }

  async decideApproval(input: ApprovalDecisionInput): Promise<void> {
    await call("POST", "/api/approvals/decide", input);
  }

  async answerUserInput(sessionId: string, userInputId: string, answers: UserInputAnswer[]): Promise<void> {
    await call("POST", "/api/user-input/answer", { sessionId, userInputId, answers });
  }

  async cancelUserInput(sessionId: string, userInputId: string): Promise<void> {
    await call("POST", "/api/user-input/cancel", { sessionId, userInputId });
  }

  async clarifyUserInput(sessionId: string, userInputId: string, content: string): Promise<void> {
    await call("POST", "/api/user-input/clarify", { sessionId, userInputId, content });
  }

  async listModels(sessionId?: string): Promise<ModelOption[]> {
    const result = await call<{ models: unknown }>("GET", `/api/models${sessionId ? `?sessionId=${enc(sessionId)}` : ""}`);
    return parseModelList(result.models);
  }

  async getTitleSettings(): Promise<TitleSettings> {
    return parseTitleSettings(await call<unknown>("GET", "/api/title-settings"));
  }

  async setTitleSettings(patch: { enabled?: boolean; modelId?: string | null }): Promise<TitleSettings> {
    return parseTitleSettings(await call<unknown>("PATCH", "/api/title-settings", patch));
  }

  async getSandboxSettings(): Promise<SandboxSettings> {
    return parseSandboxSettings(await call<unknown>("GET", "/api/sandbox-settings"));
  }

  async setSandboxSettings(patch: { disabled?: boolean }): Promise<SandboxSettings> {
    return parseSandboxSettings(await call<unknown>("PATCH", "/api/sandbox-settings", patch));
  }

  async listAccounts(): Promise<AccountView[]> {
    return parseAccounts(await call<unknown>("GET", "/api/accounts"));
  }

  async createAccount(id: string, options?: { name?: string; seedFromDefault?: boolean }): Promise<{ id: string; name: string }> {
    const res = await call<{ account: { id: string; name: string } }>("POST", "/api/accounts", {
      id,
      name: options?.name,
      seedFromDefault: options?.seedFromDefault ?? false,
    });
    return res.account;
  }

  async renameAccount(id: string, name: string): Promise<void> {
    await call("PATCH", `/api/accounts/${enc(id)}`, { name });
  }

  async removeAccount(id: string): Promise<void> {
    await call("DELETE", `/api/accounts/${enc(id)}`);
  }

  async setProjectDefaultAccount(cwd: string, accountId: string | null): Promise<void> {
    await call("PATCH", "/api/projects/default-account", { cwd, accountId });
  }

  async accountsHealth(): Promise<{ metaApiKeyInherited: boolean }> {
    return call<{ metaApiKeyInherited: boolean }>("GET", "/api/accounts/health");
  }

  async loginAccount(id: string): Promise<{ url: string; code: string | null } | { fallback: string }> {
    return call<{ url: string; code: string | null } | { fallback: string }>("POST", `/api/accounts/${enc(id)}/login`);
  }

  async getYoloSettings(): Promise<YoloSettings> {
    return parseYoloSettings(await call<unknown>("GET", "/api/yolo-settings"));
  }

  async setYoloSettings(patch: { enabled?: boolean }): Promise<YoloSettings> {
    return parseYoloSettings(await call<unknown>("PATCH", "/api/yolo-settings", patch));
  }

  async getFeedSettings(): Promise<FeedSettings> {
    return parseFeedSettings(await call<unknown>("GET", "/api/feed-settings"));
  }

  async setFeedSettings(patch: { catchUp?: boolean }): Promise<FeedSettings> {
    return parseFeedSettings(await call<unknown>("PATCH", "/api/feed-settings", patch));
  }

  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/model`, { model: { modelId } });
  }

  async setApprovalMode(sessionId: string, mode: ApprovalMode): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/approval-mode`, { mode });
  }

  async compact(sessionId: string): Promise<{ noop: boolean; reason: string | null }> {
    const { result } = await call<{ result: { status?: unknown; reason?: unknown } | null }>(
      "POST",
      `/api/sessions/${enc(sessionId)}/compact`,
      {},
    );
    return { noop: result?.status === "noop", reason: typeof result?.reason === "string" ? result.reason : null };
  }

  async runShell(sessionId: string, command: string): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/shell`, { command });
  }

  async forkSession(sessionId: string): Promise<SessionSummary> {
    return (await call<{ session: SessionSummary }>("POST", `/api/sessions/${enc(sessionId)}/fork`, {})).session;
  }

  async sideChat(sessionId: string): Promise<SessionSummary> {
    return (await call<{ session: SessionSummary }>("POST", `/api/sessions/${enc(sessionId)}/side`, {})).session;
  }

  listSkills(cwd: string, sessionId?: string): Promise<SkillCatalog> {
    return call<SkillCatalog>("GET", `/api/slash?cwd=${enc(cwd)}${sessionId ? `&sessionId=${enc(sessionId)}` : ""}`);
  }

  async skillBody(cwd: string, skillId: string): Promise<string> {
    return (await call<{ body: string }>("GET", `/api/slash/skill?cwd=${enc(cwd)}&id=${enc(skillId)}`)).body;
  }

  async openFolder(cwd: string, target: "files" | "editor"): Promise<void> {
    await call("POST", "/api/open", { cwd, target });
  }

  async setReasoningEffort(sessionId: string, effort: ReasoningEffort): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/effort`, { reasoningEffort: effort });
  }

  async goal(sessionId: string, action: GoalAction, objective?: string): Promise<{ turnId: string | null }> {
    const result = await call<{ turnId?: string | null }>("POST", `/api/sessions/${enc(sessionId)}/goal`, { action, objective });
    return { turnId: result.turnId ?? null };
  }

  async subagent(sessionId: string, action: SubagentAction, subagentId: string, options?: { reason?: string; body?: string }): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/subagent`, { action, subagentId, reason: options?.reason, body: options?.body });
  }

  async task(sessionId: string, action: TaskAction, taskId?: string): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/tasks`, { action, taskId });
  }

  async workflow(sessionId: string, action: WorkflowAction, workflowRunId: string, child?: { childId: string; attempt: number }): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/workflow`, { action, workflowRunId, childId: child?.childId, attempt: child?.attempt });
  }

  async readOutput(sessionId: string, itemId: string, outputRef: string, offset = 0): Promise<OutputRange> {
    const path = `/api/sessions/${enc(sessionId)}/output?itemId=${enc(itemId)}&outputRef=${enc(outputRef)}&offset=${offset}`;
    return (await call<{ output: OutputRange }>("GET", path)).output;
  }

  async planUsage(): Promise<{ usage: PlanUsage | null; byAccount: PlanUsageByAccount }> {
    const res = await call<{ usage: PlanUsage | null; byAccount?: PlanUsageByAccount }>("GET", "/api/plan-usage");
    return { usage: res.usage, byAccount: res.byAccount ?? {} };
  }

  listFiles(cwd: string, path: string): Promise<FileListing> {
    return call<FileListing>("GET", `/api/files/list?cwd=${enc(cwd)}&path=${enc(path)}`);
  }

  readFile(cwd: string, path: string): Promise<FileContent> {
    return call<FileContent>("GET", `/api/files/read?cwd=${enc(cwd)}&path=${enc(path)}`);
  }

  writeFile(cwd: string, path: string, content: string, baseMtimeMs: number | null): Promise<{ path: string; size: number; mtimeMs: number }> {
    return call("PUT", "/api/files/write", { cwd, path, content, baseMtimeMs });
  }

  revertChanges(cwd: string, path: string, steps: { before: string | null; after: string }[]): Promise<{ path: string; outcome: "reverted" | "deleted" }> {
    return call("POST", "/api/files/revert", { cwd, path, steps });
  }

  async searchFiles(cwd: string, query: string): Promise<FileEntry[]> {
    return (await call<{ files: FileEntry[] }>("GET", `/api/files/search?cwd=${enc(cwd)}&q=${enc(query)}`)).files;
  }

  async openFileExternally(cwd: string, path: string): Promise<void> {
    await call("POST", "/api/files/open", { cwd, path });
  }

  fileUrl(cwd: string, path: string): string {
    return this.assetUrl(`/api/files/raw?cwd=${enc(cwd)}&path=${enc(path)}`);
  }

  /**
   * A server path the browser loads by itself, like an attachment's bytes. It carries no token: the
   * cookie from the handshake is what lets these through, so nothing secret ends up in an `img` tag.
   */
  assetUrl(path: string): string {
    return url(path);
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    void this.connect();
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0) {
        this.stopWatchdog();
        this.source?.close();
        this.source = null;
      }
    };
  }

  private async connect(): Promise<void> {
    if (this.source || this.connecting) {
      return;
    }
    this.connecting = true;
    try {
      // EventSource cannot send a header, so the token buys a cookie first and the stream uses that.
      if (daemon.token) {
        await call("POST", "/api/auth", { token: daemon.token });
      }
    } catch {
      // Let the stream try anyway: an unauthenticated daemon needs no handshake, and a real refusal
      // surfaces as a lost connection rather than a silent nothing.
    } finally {
      this.connecting = false;
    }
    if (this.source || this.handlers.size === 0) {
      return;
    }
    const source = new EventSource(url("/api/events"), { withCredentials: Boolean(daemon.base) });
    source.addEventListener("musegui", (message) => {
      this.touch();
      try {
        this.dispatch(JSON.parse((message as MessageEvent<string>).data) as MuseGuiEvent);
      } catch {
        /* ignore malformed frames */
      }
    });
    // The server's heartbeat: proof the stream is still carrying, and nothing else.
    source.addEventListener("ping", () => this.touch());
    source.addEventListener("open", () => this.touch());
    source.addEventListener("error", () => this.dispatch({ type: "connection", state: "lost" }));
    this.source = source;
    this.touch();
  }

  /** Restarts the idle timer. A stream that says nothing for two missed heartbeats is treated as dead. */
  private touch(): void {
    this.stopWatchdog();
    this.watchdog = setTimeout(() => this.revive(), STREAM_IDLE_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  /**
   * A dead stream the browser cannot see: a proxy can hold the connection open long after its upstream has
   * gone, so no `error` ever fires and the app sits on a transcript that stopped moving. Tearing it down by
   * hand and opening a new one brings back `hello`, which is what makes the app reload what it missed.
   */
  private revive(): void {
    this.stopWatchdog();
    this.source?.close();
    this.source = null;
    this.dispatch({ type: "connection", state: "lost" });
    if (this.handlers.size > 0) {
      void this.connect();
    }
  }

  private dispatch(event: MuseGuiEvent): void {
    for (const handler of [...this.handlers]) {
      handler(event);
    }
  }
}
