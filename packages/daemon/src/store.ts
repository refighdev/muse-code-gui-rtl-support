import { DatabaseSync } from "node:sqlite";

export interface Project {
  id: number;
  cwd: string;
  displayName: string;
  pinned: boolean;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  /** Latest activity across the project's visible sessions, or its creation time. */
  activityAt: string;
  /** The aonia profile new threads in this project default to; null for the default login. */
  defaultAccountId: string | null;
}

/** How a session title was chosen; a higher rank is never overwritten by a lower one. */
export type TitleSource = "placeholder" | "auto" | "user";

const TITLE_RANK: Record<TitleSource, number> = { placeholder: 0, auto: 1, user: 2 };

export interface SessionRecord {
  id: string;
  projectId: number;
  title: string;
  titleSource: TitleSource;
  status: string;
  turnCount: number;
  modelId: string | null;
  origin: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  activityAt: string;
  /** `settled` shelves the thread; `active` keeps it out of auto-settle until its next activity. */
  settledOverride: SettledOverride | null;
  settledAt: string | null;
  unsettledAt: string | null;
  /** Pinned to the top of its project's thread list. */
  pinned: boolean;
  /** Sandbox posture at creation: null for sessions recorded before tracking. */
  sandboxDisabled: boolean | null;
  /** The aonia profile a session was created under; null for the default login. Set once, never changed. */
  accountId: string | null;
  /** For a side chat, the main session it was opened from; null otherwise. Set once, never changed. */
  sideOf: string | null;
}

export type SettledOverride = "settled" | "active";

