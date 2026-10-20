import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MuseGuiServer, type HostExit, type HostHandle } from "../src/server.js";
import type { ServeTarget } from "@musegui/daemon";
import {
  REMOTE_HOME_SCRIPT,
  REMOTE_SCRIPT_COMMAND,
  SSH_OPTS,
  SshError,
  discoveredProjectRoot,
  extractFramed,
  isSshCwd,
  listSshDirectory,
  normalizeSshCwd,
  parseSshLs,
  parseSshProject,
  readSshHome,
  remoteListScript,
  resolveSshPath,
  shellQuote,
  sshArgv,
  sshFailure,
  stripAnsiCodes,
  sshParent,
  sshServeArgs,
  validateSshHost,
  type SshRunFn,
  type SshRunResult,
} from "../src/ssh.js";

/** What a remote script prints, with rc-file noise around the markers like a chatty login shell. */
function framedOutput(body: string): string {
  return `Welcome to devbox\n__musegui_begin__\n${body}\n__musegui_end__\nbye\n`;
}

/** A reachable host whose scripts answer through `reply`, keyed on the script it was sent. */
function remote(reply: (script: string) => string, calls?: { args: string[]; input: string }[]): SshRunFn {
  return async (args, input = "") => {
    calls?.push({ args, input });
    return { stdout: framedOutput(reply(input)), stderr: "", exitCode: 0, missing: false };
  };
}

/** A host that never runs the script, with what ssh said on stderr. */
function failing(stderr: string, extra: Partial<SshRunResult> = {}): SshRunFn {
  return async () => ({ stdout: "", stderr, exitCode: 255, missing: false, ...extra });
}

const unreachable = failing("ssh: connect to host h port 22: Connection refused");

