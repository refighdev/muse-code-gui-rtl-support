import { readdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MuseGuiStore, UsageCall } from "@musegui/daemon";

/**
 * OMP (oh-my-pi) usage import. OMP writes one JSONL session file per agent session, and assistant
 * entries carry their own token usage — including entries made through OMP's `muse-code` provider,
 * which bill the same Muse plan Muse Code GUI tracks but never pass through Muse Code GUI's hosts.
 * Standalone `model_usage` entries (auxiliary calls OMP's own stats parser also counts) are
 * included too, so the import does not undercount.
 */

/** The OMP provider id for Muse Code, as `packages/ai/src/usage/muse-code.ts` in oh-my-pi defines it. */
export const OMP_PROVIDER_ID = "muse-code";

export interface OmpImportCounts {
  /** Session files successfully scanned. */
  files: number;
  /** Files that contributed at least one `muse-code` call. */
  sessions: number;
  /** Calls newly recorded; re-imports record nothing thanks to the usage key. */
  calls: number;
  /** Zero-token calls and malformed lines passed over. Other providers are ignored, not counted. */
  skipped: number;
}

export interface ParsedOmpSession {
  sessionId: string;
  cwd: string | null;
  title: string | null;
  /** The latest model seen, for the session row; each call keeps its own model. */
  modelId: string | null;
  calls: UsageCall[];
  skipped: number;
}

/** Which agent produced a transcript: the main session, a task subagent, or an advisor pass. */
export type OmpAgentType = "main" | "subagent" | "advisor";

/**
 * Which agent produced a transcript, from its path inside a sessions dir. Mirrors OMP's
 * `classifyAgentType` (`packages/stats/src/parser.ts` in oh-my-pi): `<project>/<file>.jsonl`
 * is the main agent, anything nested deeper is a task subagent, and any `__advisor*.jsonl`
 * transcript — at any depth, including inside a subagent's own dir — is an advisor pass.
 * The returned name is the subagent's transcript stem (or the owning subagent dir for a
 * nested advisor transcript), so imported threads can be labeled instead of silently merged.
 */
export function classifyOmpTranscript(file: string): { agentType: OmpAgentType; name: string | null } {
  const segments = file.split(/[\\/]/).filter((part) => part.length > 0);
  const base = segments[segments.length - 1] ?? file;
  const stem = base.toLowerCase().endsWith(".jsonl") ? base.slice(0, -".jsonl".length) : base;
  if (stem === "__advisor" || stem.startsWith("__advisor.")) {
    const parent = segments.length > 3 ? (segments[segments.length - 2] ?? null) : null;
    return { agentType: "advisor", name: parent };
  }
  if (segments.length <= 2) {
    return { agentType: "main", name: null };
  }
  return { agentType: "subagent", name: stem || null };
}

/**
 * The session title to store for an imported transcript. Subagent and advisor transcripts
 * keep their own session rows (each carries its own `session` id) so their calls are counted,
 * and the `[subagent: …]` / `[advisor]` suffix keeps them visibly distinct from main threads.
 */
export function labelOmpSessionTitle(
  title: string | null,
  agent: { agentType: OmpAgentType; name: string | null },
): string | null {
  if (agent.agentType === "main") {
    return title;
  }
  const tag =
    agent.agentType === "advisor"
      ? (agent.name ? `advisor: ${agent.name}` : "advisor")
      : `subagent: ${agent.name ?? "unknown"}`;
  return title ? `${title} [${tag}]` : `[${tag}]`;
}

export interface ResolveOmpSessionsOptions {
  /** Defaults to `process.platform`; inject `"linux"` in tests to cover the XDG layout. */
  platform?: string;
}

/**
 * Every OMP session tree that may hold `muse-code` calls.
 *
 * - The default tree is `<agentDir>/sessions`, where the agent dir is `~/.omp/agent` unless
 *   `PI_CODING_AGENT_DIR` overrides it (`packages/utils/src/dirs.ts` in oh-my-pi). Note this
 *   is `PI_CODING_AGENT_DIR`, not `OMP_AGENT_DIR`: OMP's `env.ts` only aliases `OMP_*` names
 *   found in `.env` files (to `PI_AGENT_DIR`, which nothing reads), so `OMP_AGENT_DIR` in the
 *   process environment changes nothing and is ignored here too.
 * - Named profiles keep their own trees at `~/.omp/profiles/<name>/agent/sessions`; each
 *   existing profile dir contributes a candidate. A missing profiles dir is not an error.
 * - On Linux/macOS, a migrated OMP (`omp config migrate`) flattens the `agent/` prefix under
 *   `$XDG_DATA_HOME/omp`: the default tree becomes `$XDG_DATA_HOME/omp/sessions` and each
 *   migrated profile becomes `$XDG_DATA_HOME/omp/profiles/<name>/sessions`. Candidates are
 *   returned whether or not they exist; the importer treats a missing dir as a clean empty
 *   result, since most machines simply never ran OMP.
 */
