import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MuseGuiStore } from "@musegui/daemon";
import { MuseGuiServer } from "../src/server.js";
import {
  classifyOmpTranscript,
  importOmpUsage,
  labelOmpSessionTitle,
  parseOmpSessionFile,
  resolveOmpSessionsDirs,
  sessionIdFromFilename,
} from "../src/ompUsage.js";

/** Fixture timestamps ride on the real clock so the rolling usage window always contains them. */
const NOW = new Date().toISOString();

function message(id: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "message",
    id,
    timestamp: NOW,
    message: {
      role: "assistant",
      provider: "muse-code",
      model: "muse-spark-1.3-contributor",
      content: [{ type: "text", text: "done" }],
      usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 0, totalTokens: 150, reasoningTokens: 5 },
      stopReason: "stop",
      timestamp: Date.parse(NOW),
      duration: 7108.32,
      ...overrides,
    },
  });
}

function modelUsage(id: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "model_usage",
    id,
    parentId: "daa207c9",
    timestamp: NOW,
    purpose: "auto-thinking",
    role: "tiny",
    api: "openai-completions",
    provider: "muse-code",
    model: "muse-spark-1.3-contributor",
    usage: { input: 259, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 260 },
    stopReason: "stop",
    ...overrides,
  });
}

/** Snapshot the listed env vars and clear them, so resolver tests see only what they set. */
function clearEnv(names: string[]): Map<string, string | undefined> {
  const saved = new Map<string, string | undefined>();
  for (const name of names) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  return saved;
}

function restoreEnv(saved: Map<string, string | undefined>): void {
  for (const [name, value] of saved) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

function sessionFile(lines: string[], sessionId = "019abc-session", cwd = "E:\\work\\app"): string {
  return [
    JSON.stringify({ type: "title", v: 1, title: "Fix the tests", updatedAt: NOW }),
    JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: NOW, cwd }),
    JSON.stringify({ type: "model_change", id: "m1", timestamp: NOW, model: "muse-code/muse-spark-1.3-contributor" }),
    ...lines,
  ].join("\n");
}

async function sessionsDir(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "musegui-omp-"));
  for (const [name, text] of Object.entries(files)) {
    const abs = join(root, name);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, text);
  }
  return root;
}

describe("parseOmpSessionFile", () => {
  it("maps a muse-code call onto a usage row", () => {
    const parsed = parseOmpSessionFile(sessionFile([message("e1")]), { sessionId: "fallback" });
    assert.equal(parsed.sessionId, "019abc-session");
    assert.equal(parsed.cwd, "E:\\work\\app");
    assert.equal(parsed.title, "Fix the tests");
    assert.equal(parsed.calls.length, 1);
    const call = parsed.calls[0]!;
    assert.equal(call.key, "omp:019abc-session:e1");
    assert.equal(call.sessionId, "omp:019abc-session");
    assert.equal(call.modelId, "muse-spark-1.3-contributor");
    assert.equal(call.promptTokens, 100);
    assert.equal(call.outputTokens, 20);
    assert.equal(call.cacheReadTokens, 30);
    assert.equal(call.reasoningTokens, 5);
    assert.equal(call.durationMs, 7108);
    assert.equal(call.at, NOW);
    assert.equal(parsed.skipped, 0);
  });

  it("ignores other providers without counting them as skipped", () => {
    const other = message("e2", { provider: "anthropic", model: "claude-opus-4-6" });
    const parsed = parseOmpSessionFile(sessionFile([other]), { sessionId: "fallback" });
    assert.equal(parsed.calls.length, 0);
    assert.equal(parsed.skipped, 0);
  });

  it("skips zero-token calls from failed turns", () => {
    const failed = message("e3", { usage: { input: 0, output: 0, totalTokens: 0 }, stopReason: "error" });
    const parsed = parseOmpSessionFile(sessionFile([failed, message("e4")]), { sessionId: "fallback" });
    assert.equal(parsed.calls.length, 1);
    assert.equal(parsed.calls[0]!.key, "omp:019abc-session:e4");
    assert.equal(parsed.skipped, 1);
  });

  it("tolerates malformed lines and falls back to the model change and filename id", () => {
    const bare = message("e5", { model: undefined });
    const parsed = parseOmpSessionFile(`not json\n${bare}`, { sessionId: "file-id" });
    assert.equal(parsed.sessionId, "file-id");
    assert.equal(parsed.cwd, null);
    assert.equal(parsed.calls.length, 1);
    // No session header ran, so no model_change either: the call keeps a null model rather than failing.
    assert.equal(parsed.calls[0]!.modelId, null);
    assert.equal(parsed.skipped, 1);
  });

  it("prefers the message model but remembers the latest model change", () => {
    const text = [
      JSON.stringify({ type: "model_change", id: "m1", timestamp: NOW, model: "muse-code/muse-spark-1.3" }),
      message("e6"),
    ].join("\n");
    const parsed = parseOmpSessionFile(text, { sessionId: "s" });
    assert.equal(parsed.calls[0]!.modelId, "muse-spark-1.3-contributor");
    assert.equal(parsed.modelId, "muse-spark-1.3-contributor");
  });

  it("counts muse-code model_usage entries OMP's stats parser also counts", () => {
    const parsed = parseOmpSessionFile(sessionFile([modelUsage("mu1")]), { sessionId: "fallback" });
    assert.equal(parsed.calls.length, 1);
    const call = parsed.calls[0]!;
    assert.equal(call.key, "omp:019abc-session:mu1");
    assert.equal(call.sessionId, "omp:019abc-session");
    assert.equal(call.modelId, "muse-spark-1.3-contributor");
    assert.equal(call.promptTokens, 259);
    assert.equal(call.outputTokens, 1);
    assert.equal(call.durationMs, null);
    assert.equal(call.at, NOW);
    assert.equal(parsed.skipped, 0);
  });

  it("ignores foreign-provider model_usage and skips zeroed model_usage blocks", () => {
    const foreign = modelUsage("mu2", { provider: "zai", model: "glm-5.3-flash" });
    const aborted = modelUsage("mu3", {
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: "aborted",
    });
    const parsed = parseOmpSessionFile(sessionFile([foreign, aborted, modelUsage("mu4")]), {
      sessionId: "fallback",
    });
    assert.equal(parsed.calls.length, 1);
    assert.equal(parsed.calls[0]!.key, "omp:019abc-session:mu4");
    assert.equal(parsed.skipped, 1);
  });
});