export interface TurnRecord {
  id: string;
  sessionId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecordSessionInput {
  id: string;
  projectId: number;
  title?: string;
  titleSource?: TitleSource;
  modelId?: string | null;
  origin?: string;
  turnCount?: number;
  createdAt?: string;
  activityAt?: string;
  /** Creation posture; later touches never overwrite it. */
  sandboxDisabled?: boolean | null;
  /** Creation account; later touches never overwrite it. */
  accountId?: string | null;
  /** The main session a side chat came from. Filled in once, the first time it is known. */
  sideOf?: string | null;
}

export interface SessionPatch {
  title?: string;
  titleSource?: TitleSource;
  archived?: boolean;
  modelId?: string | null;
  turnCount?: number;
  activityAt?: string;
  status?: string;
  settledOverride?: SettledOverride | null;
  settledAt?: string | null;
  unsettledAt?: string | null;
  pinned?: boolean;
}

export const PLACEHOLDER_TITLE = "New thread";

/** Server-owned thread-title generation: the switch and the model, kept where the worker can read them. */
export interface TitleSettings {
  enabled: boolean;
  modelId: string | null;
}

export const DEFAULT_TITLE_SETTINGS: TitleSettings = { enabled: true, modelId: null };

/** Server-owned Muse sandbox posture: whether `muse serve` hosts spawn with `--disable-sandbox`. Off by default. */
export interface SandboxSettings {
  disabled: boolean;
}

export const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = { disabled: false };

/**
 * Server-owned YOLO mode: the `muse --yolo` posture for every host it spawns
 * (`--disable-sandbox --trust-workspace`) plus the wire-level approval bypass.
 * Off by default.
 */
export interface YoloSettings {
  enabled: boolean;
}

export const DEFAULT_YOLO_SETTINGS: YoloSettings = { enabled: false };

/**
 * Server-owned feed mode: whether a session Muse stops pushing updates for is asked for them
 * instead. Off by default.
 */
export interface FeedSettings {
  catchUp: boolean;
}

export const DEFAULT_FEED_SETTINGS: FeedSettings = { catchUp: false };

function nowIso(): string {
  return new Date().toISOString();
}

function displayNameFor(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

function isTitleSource(value: unknown): value is TitleSource {
  return value === "placeholder" || value === "auto" || value === "user";
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cwd TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL DEFAULT 'New session',
  status TEXT NOT NULL DEFAULT 'active',
  turn_count INTEGER NOT NULL DEFAULT 0,
  model_id TEXT,
  origin TEXT NOT NULL DEFAULT 'musegui',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  ord INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'image',
  width INTEGER,
  height INTEGER,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shell_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  command TEXT NOT NULL,
  exit_code INTEGER,
  output TEXT NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  model_id TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_shell_runs_session ON shell_runs(session_id, at);
CREATE INDEX IF NOT EXISTS idx_usage_at ON usage(at);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_attachments_session ON attachments(session_id, turn_id);
`;

/** Columns added after the first release; applied in place so existing databases keep their data. */
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "projects", column: "hidden", ddl: "ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0" },
  { table: "projects", column: "position", ddl: "ALTER TABLE projects ADD COLUMN position INTEGER" },
  {
    table: "sessions",
    column: "title_source",
    ddl: "ALTER TABLE sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'placeholder'",
  },
  { table: "sessions", column: "activity_at", ddl: "ALTER TABLE sessions ADD COLUMN activity_at TEXT" },
  { table: "sessions", column: "archived", ddl: "ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0" },
  { table: "sessions", column: "settled_override", ddl: "ALTER TABLE sessions ADD COLUMN settled_override TEXT" },
  { table: "sessions", column: "settled_at", ddl: "ALTER TABLE sessions ADD COLUMN settled_at TEXT" },
  { table: "sessions", column: "unsettled_at", ddl: "ALTER TABLE sessions ADD COLUMN unsettled_at TEXT" },
  // NULL for sessions recorded before posture tracking; only new rows carry a value.
  { table: "sessions", column: "sandbox_disabled", ddl: "ALTER TABLE sessions ADD COLUMN sandbox_disabled INTEGER" },
  // NULL = the default Muse login, i.e. today's behaviour; only sessions started under a profile carry an id.
  { table: "sessions", column: "account_id", ddl: "ALTER TABLE sessions ADD COLUMN account_id TEXT" },
  { table: "projects", column: "default_account_id", ddl: "ALTER TABLE projects ADD COLUMN default_account_id TEXT" },
  { table: "sessions", column: "pinned", ddl: "ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0" },
  { table: "sessions", column: "side_of", ddl: "ALTER TABLE sessions ADD COLUMN side_of TEXT" },
];

type Row = Record<string, string | number | null>;

/** A file the user attached to a prompt. `kind` is "image" when Muse saw it, "file" when it went to the workspace. */
export interface AttachmentRecord {
  id: string;
  sessionId: string;
  turnId: string | null;
  ord: number;
  name: string;
  mediaType: string;
  kind: "image" | "file";
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface AddAttachmentInput {
  id: string;
  sessionId: string;
  turnId: string | null;
  ord: number;
  name: string;
  mediaType: string;
  kind: "image" | "file";
  width?: number | null;
  height?: number | null;
  bytes: Uint8Array;
}

/** A `!` command Muse Code GUI ran itself, with what it printed. */
export interface ShellRunRecord {
  id: string;
  sessionId: string;
  command: string;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  durationMs: number | null;
  at: string;
}

/** One model call's tokens, as the store keeps them for the usage page. */
export interface UsageCall {
  key: string;
  sessionId: string;
  turnId: string | null;
  modelId: string | null;
  promptTokens: number;
  outputTokens: number;
  inputTokens: number;
  cachedTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  durationMs: number | null;
  at: string;
}

export interface UsageRow extends UsageCall {
  sessionTitle: string | null;
  projectCwd: string | null;
}

function toAttachment(row: Row): AttachmentRecord {
  return {
    id: String(row["id"]),
    sessionId: String(row["session_id"]),
    turnId: row["turn_id"] === null ? null : String(row["turn_id"]),
    ord: Number(row["ord"] ?? 0),
    name: String(row["name"]),
    mediaType: String(row["media_type"]),
    kind: row["kind"] === "file" ? "file" : "image",
    width: row["width"] === null ? null : Number(row["width"]),
    height: row["height"] === null ? null : Number(row["height"]),
    createdAt: String(row["created_at"]),
  };
}

export class MuseGuiStore {
  private readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    this.migrate();
  }

  private migrate(): void {
    for (const migration of MIGRATIONS) {
      const columns = this.db.prepare(`PRAGMA table_info(${migration.table})`).all() as Row[];
      if (!columns.some((c) => c["name"] === migration.column)) {
        this.db.exec(migration.ddl);
      }
    }
  }

  /** Malformed rows fall back to defaults rather than breaking the worker that reads them. */
  getTitleSettings(): TitleSettings {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = 'title'`).get() as Row | undefined;
    if (!row) {
      return { ...DEFAULT_TITLE_SETTINGS };
    }
    try {
      const parsed = JSON.parse(String(row["value"])) as Partial<TitleSettings>;
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_TITLE_SETTINGS.enabled,
        modelId: typeof parsed.modelId === "string" && parsed.modelId.trim().length > 0 ? parsed.modelId : null,
      };
    } catch {
      return { ...DEFAULT_TITLE_SETTINGS };
    }
  }

  setTitleSettings(patch: Partial<TitleSettings>): TitleSettings {
    const current = this.getTitleSettings();
    const next: TitleSettings = {
      enabled: patch.enabled ?? current.enabled,
      modelId: patch.modelId !== undefined ? patch.modelId : current.modelId,
    };
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES ('title', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(next));
    return next;
  }

  /** Malformed rows fall back to sandbox-on rather than breaking host startup. */
  getSandboxSettings(): SandboxSettings {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = 'sandbox'`).get() as Row | undefined;
    if (!row) {
      return { ...DEFAULT_SANDBOX_SETTINGS };
    }
    try {
      const parsed = JSON.parse(String(row["value"])) as Partial<SandboxSettings>;
      return {
        disabled: typeof parsed.disabled === "boolean" ? parsed.disabled : DEFAULT_SANDBOX_SETTINGS.disabled,
      };
    } catch {
      return { ...DEFAULT_SANDBOX_SETTINGS };
    }
  }

  setSandboxSettings(patch: Partial<SandboxSettings>): SandboxSettings {
    const current = this.getSandboxSettings();
    const next: SandboxSettings = {
      disabled: patch.disabled ?? current.disabled,
    };
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES ('sandbox', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(next));
    return next;
  }

  /** Malformed rows fall back to YOLO-off rather than breaking host startup. */
  getYoloSettings(): YoloSettings {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = 'yolo'`).get() as Row | undefined;
    if (!row) {
      return { ...DEFAULT_YOLO_SETTINGS };
    }
    try {
      const parsed = JSON.parse(String(row["value"])) as Partial<YoloSettings>;
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_YOLO_SETTINGS.enabled,
      };
    } catch {
      return { ...DEFAULT_YOLO_SETTINGS };
    }
  }

  setYoloSettings(patch: Partial<YoloSettings>): YoloSettings {
    const current = this.getYoloSettings();
    const next: YoloSettings = {
      enabled: patch.enabled ?? current.enabled,
    };
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES ('yolo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(next));
    return next;
  }

  /** Malformed rows fall back to catch-up off rather than breaking server startup. */
  getFeedSettings(): FeedSettings {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = 'feed'`).get() as Row | undefined;
    if (!row) {
      return { ...DEFAULT_FEED_SETTINGS };
    }
    try {
      const parsed = JSON.parse(String(row["value"])) as Partial<FeedSettings>;
      return {
        catchUp: typeof parsed.catchUp === "boolean" ? parsed.catchUp : DEFAULT_FEED_SETTINGS.catchUp,
      };
    } catch {
      return { ...DEFAULT_FEED_SETTINGS };
    }
  }

  setFeedSettings(patch: Partial<FeedSettings>): FeedSettings {
    const current = this.getFeedSettings();
    const next: FeedSettings = {
      catchUp: patch.catchUp ?? current.catchUp,
    };
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES ('feed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(next));
    return next;
  }

  upsertProject(cwd: string): Project {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO projects (cwd, display_name, pinned, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?)
         ON CONFLICT(cwd) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(cwd, displayNameFor(cwd), now, now);
    return this.getProject(cwd) as Project;
  }

  getProject(cwd: string): Project | null {
    const row = this.db
      .prepare(`SELECT p.*, ${this.projectActivitySql()} AS activity_at FROM projects p WHERE p.cwd = ?`)
      .get(cwd) as Row | undefined;
    return row ? this.toProject(row) : null;
  }

  listProjects(options: { includeHidden?: boolean } = {}): Project[] {
    const where = options.includeHidden ? "" : "WHERE p.hidden = 0";
    const rows = this.db
      .prepare(
        `SELECT p.*, ${this.projectActivitySql()} AS activity_at
         FROM projects p ${where}
         ORDER BY p.pinned DESC, p.position IS NULL, p.position, activity_at DESC, p.id DESC`,
      )
      .all() as Row[];
    return rows.map((row) => this.toProject(row));
  }

  /** A `!` command Muse Code GUI ran itself in the workspace, kept so a reopened thread still shows it. */
  addShellRun(input: ShellRunRecord): ShellRunRecord {
    this.db
      .prepare(
        `INSERT INTO shell_runs (id, session_id, command, exit_code, output, truncated, duration_ms, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.sessionId,
        input.command,
        input.exitCode ?? null,
        input.output,
        input.truncated ? 1 : 0,
        input.durationMs ?? null,
        input.at,
      );
    return input;
  }

  listShellRuns(sessionId: string): ShellRunRecord[] {
    const rows = this.db.prepare(`SELECT * FROM shell_runs WHERE session_id = ? ORDER BY at`).all(sessionId) as Row[];
    return rows.map((row) => ({
      id: String(row["id"]),
      sessionId: String(row["session_id"]),
      command: String(row["command"]),
      exitCode: row["exit_code"] === null ? null : Number(row["exit_code"]),
      output: String(row["output"] ?? ""),
      truncated: Number(row["truncated"] ?? 0) === 1,
      durationMs: row["duration_ms"] === null ? null : Number(row["duration_ms"]),
      at: String(row["at"]),
    }));
  }

  /**
   * One model call's tokens. Keyed by the view cursor that carried it, so replaying a thread's history
   * never counts a call twice.
   */
  recordUsage(call: UsageCall): void {
    this.db
      .prepare(
        `INSERT INTO usage (key, session_id, turn_id, model_id, prompt_tokens, output_tokens, input_tokens,
           cached_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, duration_ms, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO NOTHING`,
      )
      .run(
        call.key,
        call.sessionId,
        call.turnId ?? null,
        call.modelId ?? null,
        call.promptTokens,
        call.outputTokens,
        call.inputTokens,
        call.cachedTokens,
        call.cacheReadTokens,
        call.cacheWriteTokens,
        call.reasoningTokens,
        call.durationMs ?? null,
        call.at,
      );
  }

  /** True when a call with `key` is already stored, so importers can report only new calls. */
  hasUsage(key: string): boolean {
    const row = this.db.prepare(`SELECT 1 AS ok FROM usage WHERE key = ?`).get(key) as Row | undefined;
    return row !== undefined;
  }

  /** Every recorded call since `since`, newest last, with the thread and project it belongs to. */
  listUsage(since?: string): UsageRow[] {
    const rows = this.db
      .prepare(
        `SELECT u.*, s.title AS session_title, p.cwd AS project_cwd
         FROM usage u
         LEFT JOIN sessions s ON s.id = u.session_id
         LEFT JOIN projects p ON p.id = s.project_id
         ${since ? "WHERE u.at >= ?" : ""}
         ORDER BY u.at`,
      )
      .all(...(since ? [since] : [])) as Row[];
    return rows.map((row) => ({
      key: String(row["key"]),
      sessionId: String(row["session_id"]),
      turnId: row["turn_id"] === null ? null : String(row["turn_id"]),
      modelId: row["model_id"] === null ? null : String(row["model_id"]),
      promptTokens: Number(row["prompt_tokens"] ?? 0),
      outputTokens: Number(row["output_tokens"] ?? 0),
      inputTokens: Number(row["input_tokens"] ?? 0),
      cachedTokens: Number(row["cached_tokens"] ?? 0),
      cacheReadTokens: Number(row["cache_read_tokens"] ?? 0),
      cacheWriteTokens: Number(row["cache_write_tokens"] ?? 0),
      reasoningTokens: Number(row["reasoning_tokens"] ?? 0),
      durationMs: row["duration_ms"] === null ? null : Number(row["duration_ms"]),
      at: String(row["at"]),
      sessionTitle: row["session_title"] === null || row["session_title"] === undefined ? null : String(row["session_title"]),
      projectCwd: row["project_cwd"] === null || row["project_cwd"] === undefined ? null : String(row["project_cwd"]),
    }));
  }

  /** The order the user dragged projects into; anything not listed keeps falling back to recent activity. */
  setProjectOrder(cwds: string[]): void {
    const now = nowIso();
    const update = this.db.prepare(`UPDATE projects SET position = ?, updated_at = ? WHERE cwd = ?`);
    cwds.forEach((cwd, index) => update.run(index, now, cwd));
  }

  setPinned(cwd: string, pinned: boolean): void {
    this.db
      .prepare(`UPDATE projects SET pinned = ?, updated_at = ? WHERE cwd = ?`)
      .run(pinned ? 1 : 0, nowIso(), cwd);
  }

  /** Hiding removes a project from the sidebar without touching Muse's own session data. */
  setHidden(cwd: string, hidden: boolean): void {
    this.db
      .prepare(`UPDATE projects SET hidden = ?, updated_at = ? WHERE cwd = ?`)
      .run(hidden ? 1 : 0, nowIso(), cwd);
  }

  /** Which account new threads here default to; null clears it back to the default login. */
  setDefaultAccount(cwd: string, accountId: string | null): void {
    this.db
      .prepare(`UPDATE projects SET default_account_id = ?, updated_at = ? WHERE cwd = ?`)
      .run(accountId, nowIso(), cwd);
  }

  /**
   * Files the user attached to a prompt. Muse keeps only their metadata on the view, so the bytes live here
   * and a reopened thread can still show what was sent.
   */
  addAttachment(input: AddAttachmentInput): AttachmentRecord {
    this.db
      .prepare(
        `INSERT INTO attachments (id, session_id, turn_id, ord, name, media_type, kind, width, height, bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.sessionId,
        input.turnId ?? null,
        input.ord,
        input.name,
        input.mediaType,
        input.kind,
        input.width ?? null,
        input.height ?? null,
        input.bytes,
        nowIso(),
      );
    return this.getAttachment(input.id) as AttachmentRecord;
  }

  listAttachments(sessionId: string): AttachmentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, turn_id, ord, name, media_type, kind, width, height, created_at
         FROM attachments WHERE session_id = ? ORDER BY created_at, ord`,
      )
      .all(sessionId) as Row[];
    return rows.map((row) => toAttachment(row));
  }

  getAttachment(id: string): AttachmentRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, turn_id, ord, name, media_type, kind, width, height, created_at
         FROM attachments WHERE id = ?`,
      )
      .get(id) as Row | undefined;
    return row ? toAttachment(row) : null;
  }

  /** The stored bytes, for serving one attachment back to the UI. */
  readAttachment(id: string): { record: AttachmentRecord; bytes: Uint8Array } | null {
    const row = this.db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as (Row & { bytes?: unknown }) | undefined;
    if (!row || !(row.bytes instanceof Uint8Array)) {
      return null;
    }
    return { record: toAttachment(row), bytes: row.bytes };
  }

  recordSession(input: RecordSessionInput): SessionRecord {
    const now = nowIso();
    const existing = this.getSession(input.id);
    if (!existing) {
      const titleSource = input.titleSource ?? (input.title ? "auto" : "placeholder");
      this.db
        .prepare(
          `INSERT INTO sessions (id, project_id, title, title_source, status, turn_count, model_id, origin,
             archived, sandbox_disabled, account_id, side_of, created_at, updated_at, activity_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.projectId,
          input.title ?? PLACEHOLDER_TITLE,
          titleSource,
          input.turnCount ?? 0,
          input.modelId ?? null,
          input.origin ?? "musegui",
          input.sandboxDisabled === undefined || input.sandboxDisabled === null ? null : input.sandboxDisabled ? 1 : 0,
          input.accountId ?? null,
          input.sideOf ?? null,
          input.createdAt ?? now,
          now,
          input.activityAt ?? input.createdAt ?? now,
        );
      return this.getSession(input.id) as SessionRecord;
    }
    const patch: SessionPatch = {};
    if (input.title !== undefined) {
      const incoming = input.titleSource ?? "auto";
      if (TITLE_RANK[incoming] >= TITLE_RANK[existing.titleSource]) {
        patch.title = input.title;
        patch.titleSource = incoming;
      }
    }
    if (input.modelId !== undefined && input.modelId !== null) {
      patch.modelId = input.modelId;
    }
    if (input.turnCount !== undefined && input.turnCount > existing.turnCount) {
      patch.turnCount = input.turnCount;
    }
    if (input.activityAt !== undefined && input.activityAt > existing.activityAt) {
      patch.activityAt = input.activityAt;
    }
    if (input.sideOf && existing.sideOf === null) {
      this.db.prepare(`UPDATE sessions SET side_of = ? WHERE id = ?`).run(input.sideOf, input.id);
    }
    if (existing.projectId !== input.projectId) {
      this.db.prepare(`UPDATE sessions SET project_id = ? WHERE id = ?`).run(input.projectId, input.id);
    }
    return this.updateSession(input.id, patch) ?? existing;
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Row | undefined;
    return row ? this.toSession(row) : null;
  }

  /** The session plus the project directory it belongs to, in one lookup. */
  findSession(id: string): { session: SessionRecord; cwd: string } | null {
    const row = this.db
      .prepare(`SELECT s.*, p.cwd AS project_cwd FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?`)
      .get(id) as Row | undefined;
    return row ? { session: this.toSession(row), cwd: String(row["project_cwd"]) } : null;
  }

  listSessionsByProject(projectId: number, options: { includeArchived?: boolean } = {}): SessionRecord[] {
    const archived = options.includeArchived ? "" : "AND archived = 0";
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions WHERE project_id = ? ${archived}
         ORDER BY COALESCE(activity_at, updated_at) DESC`,
      )
      .all(projectId) as Row[];
    return rows.map((row) => this.toSession(row));
  }

  updateSession(id: string, patch: SessionPatch): SessionRecord | null {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.title !== undefined) {
      sets.push("title = ?");
      values.push(patch.title);
    }
    if (patch.titleSource !== undefined) {
      sets.push("title_source = ?");
      values.push(patch.titleSource);
    }
    if (patch.archived !== undefined) {
      sets.push("archived = ?");
      values.push(patch.archived ? 1 : 0);
    }
    if (patch.modelId !== undefined) {
      sets.push("model_id = ?");
      values.push(patch.modelId);
    }
    if (patch.turnCount !== undefined) {
      sets.push("turn_count = ?");
      values.push(patch.turnCount);
    }
    if (patch.activityAt !== undefined) {
      sets.push("activity_at = ?");
      values.push(patch.activityAt);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      values.push(patch.status);
    }
    if (patch.settledOverride !== undefined) {
      sets.push("settled_override = ?");
      values.push(patch.settledOverride);
    }
    if (patch.settledAt !== undefined) {
      sets.push("settled_at = ?");
      values.push(patch.settledAt);
    }
    if (patch.unsettledAt !== undefined) {
      sets.push("unsettled_at = ?");
      values.push(patch.unsettledAt);
    }
    if (patch.pinned !== undefined) {
      sets.push("pinned = ?");
      values.push(patch.pinned ? 1 : 0);
    }
    if (sets.length > 0) {
      sets.push("updated_at = ?");
      values.push(nowIso());
      this.db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    }
    return this.getSession(id);
  }

  /** Visible threads with no settle choice whose last activity is older than `before`; pinned threads stay put. */
  listSettleCandidates(before: string): SessionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE settled_override IS NULL AND archived = 0 AND pinned = 0 AND COALESCE(activity_at, updated_at) < ?`,
      )
      .all(before) as Row[];
    return rows.map((row) => this.toSession(row));
  }

  recordTurn(id: string, sessionId: string): TurnRecord {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO turns (id, session_id, status, created_at, updated_at)
         VALUES (?, ?, 'running', ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(id, sessionId, now, now);
    this.db
      .prepare(
        `UPDATE sessions SET turn_count = turn_count + 1, updated_at = ?, activity_at = ? WHERE id = ?`,
      )
      .run(now, now, sessionId);
    return this.getTurn(id);
  }

  updateTurnStatus(id: string, status: string): void {
    this.db
      .prepare(`UPDATE turns SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, nowIso(), id);
  }

  close(): void {
    this.db.close();
  }

  private projectActivitySql(): string {
    return `COALESCE((SELECT MAX(COALESCE(s.activity_at, s.updated_at)) FROM sessions s
      WHERE s.project_id = p.id AND s.archived = 0), p.created_at)`;
  }

  private getTurn(id: string): TurnRecord {
    const row = this.db.prepare(`SELECT * FROM turns WHERE id = ?`).get(id) as Row | undefined;
    if (!row) {
      throw new Error(`MuseGuiStore: unknown turn ${id}.`);
    }
    return {
      id: String(row["id"]),
      sessionId: String(row["session_id"]),
      status: String(row["status"]),
      createdAt: String(row["created_at"]),
      updatedAt: String(row["updated_at"]),
    };
  }

  private toProject(row: Row): Project {
    return {
      id: Number(row["id"]),
      cwd: String(row["cwd"]),
      displayName: String(row["display_name"]),
      pinned: Number(row["pinned"]) === 1,
      hidden: Number(row["hidden"] ?? 0) === 1,
      createdAt: String(row["created_at"]),
      updatedAt: String(row["updated_at"]),
      activityAt: String(row["activity_at"] ?? row["created_at"]),
      defaultAccountId: row["default_account_id"] === null || row["default_account_id"] === undefined ? null : String(row["default_account_id"]),
    };
  }

  private toSession(row: Row): SessionRecord {
    const titleSource = row["title_source"];
    return {
      id: String(row["id"]),
      projectId: Number(row["project_id"]),
      title: String(row["title"]),
      titleSource: isTitleSource(titleSource) ? titleSource : "placeholder",
      status: String(row["status"]),
      turnCount: Number(row["turn_count"]),
      modelId: row["model_id"] === null ? null : String(row["model_id"]),
      origin: String(row["origin"]),
      archived: Number(row["archived"] ?? 0) === 1,
      createdAt: String(row["created_at"]),
      updatedAt: String(row["updated_at"]),
      activityAt: String(row["activity_at"] ?? row["updated_at"]),
      settledOverride: row["settled_override"] === "settled" || row["settled_override"] === "active" ? row["settled_override"] : null,
      settledAt: row["settled_at"] === null || row["settled_at"] === undefined ? null : String(row["settled_at"]),
      unsettledAt: row["unsettled_at"] === null || row["unsettled_at"] === undefined ? null : String(row["unsettled_at"]),
      pinned: Number(row["pinned"] ?? 0) === 1,
      sandboxDisabled: row["sandbox_disabled"] === null || row["sandbox_disabled"] === undefined ? null : Number(row["sandbox_disabled"]) === 1,
      accountId: row["account_id"] === null || row["account_id"] === undefined ? null : String(row["account_id"]),
      sideOf: row["side_of"] === null || row["side_of"] === undefined ? null : String(row["side_of"]),
    };
  }
}