export function resolveOmpSessionsDirs(home: string, options: ResolveOmpSessionsOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const override = process.env["PI_CODING_AGENT_DIR"]?.trim();
  const configRoot = join(home, ".omp");
  const dirs: string[] = [join(override ? override : join(configRoot, "agent"), "sessions")];
  // OMP only consults XDG when the agent dir is the default (an explicit PI_CODING_AGENT_DIR
  // replaces it outright), and only once the migration marker exists — but the importer skips
  // missing dirs anyway, so the candidate is harmless when OMP never migrated.
  const xdg = !override && (platform === "linux" || platform === "darwin") ? process.env["XDG_DATA_HOME"]?.trim() : undefined;
  if (xdg) {
    dirs.push(join(xdg, "omp", "sessions"));
  }
  let profiles: string[] = [];
  try {
    profiles = readdirSync(join(configRoot, "profiles"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch {
    profiles = [];
  }
  for (const name of profiles) {
    dirs.push(join(configRoot, "profiles", name, "agent", "sessions"));
    if (xdg) {
      dirs.push(join(xdg, "omp", "profiles", name, "sessions"));
    }
  }
  return dirs.filter((dir, index) => dirs.indexOf(dir) === index);
}

/** The session id from `<timestamp>_<id>.jsonl`, for files whose `session` line is missing. */
export function sessionIdFromFilename(file: string): string {
  const stem = file.split(/[\\/]/).pop() ?? file;
  const withoutExt = stem.toLowerCase().endsWith(".jsonl") ? stem.slice(0, -".jsonl".length) : stem;
  const id = withoutExt.includes("_") ? (withoutExt.split("_").pop() ?? withoutExt) : withoutExt;
  return id || withoutExt;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** An entry timestamp: the ISO line timestamp, the epoch-millis message stamp, or now so tokens are never lost. */
function entryAt(line: Record<string, unknown>, message: Record<string, unknown> | null): string {
  const iso = str(line["timestamp"]);
  if (iso && !Number.isNaN(Date.parse(iso))) {
    return iso;
  }
  const epoch = message ? num(message["timestamp"]) : null;
  if (epoch !== null) {
    return new Date(epoch).toISOString();
  }
  return new Date().toISOString();
}

/**
 * One OMP session file's `muse-code` calls. Malformed lines are skipped, never fatal: a session file
 * is an append-only log OMP may still be writing, and one bad line must not lose the rest.
 */
export function parseOmpSessionFile(text: string, fallback: { sessionId: string }): ParsedOmpSession {
  let sessionId = fallback.sessionId;
  let cwd: string | null = null;
  let title: string | null = null;
  let modelId: string | null = null;
  const calls: UsageCall[] = [];
  let skipped = 0;

  /** One counted call: shared by assistant messages and standalone model_usage entries. */
  function addCall(entry: {
    entryId: string;
    at: string;
    model: string | null;
    usage: Record<string, unknown>;
    durationMs: number | null;
  }): void {
    if (entry.model) {
      modelId = entry.model;
    }
    const promptTokens = num(entry.usage["input"]) ?? 0;
    const outputTokens = num(entry.usage["output"]) ?? 0;
    const cacheRead = num(entry.usage["cacheRead"]) ?? 0;
    calls.push({
      key: `omp:${sessionId}:${entry.entryId}`,
      sessionId: `omp:${sessionId}`,
      turnId: null,
      modelId: entry.model,
      promptTokens,
      outputTokens,
      inputTokens: promptTokens,
      cachedTokens: cacheRead,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: num(entry.usage["cacheWrite"]) ?? 0,
      reasoningTokens: num(entry.usage["reasoningTokens"]) ?? 0,
      durationMs: entry.durationMs,
      at: entry.at,
    });
  }

  const lines = text.split("\n");
  lines.forEach((raw, index) => {
    if (!raw.trim()) {
      return;
    }
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      skipped += 1;
      return;
    }
    const record = asRecord(line);
    if (!record) {
      skipped += 1;
      return;
    }
    const type = str(record["type"]);
    if (type === "session") {
      sessionId = str(record["id"]) ?? sessionId;
      cwd = str(record["cwd"]) ?? cwd;
      return;
    }
    if (type === "title") {
      title = str(record["title"]) ?? title;
      return;
    }
    if (type === "model_change") {
      modelId = str(record["model"]) ?? modelId;
      return;
    }
    if (type === "model_usage") {
      // Auxiliary single-shot calls (auto-thinking judges, background find, …) that never
      // appear as assistant messages. OMP's own stats parser counts them
      // (`isModelUsage` in packages/stats/src/parser.ts), so skipping them here undercounts.
      // Shape is flat: provider/model/usage sit on the entry itself, not under `message`.
      if (record["provider"] !== OMP_PROVIDER_ID) {
        return;
      }
      const modelUsage = asRecord(record["usage"]);
      const modelTotal = modelUsage ? (num(modelUsage["totalTokens"]) ?? 0) : 0;
      if (!modelUsage || modelTotal <= 0) {
        // Aborted background calls carry the same zeroed usage block as failed turns.
        skipped += 1;
        return;
      }
      const iso = str(record["timestamp"]);
      addCall({
        entryId: str(record["id"]) ?? `line-${index + 1}`,
        at: iso && !Number.isNaN(Date.parse(iso)) ? iso : new Date().toISOString(),
        model: str(record["model"]) ?? modelId,
        usage: modelUsage,
        durationMs: null,
      });
      return;
    }
    if (type !== "message") {
      return;
    }
    const message = asRecord(record["message"]);
    if (!message || message["role"] !== "assistant" || message["provider"] !== OMP_PROVIDER_ID) {
      return;
    }
    const usage = asRecord(message["usage"]);
    const totalTokens = usage ? (num(usage["totalTokens"]) ?? 0) : 0;
    if (!usage || totalTokens <= 0) {
      // Failed, aborted and no-op turns carry a zeroed usage block with no token signal.
      skipped += 1;
      return;
    }
    const duration = num(message["duration"]);
    addCall({
      entryId: str(record["id"]) ?? `line-${index + 1}`,
      at: entryAt(record, message),
      model: str(message["model"]) ?? modelId,
      usage,
      durationMs: duration === null ? null : Math.round(duration),
    });
  });

  return { sessionId, cwd, title, modelId, calls, skipped };
}

/**
 * Records every `muse-code` call across OMP's session trees (default, XDG, and named
 * profiles — see `resolveOmpSessionsDirs`). A missing sessions directory is a clean empty
 * result, not an error — most machines simply never ran OMP. Imported sessions are archived
 * on arrival and projects the import creates are hidden, so the sidebar is untouched: both
 * exist so the usage page can attribute their threads, not as threads to open.
 * Subagent and `__advisor` transcripts are counted under their own session rows with a labeled
 * title rather than skipped or silently merged into the main thread.
 */
export async function importOmpUsage(
  sessionsDir: string | string[],
  store: MuseGuiStore,
): Promise<OmpImportCounts> {
  const counts: OmpImportCounts = { files: 0, sessions: 0, calls: 0, skipped: 0 };
  const roots = (Array.isArray(sessionsDir) ? sessionsDir : [sessionsDir]).filter(
    (dir, index, all) => all.indexOf(dir) === index,
  );
  for (const root of roots) {
    let entries: string[];
    try {
      entries = await readdir(root, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const files = entries.filter((entry) => entry.toLowerCase().endsWith(".jsonl")).sort();
    for (const entry of files) {
      let text: string;
      try {
        text = await readFile(join(root, entry), "utf8");
      } catch {
        continue;
      }
      const parsed = parseOmpSessionFile(text, { sessionId: sessionIdFromFilename(entry) });
      counts.files += 1;
      counts.skipped += parsed.skipped;
      if (parsed.calls.length === 0) {
        continue;
      }
      counts.sessions += 1;
      if (parsed.cwd) {
        // Hide only projects the import itself created: new rows default to visible, and with
        // their sessions archived on arrival the sidebar would otherwise sort these empty
        // OMP-only folders to the top. Pre-existing Muse Code GUI projects keep their visibility.
        // `listUsage` joins projects without a hidden filter, so the Usage page still names them.
        const existed = store.getProject(parsed.cwd) !== null;
        const project = store.upsertProject(parsed.cwd);
        if (!existed) {
          store.setHidden(parsed.cwd, true);
        }
        const stamps = parsed.calls.map((call) => call.at).sort();
        const title = labelOmpSessionTitle(parsed.title, classifyOmpTranscript(entry));
        const session = store.recordSession({
          id: `omp:${parsed.sessionId}`,
          projectId: project.id,
          ...(title ? { title } : {}),
          ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
          origin: "omp",
          createdAt: stamps[0],
          activityAt: stamps[stamps.length - 1],
        });
        if (!session.archived) {
          store.updateSession(session.id, { archived: true });
        }
      }
      for (const call of parsed.calls) {
        if (store.hasUsage(call.key)) {
          continue;
        }
        store.recordUsage(call);
        counts.calls += 1;
      }
    }
  }
  return counts;
}