describe("sessionIdFromFilename", () => {
  it("takes the id after the timestamp", () => {
    assert.equal(sessionIdFromFilename("2026-09-15T12-41-20-481Z_019abc.jsonl"), "019abc");
    assert.equal(sessionIdFromFilename("plain.jsonl"), "plain");
  });
});

describe("classifyOmpTranscript", () => {
  it("treats <project>/<file>.jsonl as the main agent", () => {
    assert.deepEqual(classifyOmpTranscript("--E--work--app--/2026-10-05T12-00-00-000Z_019abc.jsonl"), {
      agentType: "main",
      name: null,
    });
  });

  it("treats deeper transcripts as subagents named by their stem", () => {
    assert.deepEqual(
      classifyOmpTranscript("--E--work--app--/2026-10-05T12-00-00-000Z_019abc/BunActivation.jsonl"),
      { agentType: "subagent", name: "BunActivation" },
    );
  });

  it("treats __advisor transcripts as advisor passes, keeping the owning subagent", () => {
    assert.deepEqual(
      classifyOmpTranscript("--E--work--app--/2026-10-05T12-00-00-000Z_019abc/__advisor.jsonl"),
      { agentType: "advisor", name: null },
    );
    assert.deepEqual(
      classifyOmpTranscript("--E--work--app--/2026-10-05T12-00-00-000Z_019abc/ChatGPTCrashDiagnosis/__advisor.jsonl"),
      { agentType: "advisor", name: "ChatGPTCrashDiagnosis" },
    );
    assert.deepEqual(classifyOmpTranscript("--E--work--app--/2026-10-05T12-00-00-000Z_019abc/__advisor.tiny.jsonl"), {
      agentType: "advisor",
      name: null,
    });
  });

  it("labels subagent and advisor threads without touching main titles", () => {
    assert.equal(labelOmpSessionTitle("Fix the tests", { agentType: "main", name: null }), "Fix the tests");
    assert.equal(
      labelOmpSessionTitle("Fix the tests", { agentType: "subagent", name: "BunActivation" }),
      "Fix the tests [subagent: BunActivation]",
    );
    assert.equal(labelOmpSessionTitle("Fix the tests", { agentType: "advisor", name: null }), "Fix the tests [advisor]");
    assert.equal(
      labelOmpSessionTitle(null, { agentType: "advisor", name: "ChatGPTCrashDiagnosis" }),
      "[advisor: ChatGPTCrashDiagnosis]",
    );
  });
});