describe("ssh paths", () => {
  it("validates hostnames without letting options or shell through", () => {
    assert.equal(validateSshHost("devbox.example.com"), "devbox.example.com");
    assert.equal(validateSshHost("deploy@db1"), "deploy@db1");
    assert.equal(validateSshHost("Example.COM"), "example.com");
    assert.equal(validateSshHost("deploy@DB1"), "deploy@db1");
    for (const bad of ["", "  ", "a b", "a;b", "a|b", "a&b", "a$b", "-h", ".h", "h-", "h.", "a..b", "ssh://h/x", "h/x", "-oFoo", "-Elog@h", "-deploy@h", "x".repeat(256)]) {
      assert.equal(validateSshHost(bad), null, bad);
    }
  });

  it("splits ssh://host/path projects", () => {
    assert.deepEqual(parseSshProject("ssh://h/app"), { host: "h", remotePath: "/app" });
    assert.deepEqual(parseSshProject("ssh://deploy@H/"), { host: "deploy@h", remotePath: "/" });
    assert.deepEqual(parseSshProject("ssh://h"), { host: "h", remotePath: "/" });
    assert.equal(parseSshProject("ssh://bad;host/x"), null);
    assert.equal(parseSshProject("/local/path"), null);
    assert.equal(isSshCwd("ssh://h/app"), true);
    assert.equal(isSshCwd("  ssh://h/app "), true);
    assert.equal(isSshCwd("/srv/app"), false);
  });

  it("normalizes stored SSH keys and rejects unexpanded or relative paths", () => {
    assert.equal(normalizeSshCwd("ssh://H/MyApp//"), "ssh://h/MyApp");
    assert.equal(normalizeSshCwd("ssh://h/"), "ssh://h/");
    assert.equal(normalizeSshCwd("ssh://h/a/../b"), "ssh://h/b");
    // `~` forms only resolve with a remote `$HOME` lookup, so they never live in a stored key.
    assert.equal(normalizeSshCwd("ssh://h/~/code"), null);
    assert.equal(normalizeSshCwd("ssh://h/relative"), "ssh://h/relative");
    assert.equal(normalizeSshCwd("ssh://bad;host/x"), null);
    assert.equal(sshParent("ssh://h/a/b"), "ssh://h/a");
    assert.equal(sshParent("ssh://h/a"), "ssh://h/");
    assert.equal(sshParent("ssh://h/"), null);
  });

  it("resolves remote paths against the remote home", () => {
    assert.equal(resolveSshPath("h", "~/code", "/home/dev"), "/home/dev/code");
    assert.equal(resolveSshPath("h", "~", "/home/dev"), "/home/dev");
    assert.equal(resolveSshPath("h", "/~/code", "/home/dev"), "/home/dev/code");
    assert.equal(resolveSshPath("h", "/~", "/home/dev"), "/home/dev");
    assert.equal(resolveSshPath("h", "/srv//app/", null), "/srv/app");
    assert.throws(() => resolveSshPath("h", "relative", null), (e) => e instanceof SshError && e.status === 400);
    assert.throws(() => resolveSshPath("h", "~/x", null), (e) => e instanceof SshError && e.status === 502);
  });

  it("builds strict ssh argv for the agent, started inside the project folder", () => {
    assert.deepEqual(sshServeArgs("h", "/srv/app", ["serve"]), [...SSH_OPTS, "--", "h", "cd '/srv/app' && exec muse serve"]);
    assert.deepEqual(sshServeArgs("deploy@h", "/srv/o'clock", ["serve", "--disable-sandbox"]), [
      ...SSH_OPTS,
      "--",
      "deploy@h",
      "cd '/srv/o'\\''clock' && exec muse serve --disable-sandbox",
    ]);
    assert.deepEqual(sshArgv("h", "ls"), [...SSH_OPTS, "--", "h", "ls"]);
  });

  it("keeps a pty off the stream and notices a host that went away", () => {
    assert.equal(SSH_OPTS[0], "-T");
    for (const option of ["BatchMode=yes", "RequestTTY=no", "ServerAliveInterval=15", "ServerAliveCountMax=3"]) {
      assert.ok(SSH_OPTS.includes(option), option);
    }
  });

  it("quotes remote paths for a single remote shell string", () => {
    assert.equal(shellQuote("/srv/app"), "'/srv/app'");
    assert.equal(shellQuote("/srv/o'clock"), "'/srv/o'\\''clock'");
  });

  it("sends scripts on stdin to sh, so the login shell never parses a path", () => {
    // csh expands `!` even inside single quotes and fish reads backslashes its own way; the
    // login shell only ever sees `sh -s`.
    assert.equal(REMOTE_SCRIPT_COMMAND, "sh -s");
    const script = remoteListScript("/srv/o'clock!");
    assert.ok(script.includes(`p=${shellQuote("/srv/o'clock!")}`));
    assert.match(script, /command ls -1 -p -A -- "\$p"/);
    assert.match(script, /^printf '%s\\n' __musegui_begin__\n/);
    assert.match(script, /__musegui_end__\n$/);
  });

  it("reads only what the script printed between its markers", () => {
    assert.equal(extractFramed("motd\n__musegui_begin__\na/\nb/\n\n__musegui_end__\n"), "a/\nb/\n");
    assert.equal(extractFramed("__musegui_begin__\n\n__musegui_end__\n"), "");
    // rc output alone, or a script cut off before its end, is not an empty folder.
    assert.equal(extractFramed("Last login: today\n"), null);
    assert.equal(extractFramed("__musegui_begin__\na/\n"), null);
  });

  it("runs the real listing script under a POSIX sh", { skip: process.platform === "win32" }, () => {
    const root = mkdtempSync(join(tmpdir(), "musegui-ssh-"));
    const folder = join(root, "o'clock!");
    mkdirSync(join(folder, "b"), { recursive: true });
    mkdirSync(join(folder, ".hidden"));
    writeFileSync(join(folder, "notes.txt"), "");
    writeFileSync(join(root, "file"), "");
    const run = (path: string) => {
      const out = spawnSync("sh", ["-s"], { input: remoteListScript(path), encoding: "utf8" }).stdout;
      const body = extractFramed(out);
      assert.notEqual(body, null, out);
      return parseSshLs(body as string);
    };
    assert.deepEqual(run(folder), { exists: true, entries: [{ name: ".hidden" }, { name: "b" }] });
    assert.deepEqual(run(join(root, "missing")), { exists: false, entries: [] });
    assert.deepEqual(run(join(root, "file")), { exists: false, entries: [] });
    const home = spawnSync("sh", ["-s"], { input: REMOTE_HOME_SCRIPT, encoding: "utf8", env: { ...process.env, HOME: "/home/dev" } });
    assert.equal(extractFramed(home.stdout)?.trim(), "/home/dev");
  });

  it("parses remote listings, keeping folders only", () => {
    assert.deepEqual(parseSshLs("b/\na.txt\nA/\n"), {
      exists: true,
      entries: [{ name: "A" }, { name: "b" }],
    });
    assert.deepEqual(parseSshLs("__musegui_noent__"), { exists: false, entries: [] });
    assert.deepEqual(parseSshLs("__musegui_notdir__"), { exists: false, entries: [] });
    assert.deepEqual(parseSshLs(""), { exists: true, entries: [] });
  });

  it("survives a colorized ls alias from the remote shell's rc files", () => {
    // `command` bypasses aliases and functions, so `alias ls='ls --color=always'`
    // (or an exa wrapper) cannot change the output shape. `-A` keeps hidden folders.
    const script = remoteListScript("/srv/app");
    assert.match(script, /command ls -1 -p -A -- "\$p"/);
    // Belt and braces: color codes from any source still parse.
    assert.equal(stripAnsiCodes("\x1b[01;34mproj/\x1b[0m"), "proj/");
    assert.deepEqual(parseSshLs("\x1b[01;34mproj/\x1b[0m\nnotes.txt\n\x1b[01;34m.hidden/\x1b[0m\n"), {
      exists: true,
      entries: [{ name: ".hidden" }, { name: "proj" }],
    });
  });

  it("re-keys discovered remote roots onto their ssh:// project", () => {
    assert.equal(discoveredProjectRoot("ssh://h/MyApp", "/MyApp"), "ssh://h/MyApp");
    assert.equal(discoveredProjectRoot("ssh://deploy@h/a", "/x"), "ssh://deploy@h/x");
    assert.equal(discoveredProjectRoot("/local", "/MyApp"), "/MyApp");
    assert.equal(discoveredProjectRoot("ssh://h/a", "relative"), "relative");
    assert.equal(discoveredProjectRoot("ssh://h/a", null), "ssh://h/a");
    assert.equal(discoveredProjectRoot(undefined, undefined), "");
  });

  it("lists over ssh and reports an unreachable host", async () => {
    const calls: { args: string[]; input: string }[] = [];
    assert.deepEqual(await listSshDirectory("h", "/srv", remote(() => "proj/\nnotes.txt\n", calls)), {
      exists: true,
      entries: [{ name: "proj" }],
    });
    assert.deepEqual(calls[0]?.args, [...SSH_OPTS, "--", "h", "sh -s"]);
    assert.equal(calls[0]?.input, remoteListScript("/srv"));
    await assert.rejects(() => listSshDirectory("h", "/srv", unreachable), (e) => e instanceof SshError && e.status === 502);
    assert.deepEqual(await listSshDirectory("h", "/nope", remote(() => "__musegui_noent__")), { exists: false, entries: [] });
    assert.deepEqual(await listSshDirectory("h", "/empty", remote(() => "")), { exists: true, entries: [] });
    assert.equal(await readSshHome("h", remote(() => "/home/dev\n")), "/home/dev");
    await assert.rejects(() => readSshHome("h", remote(() => "")), (e) => e instanceof SshError && e.status === 502);
  });

  it("says why ssh failed, in words that say what to fix", async () => {
    const said = async (run: SshRunFn) => {
      const error = await listSshDirectory("devbox", "/srv", run).then(
        () => assert.fail("expected a failure"),
        (e: unknown) => e as SshError,
      );
      assert.equal(error.status, 502);
      return error.message;
    };
    const hostKey = await said(failing("Host key verification failed.\r\n"));
    assert.match(hostKey, /Host key verification failed/);
    assert.match(hostKey, /ssh devbox`? once in a terminal/);
    const password = await said(failing("deploy@devbox: Permission denied (publickey,password).\n"));
    assert.match(password, /Permission denied/);
    assert.match(password, /without a password/);
    const refused = await said(unreachable);
    assert.match(refused, /Connection refused/);
    const missing = await said(failing("spawn ssh ENOENT", { exitCode: 127, missing: true }));
    assert.match(missing, /Could not find ssh on this machine/);
    assert.doesNotMatch(missing, /without a password/);
    // Nothing on stderr still names the exit code rather than guessing.
    assert.match(sshFailure("h", { stdout: "", stderr: "", exitCode: 255, missing: false }, "reach").message, /code 255/);
  });
});

class FakeConnection {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  replies = new Map<string, unknown>();

  async command(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    return this.replies.get(method) ?? { ok: true };
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.command(method, params);
  }

  handler: ((n: { method: string; params?: unknown }) => void) | null = null;

  onNotification(handler: (n: { method: string; params?: unknown }) => void): void {
    this.handler = handler;
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.handler?.({ method, params });
  }
}

interface Probe {
  targets: ServeTarget[];
}

function fakeFactory(connection: FakeConnection, probe?: Probe): (target: ServeTarget) => HostHandle {
  return (target) => {
    probe?.targets.push(target);
    return {
      start: async () => ({ initializeResult: { serverInfo: { name: "muse", version: "1.1.1" } } }),
      connection: connection as never,
      close: async () => ({ code: 0, signal: null }),
      onExit: (_handler: (exit: HostExit) => void) => {},
    };
  };
}

async function request(base: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("ssh routes", () => {
  it("browses remote folders through the picker endpoint, caching the remote home", async () => {
    const calls: { args: string[]; input: string }[] = [];
    const sshRun = remote((script) => (script === REMOTE_HOME_SCRIPT ? "/home/dev\n" : "proj/\nnotes.txt\n"), calls);
    const server = new MuseGuiServer({
      port: 0,
      dataDir: ":memory:",
      platform: "linux",
      musePath: "muse",
      hostFactory: () => {
        throw new Error("no Muse host in this test");
      },
      opener: async () => {},
      exec: async () => ({ stdout: "", exitCode: 127 }),
      sshRun,
    });
    after(() => server.close());
    const base = `http://127.0.0.1:${(await server.listen()).port}`;

    const first = await request(base, `/api/fs/list?path=${encodeURIComponent("ssh://h/~/")}`);
    assert.equal(first.status, 200);
    assert.equal(first.json.directory, "ssh://h/home/dev");
    assert.equal(first.json.parent, "ssh://h/home");
    assert.equal(first.json.separator, "/");
    assert.equal(first.json.exists, true);
    assert.deepEqual(first.json.entries, [{ name: "proj" }]);

    const second = await request(base, `/api/fs/list?path=${encodeURIComponent("ssh://h/~/")}`);
    assert.equal(second.status, 200);
    assert.equal(calls.filter((c) => c.input === REMOTE_HOME_SCRIPT).length, 1, "the remote home is cached");

    assert.equal((await request(base, `/api/fs/list?path=${encodeURIComponent("ssh://bad;host/x")}`)).status, 400);
  });

  it("answers 502 when the remote host is unreachable", async () => {
    const server = new MuseGuiServer({
      port: 0,
      dataDir: ":memory:",
      platform: "linux",
      musePath: "muse",
      hostFactory: () => {
        throw new Error("no Muse host in this test");
      },
      opener: async () => {},
      exec: async () => ({ stdout: "", exitCode: 127 }),
      sshRun: failing("Host key verification failed."),
    });
    after(() => server.close());
    const base = `http://127.0.0.1:${(await server.listen()).port}`;
    const res = await request(base, `/api/fs/list?path=${encodeURIComponent("ssh://h/srv")}`);
    assert.equal(res.status, 502);
    assert.match(res.json.error ?? res.json.message ?? "", /Host key verification failed/);
  });

  it("adds ssh:// projects and starts their threads through ssh", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const probe: Probe = { targets: [] };
    const server = new MuseGuiServer({
      port: 0,
      dataDir: ":memory:",
      platform: "linux",
      musePath: "muse",
      hostFactory: fakeFactory(connection, probe),
      opener: async () => {},
      exec: async () => ({ stdout: "", exitCode: 127 }),
    });
    after(() => server.close());
    const base = `http://127.0.0.1:${(await server.listen()).port}`;

    const added = await request(base, "/api/projects", { cwd: "ssh://H/MyApp/" });
    assert.equal(added.status, 200);
    assert.equal(added.json.project.cwd, "ssh://h/MyApp");

    const projects = (await (await fetch(`${base}/api/projects`)).json()) as { projects: { cwd: string }[] };
    assert.deepEqual(projects.projects.map((p) => p.cwd), ["ssh://h/MyApp"]);

    const started = await request(base, "/api/sessions", { cwd: "ssh://h/MyApp" });
    assert.equal(started.status, 200);
    assert.equal(started.json.session.sessionId, "s1");
    assert.equal(probe.targets[0]?.command, "ssh");
    assert.deepEqual(probe.targets[0]?.args, [...SSH_OPTS, "--", "h", "cd '/MyApp' && exec muse serve"]);
    assert.equal(
      connection.calls.find((c) => c.method === "session/start")?.params["workspaceRoot"],
      "/MyApp",
      "the remote agent gets the remote path",
    );

    const files = await request(base, `/api/files/list?cwd=${encodeURIComponent("ssh://h/MyApp")}&path=`);
    assert.equal(files.status, 400);

    const proxy = await request(base, "/api/sessions/s1/shell-proxy", { command: "ls" });
    assert.equal(proxy.status, 400);
  });

  it("files discovered remote sessions under their ssh:// project", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/list", {
      sessions: [{ sessionId: "s9", workspaceRoot: "/MyApp", name: "Remote work" }],
      nextCursor: null,
    });
    const server = new MuseGuiServer({
      port: 0,
      dataDir: ":memory:",
      platform: "linux",
      musePath: "muse",
      hostFactory: fakeFactory(connection),
      opener: async () => {},
      exec: async () => ({ stdout: "", exitCode: 127 }),
    });
    after(() => server.close());
    const base = `http://127.0.0.1:${(await server.listen()).port}`;

    const found = await request(base, "/api/discover", { cwd: "ssh://h/MyApp" });
    assert.equal(found.status, 200);
    assert.equal(found.json.sessions[0]?.cwd, "ssh://h/MyApp");
    const projects = (await (await fetch(`${base}/api/projects`)).json()) as { projects: { cwd: string }[] };
    assert.deepEqual(projects.projects.map((p) => p.cwd), ["ssh://h/MyApp"]);
  });

  it("refuses to create remote folders", async () => {
    const server = new MuseGuiServer({
      port: 0,
      dataDir: ":memory:",
      platform: "linux",
      musePath: "muse",
      hostFactory: () => {
        throw new Error("no Muse host in this test");
      },
      opener: async () => {},
      exec: async () => ({ stdout: "", exitCode: 127 }),
    });
    after(() => server.close());
    const base = `http://127.0.0.1:${(await server.listen()).port}`;
    assert.equal((await request(base, "/api/projects", { cwd: "ssh://h/fresh", create: true })).status, 400);
  });

  it("runs the remote agent from the remote PATH, not the local muse path", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const probe: Probe = { targets: [] };
    const server = new MuseGuiServer({
      port: 0,
      dataDir: ":memory:",
      platform: "linux",
      musePath: "/opt/homebrew/bin/muse",
      hostFactory: fakeFactory(connection, probe),
      opener: async () => {},
      exec: async () => ({ stdout: "", exitCode: 127 }),
    });
    after(() => server.close());
    const base = `http://127.0.0.1:${(await server.listen()).port}`;
    assert.equal((await request(base, "/api/sessions", { cwd: "ssh://h/app" })).status, 200);
    assert.equal(probe.targets[0]?.command, "ssh");
    assert.deepEqual(probe.targets[0]?.args, [...SSH_OPTS, "--", "h", "cd '/app' && exec muse serve"]);
  });

  it("keeps SSH projects on the remote host's own login", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const probe: Probe = { targets: [] };
    const server = new MuseGuiServer({
      port: 0,
      dataDir: ":memory:",
      platform: "linux",
      musePath: "muse",
      hostFactory: fakeFactory(connection, probe),
      opener: async () => {},
      exec: async () => ({ stdout: "", exitCode: 127 }),
    });
    after(() => server.close());
    const base = `http://127.0.0.1:${(await server.listen()).port}`;
    const started = await request(base, "/api/sessions", { cwd: "ssh://h/app", accountId: "work" });
    assert.equal(started.status, 400);
    assert.match(started.json.error ?? started.json.message ?? "", /remote host's own Muse login/);
    assert.equal(probe.targets.length, 0, "no host spawned for a refused account");
    const pinned = await request(base, "/api/projects/default-account", { cwd: "ssh://h/app", accountId: "work" }, "PATCH");
    assert.equal(pinned.status, 400);
    assert.equal((await request(base, "/api/projects/default-account", { cwd: "ssh://h/app", accountId: null }, "PATCH")).status, 200);
  });

  it("never sends an SSH thread's first prompt to a local title call", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const execCalls: string[][] = [];
    const server = new MuseGuiServer({
      port: 0,
      dataDir: ":memory:",
      platform: "linux",
      musePath: "muse",
      hostFactory: fakeFactory(connection),
      opener: async () => {},
      exec: async (command, args) => {
        execCalls.push([command, ...args]);
        return { stdout: "", exitCode: 127 };
      },
    });
    after(() => server.close());
    const base = `http://127.0.0.1:${(await server.listen()).port}`;
    assert.equal((await request(base, "/api/sessions", { cwd: "ssh://h/app" })).status, 200);
    connection.notify("item/completed", {
      sessionId: "s1",
      item: { itemId: "i1", kind: "userMessage", revision: 1, status: "completed", text: "summarize the secrets in config/prod.env" },
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      execCalls.filter((call) => call.includes("exec")).length,
      0,
      "no local muse exec for a remote thread",
    );
  });

  it("reports whether an ssh client is installed", async () => {
    const env = async (sshRun: SshRunFn) => {
      const server = new MuseGuiServer({
        port: 0,
        dataDir: ":memory:",
        platform: "linux",
        musePath: "muse",
        hostFactory: () => {
          throw new Error("no Muse host in this test");
        },
        opener: async () => {},
        exec: async () => ({ stdout: "", exitCode: 127 }),
        sshRun,
      });
      after(() => server.close());
      const base = `http://127.0.0.1:${(await server.listen()).port}`;
      return (await request(base, "/api/env")).json;
    };
    assert.equal((await env(failing("OpenSSH_9.6p1", { exitCode: 0 }))).sshFound, true);
    assert.equal((await env(failing("spawn ssh ENOENT", { exitCode: 127, missing: true }))).sshFound, false);
  });

  it("rejects malformed ssh:// projects", async () => {
    const server = new MuseGuiServer({
      port: 0,
      dataDir: ":memory:",
      platform: "linux",
      musePath: "muse",
      hostFactory: () => {
        throw new Error("no Muse host in this test");
      },
      opener: async () => {},
      exec: async () => ({ stdout: "", exitCode: 127 }),
    });
    after(() => server.close());
    const base = `http://127.0.0.1:${(await server.listen()).port}`;
    assert.equal((await request(base, "/api/projects", { cwd: "ssh://bad;host/x" })).status, 400);
    assert.equal((await request(base, "/api/sessions", { cwd: "ssh://bad;host/x" })).status, 400);
  });
});