describe("resolveOmpSessionsDirs", () => {
  it("honours PI_CODING_AGENT_DIR and otherwise uses ~/.omp/agent/sessions", () => {
    const saved = clearEnv(["PI_CODING_AGENT_DIR", "XDG_DATA_HOME", "OMP_AGENT_DIR"]);
    try {
      process.env["PI_CODING_AGENT_DIR"] = "";
      assert.deepEqual(resolveOmpSessionsDirs("/home/u"), [join("/home/u", ".omp", "agent", "sessions")]);
      process.env["PI_CODING_AGENT_DIR"] = "/data/omp";
      assert.deepEqual(resolveOmpSessionsDirs("/home/u"), [join("/data", "omp", "sessions")]);
    } finally {
      restoreEnv(saved);
    }
  });

  it("ignores OMP_AGENT_DIR, which OMP itself never reads", () => {
    const saved = clearEnv(["PI_CODING_AGENT_DIR", "XDG_DATA_HOME", "OMP_AGENT_DIR"]);
    try {
      process.env["OMP_AGENT_DIR"] = "/data/omp";
      assert.deepEqual(resolveOmpSessionsDirs("/home/u"), [join("/home/u", ".omp", "agent", "sessions")]);
    } finally {
      restoreEnv(saved);
    }
  });

  it("adds the flattened XDG tree on Linux once XDG_DATA_HOME is set", () => {
    const saved = clearEnv(["PI_CODING_AGENT_DIR", "XDG_DATA_HOME", "OMP_AGENT_DIR"]);
    try {
      process.env["XDG_DATA_HOME"] = "/xdg";
      assert.deepEqual(resolveOmpSessionsDirs("/home/u", { platform: "linux" }), [
        join("/home/u", ".omp", "agent", "sessions"),
        join("/xdg", "omp", "sessions"),
      ]);
      // Windows never consults XDG, even when the variable happens to be set.
      assert.deepEqual(resolveOmpSessionsDirs("/home/u", { platform: "win32" }), [
        join("/home/u", ".omp", "agent", "sessions"),
      ]);
    } finally {
      restoreEnv(saved);
    }
  });

  it("covers named profiles in both the home and XDG layouts", async () => {
    const saved = clearEnv(["PI_CODING_AGENT_DIR", "XDG_DATA_HOME", "OMP_AGENT_DIR"]);
    try {
      const home = await mkdtemp(join(tmpdir(), "musegui-omphome-"));
      await mkdir(join(home, ".omp", "profiles", "work", "agent", "sessions"), { recursive: true });
      assert.deepEqual(resolveOmpSessionsDirs(home), [
        join(home, ".omp", "agent", "sessions"),
        join(home, ".omp", "profiles", "work", "agent", "sessions"),
      ]);
      process.env["XDG_DATA_HOME"] = join(home, ".xdg");
      assert.deepEqual(resolveOmpSessionsDirs(home, { platform: "linux" }), [
        join(home, ".omp", "agent", "sessions"),
        join(home, ".xdg", "omp", "sessions"),
        join(home, ".omp", "profiles", "work", "agent", "sessions"),
        join(home, ".xdg", "omp", "profiles", "work", "sessions"),
      ]);
    } finally {
      restoreEnv(saved);
    }
  });
});

describe("importOmpUsage", () => {
  it("records calls once and attributes the session without listing it", async () => {
    const dir = await sessionsDir({
      "--E--work--app--/2026-10-05T12-00-00-000Z_019abc-session.jsonl": sessionFile([message("e1"), message("e2")]),
      "--E--work--app--/notes.txt": "not a session",
      "--E--work--other--/2026-10-05T12-00-00-000Z_other.jsonl": sessionFile([
        message("x1", { provider: "anthropic", model: "other" }),
      ]),
    });
    const store = new MuseGuiStore(":memory:");

    const first = await importOmpUsage(dir, store);
    assert.deepEqual(first, { files: 2, sessions: 1, calls: 2, skipped: 0 });

    const rows = store.listUsage();
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.sessionTitle, "Fix the tests");
    assert.equal(rows[0]!.projectCwd, "E:\\work\\app");

    const session = store.getSession("omp:019abc-session");
    assert.equal(session?.origin, "omp");
    assert.equal(session?.archived, true);

    const second = await importOmpUsage(dir, store);
    assert.deepEqual(second, { files: 2, sessions: 1, calls: 0, skipped: 0 });
    assert.equal(store.listUsage().length, 2);
  });

  it("returns zeros when OMP never ran here", async () => {
    const store = new MuseGuiStore(":memory:");
    const counts = await importOmpUsage(join(await mkdtemp(join(tmpdir(), "musegui-noomp-")), "sessions"), store);
    assert.deepEqual(counts, { files: 0, sessions: 0, calls: 0, skipped: 0 });
  });

  it("imports profile, XDG and labeled subagent/advisor trees in one pass", async () => {
    const saved = clearEnv(["PI_CODING_AGENT_DIR", "XDG_DATA_HOME", "OMP_AGENT_DIR"]);
    try {
      const home = await sessionsDir({
        ".omp/agent/sessions/--E--work--app--/main.jsonl": sessionFile([message("e1"), modelUsage("mu1")], "main-1"),
        ".omp/agent/sessions/--E--work--app--/sess-dir/Helper.jsonl": sessionFile([message("e2")], "sub-1"),
        ".omp/agent/sessions/--E--work--app--/sess-dir/__advisor.jsonl": sessionFile([message("e3")], "adv-1"),
        ".omp/profiles/work/agent/sessions/--E--work--app--/p.jsonl": sessionFile([message("e4")], "prof-1"),
      });
      const xdgHome = await sessionsDir({
        "omp/sessions/--E--work--app--/x.jsonl": sessionFile([message("e5")], "xdg-1"),
      });
      process.env["XDG_DATA_HOME"] = xdgHome;

      const store = new MuseGuiStore(":memory:");
      const counts = await importOmpUsage(resolveOmpSessionsDirs(home, { platform: "linux" }), store);
      assert.deepEqual(counts, { files: 5, sessions: 5, calls: 6, skipped: 0 });

      const ids = store.listUsage().map((row) => row.sessionId).sort();
      assert.deepEqual(ids, ["omp:adv-1", "omp:main-1", "omp:main-1", "omp:prof-1", "omp:sub-1", "omp:xdg-1"]);

      // Subagent and advisor transcripts are counted, but their threads stay labeled.
      assert.equal(store.getSession("omp:main-1")?.title, "Fix the tests");
      assert.equal(store.getSession("omp:sub-1")?.title, "Fix the tests [subagent: Helper]");
      assert.equal(store.getSession("omp:adv-1")?.title, "Fix the tests [advisor]");
      assert.equal(store.getSession("omp:prof-1")?.origin, "omp");
    } finally {
      restoreEnv(saved);
    }
  });

  it("hides projects the import creates but leaves existing projects visible", async () => {
    const store = new MuseGuiStore(":memory:");
    store.upsertProject("E:\\work\\existing");
    const before = store.listProjects().map((project) => project.cwd);

    const dir = await sessionsDir({
      "--E--work--new--/n.jsonl": sessionFile([message("e1")], "new-1", "E:\\work\\new"),
      "--E--work--existing--/o.jsonl": sessionFile([message("e2")], "old-1", "E:\\work\\existing"),
    });
    const counts = await importOmpUsage(dir, store);
    assert.deepEqual(counts, { files: 2, sessions: 2, calls: 2, skipped: 0 });

    // The sidebar sees exactly what it saw before: the fresh OMP-only folder stays hidden.
    assert.deepEqual(
      store.listProjects().map((project) => project.cwd),
      before,
    );
    const hidden = store.listProjects({ includeHidden: true });
    assert.equal(hidden.find((project) => project.cwd === "E:\\work\\new")?.hidden, true);
    assert.equal(hidden.find((project) => project.cwd === "E:\\work\\existing")?.hidden, false);

    // Hiding is sidebar-only: the Usage page still attributes both threads to their folders.
    const cwds = store.listUsage().map((row) => row.projectCwd).sort();
    assert.deepEqual(cwds, ["E:\\work\\existing", "E:\\work\\new"]);
  });
});

describe("POST /api/usage/import-omp", () => {
  it("imports through HTTP and the calls land in the usage report", async () => {
    const home = await mkdtemp(join(tmpdir(), "musegui-omphome-"));
    const dir = join(home, ".omp", "agent", "sessions", "--E--work--app--");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "2026-10-05T12-00-00-000Z_019abc-session.jsonl"), sessionFile([message("e1")]));

    const saved = clearEnv(["PI_CODING_AGENT_DIR", "XDG_DATA_HOME", "OMP_AGENT_DIR"]);
    try {
      const server = new MuseGuiServer({ port: 0, dataDir: ":memory:", home });
      after(() => server.close());
      const bound = await server.listen();
      const base = `http://127.0.0.1:${bound.port}`;

      const imported = await (await fetch(`${base}/api/usage/import-omp`, { method: "POST" })).json();
      assert.deepEqual(imported, { files: 1, sessions: 1, calls: 1, skipped: 0 });

      const report = (await (await fetch(`${base}/api/usage?days=30`)).json()) as any;
      assert.equal(report.buckets.length, 1);
      assert.equal(report.buckets[0].modelId, "muse-spark-1.3-contributor");
      assert.equal(report.buckets[0].promptTokens, 100);
      assert.equal(report.threads.length, 1);
      assert.equal(report.threads[0].sessionId, "omp:019abc-session");
    } finally {
      restoreEnv(saved);
    }
  });
});
