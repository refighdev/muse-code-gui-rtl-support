import { spawn } from "node:child_process";
import { posix } from "node:path";
import type { DirectoryListing } from "./paths.js";

/**
 * SSH projects: `ssh://host/absolute/path`. The host reaches Muse on a remote
 * machine over a passwordless `ssh` connection, and MSP speaks over that
 * connection's stdio exactly as it does over a local `muse serve` pipe.
 */

/** An SSH failure carrying the HTTP status the route should answer with. */
export class SshError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Keeps SSH non-interactive: never prompt, stay quiet, fail fast. `-T` and `RequestTTY=no` keep a pty
 * off the MSP stream even when the user's config says `RequestTTY force`; the keepalives let a host
 * whose network went away (a sleeping laptop, a dropped VPN) die within about 45 seconds.
 */
export const SSH_OPTS = [
  "-T",
  "-o",
  "BatchMode=yes",
  "-o",
  "LogLevel=ERROR",
  "-o",
  "ConnectTimeout=10",
  "-o",
  "RequestTTY=no",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=3",
];

/** How long one short `ssh` command (a listing, a `$HOME` lookup) may take. */
export const SSH_RUN_TIMEOUT_MS = 30_000;

/** What one short `ssh` command returned. */
export interface SshRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** `ssh` itself could not be started: not installed, or not on PATH. */
  missing: boolean;
}

/** Runs `ssh` with these arguments, writing `input` to its stdin. */
export type SshRunFn = (args: string[], input?: string) => Promise<SshRunResult>;

/** The real `ssh` runner. Never rejects: a failure to start comes back as `missing`. */
export const defaultSshRun: SshRunFn = (args, input) =>
  new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn("ssh", args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, SSH_RUN_TIMEOUT_MS);
    const finish = (result: SshRunResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise(result);
      }
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error: NodeJS.ErrnoException) =>
      finish({ stdout, stderr: stderr || error.message, exitCode: 127, missing: error.code === "ENOENT" }),
    );
    child.on("close", (code) =>
      finish({
        stdout,
        stderr: timedOut ? `ssh did not finish within ${SSH_RUN_TIMEOUT_MS / 1000} seconds.` : stderr,
        exitCode: code ?? 255,
        missing: false,
      }),
    );
    // ssh may exit before it reads its input (an unreachable host); that is reported through `close`.
    child.stdin.on("error", () => undefined);
    child.stdin.end(input ?? "");
  });

/** The last non-empty line ssh wrote to stderr, without a trailing period. */
function lastErrorLine(stderr: string): string {
  const lines = stripAnsiCodes(stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines[lines.length - 1] ?? "").replace(/\.$/, "");
}

/**
 * The error for an `ssh` command that did not get its answer back, in words that say what to fix:
 * a missing `ssh` binary, an unknown or changed host key, a login that needs a password, or
 * whatever ssh itself reported.
 */
export function sshFailure(host: string, result: SshRunResult, action: string): SshError {
  if (result.missing) {
    return new SshError(502, "Could not find ssh on this machine. Install OpenSSH, or add it to PATH, and try again.");
  }
  const detail = lastErrorLine(result.stderr);
  const said = detail ? `: ${detail}.` : ` (ssh exited with code ${result.exitCode}).`;
  if (/host key verification failed|remote host identification has changed|no matching host key/i.test(result.stderr)) {
    return new SshError(502, `Could not ${action} "${host}"${said} Run \`ssh ${host}\` once in a terminal to check and accept its host key.`);
  }
  if (/permission denied/i.test(result.stderr)) {
    return new SshError(502, `Could not ${action} "${host}"${said} Muse Code GUI needs \`ssh ${host}\` to work without a password, through a key or an agent.`);
  }
  return new SshError(502, `Could not ${action} "${host}" over SSH${said} Check that \`ssh ${host}\` works without a password.`);
}

/** How long a remote `$HOME` answer is trusted. */
export const SSH_HOME_CACHE_MS = 60_000;

/** `ssh://host/absolute/path`. `remotePath` is absolute and never uses `~`. */
export interface SshProject {
  host: string;
  remotePath: string;
}

/**
 * The username must not start with a hyphen: `-Elog@h` would otherwise reach
 * OpenSSH as the `-E` option (CWE-88 argument injection), and `"--"` below is
 * only the second line of defense. Mirrored in the UI picker's `parseSshHost`.
 */
const HOST_PATTERN = /^(?:([A-Za-z0-9_][A-Za-z0-9_.-]*)@)?([A-Za-z0-9_.-]+)$/;

/**
 * A validated SSH host (`hostname` or `user@hostname`) with its host part
 * lowercased, or null. Mirrors `parseSshHost` in the UI picker's paths module;
 * keep the two in sync. Strict argv plus this charset is what stops a typed
 * hostname from becoming an ssh option or a shell escape.
 */
export function validateSshHost(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 255) {
    return null;
  }
  const match = HOST_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const host = (match[2] as string).toLowerCase();
  if (/^[.-]|[.-]$/.test(host) || host.includes("..")) {
    return null;
  }
  return match[1] ? `${match[1]}@${host}` : host;
}

/** Whether a path names a folder on an SSH host. */
export function isSshCwd(value: string): boolean {
  return value.trim().startsWith("ssh://");
}

/** Splits `ssh://host/path`; the path may still be `~`-relative or relative. Null when malformed. */
export function parseSshProject(value: string): SshProject | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("ssh://")) {
    return null;
  }
  const rest = trimmed.slice("ssh://".length);
  const slash = rest.indexOf("/");
  const host = validateSshHost(slash < 0 ? rest : rest.slice(0, slash));
  if (!host) {
    return null;
  }
  return { host, remotePath: slash < 0 ? "/" : rest.slice(slash) };
}

/**
 * The stored form of an SSH project: lowercased host, absolute normalized
 * path, no trailing slash except the root. `~` is rejected here: it is
 * expanded to an absolute path at creation time, so stored keys never depend
 * on a remote `$HOME` lookup. Null when malformed.
 */
export function normalizeSshCwd(value: string): string | null {
  const parsed = parseSshProject(value);
  if (!parsed) {
    return null;
  }
  const raw = parsed.remotePath;
  // `~` forms need a remote `$HOME` lookup, so they only resolve at creation and listing time, never in a stored key.
  if (needsSshHome(raw) || !raw.startsWith("/")) {
    return null;
  }
  const normal = posix.normalize(raw);
  if (!normal.startsWith("/")) {
    return null;
  }
  return `ssh://${parsed.host}${normal === "/" ? "/" : normal.replace(/\/+$/, "")}`;
}

/** The parent of a normalized SSH path, or null at the host root. Null when malformed. */
export function sshParent(normalized: string): string | null {
  const parsed = parseSshProject(normalized);
  if (!parsed || parsed.remotePath === "/") {
    return null;
  }
  const dir = posix.dirname(parsed.remotePath);
  return `ssh://${parsed.host}${dir === "/" ? "/" : dir}`;
}

/** Whether a remote path needs the remote home to resolve: `~`, `~/x`, `/~` or `/~/x`. */
export function needsSshHome(remotePath: string): boolean {
  return /^\/?~(?=\/|$)/.test(remotePath);
}

/**
 * Resolves a remote path the user typed against the remote home: `~` forms
 * expand with the given home, absolute paths normalize. Throws SshError.
 */
export function resolveSshPath(host: string, input: string, home: string | null): string {
  if (needsSshHome(input)) {
    if (!home || !home.startsWith("/")) {
      throw new SshError(502, `Could not read the home folder on "${host}" over SSH.`);
    }
    const rest = input.replace(/^\/?~/, "");
    const joined = rest ? posix.join(home, rest) : home;
    return joined.length > 1 ? joined.replace(/\/+$/, "") : joined;
  }
  if (!input.startsWith("/")) {
    throw new SshError(400, "SSH folders look like ssh://host/absolute/path.");
  }
  const normal = posix.normalize(input);
  if (!normal.startsWith("/")) {
    throw new SshError(400, "SSH folders look like ssh://host/absolute/path.");
  }
  return normal.length > 1 ? normal.replace(/\/+$/, "") : normal;
}

/** `ssh` argv for running one remote command, as a single shell string. No shell quoting happens locally. */
export function sshArgv(host: string, remoteCommand: string): string[] {
  // "--" ends option processing: a validated host never starts with `-`, and this keeps it that way by construction.
  return [...SSH_OPTS, "--", host, remoteCommand];
}

/**
 * `ssh` argv whose remote end is the agent, started inside the project folder:
 * `ssh [opts] -- host 'cd <path> && exec muse serve ...'`. Starting there keeps anything Muse
 * scopes to its working directory (workspace trust, the sandbox root) on the project, not `$HOME`.
 * `muse` resolves on the remote PATH: the local `--muse` path names a local binary.
 */
export function sshServeArgs(host: string, remotePath: string, serveArgs: string[]): string[] {
  return [...SSH_OPTS, "--", host, `cd ${shellQuote(remotePath)} && exec muse ${serveArgs.join(" ")}`];
}

/** Single-quotes a value for a remote POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const NOENT = "__musegui_noent__";
const NOTDIR = "__musegui_notdir__";
const BEGIN = "__musegui_begin__";
const END = "__musegui_end__";

/**
 * The remote command for every short script: `sh -s` reads the script from stdin. The login shell
 * only ever parses `sh -s`, so csh's `!` history expansion and fish's quoting rules never touch
 * a path, and the script itself always runs under POSIX `sh`.
 */
export const REMOTE_SCRIPT_COMMAND = "sh -s";

/** Wraps a script's output in markers, so rc-file noise printed around it is never mistaken for it. */
export function framedScript(body: string): string {
  return `printf '%s\\n' ${BEGIN}\n${body}\nprintf '\\n%s\\n' ${END}\n`;
}

/** The output between the markers, or null when the script never ran to its end. */
export function extractFramed(stdout: string): string | null {
  const text = stripAnsiCodes(stdout).replace(/\r\n/g, "\n");
  const begin = text.indexOf(`${BEGIN}\n`);
  const end = text.lastIndexOf(`\n${END}`);
  if (begin < 0 || end < begin + BEGIN.length) {
    return null;
  }
  return text.slice(begin + BEGIN.length + 1, end);
}

/**
 * The script listing a folder's subfolders, reporting missing ones with a sentinel. It travels on
 * stdin (see REMOTE_SCRIPT_COMMAND). `command` bypasses aliases and shell functions, so an `ls`
 * alias from a remote rc file (colorize flags, exa wrappers) cannot change the output shape. `-A`
 * keeps hidden folders, matching the local picker's `readdir` behavior.
 */
export function remoteListScript(absPath: string): string {
  return framedScript(
    `p=${shellQuote(absPath)}\nif [ -d "$p" ]; then command ls -1 -p -A -- "$p" 2>/dev/null || true; elif [ -e "$p" ]; then printf '%s\\n' ${NOTDIR}; else printf '%s\\n' ${NOENT}; fi`,
  );
}

/** The script printing the remote `$HOME`. */
export const REMOTE_HOME_SCRIPT = framedScript(`printf '%s\\n' "$HOME"`);

/** Strips ANSI color sequences, so a colorized `ls` from any source still parses. */
export function stripAnsiCodes(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Parses the listing script's stdout: sentinels mean missing, otherwise `/`-suffixed lines are folders. */
export function parseSshLs(stdout: string): { exists: boolean; entries: { name: string }[] } {
  const text = stripAnsiCodes(stdout).replace(/\r\n/g, "\n").trim();
  if (text === NOENT || text === NOTDIR) {
    return { exists: false, entries: [] };
  }
  if (!text) {
    // An unreadable folder lists as empty, matching the local picker's EACCES behavior.
    return { exists: true, entries: [] };
  }
  const entries: { name: string }[] = [];
  for (const line of text.split("\n")) {
    if (!line.endsWith("/")) {
      continue;
    }
    const name = line.slice(0, -1);
    if (!name || name === "." || name === "..") {
      continue;
    }
    entries.push({ name });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  return { exists: true, entries };
}

/**
 * Lists a remote folder's subfolders over SSH. Throws SshError (502, with ssh's own reason) when
 * the script did not run to its end marker; the sentinel parse decides missing vs. present.
 */
export async function listSshDirectory(host: string, absPath: string, run: SshRunFn): Promise<{ exists: boolean; entries: { name: string }[] }> {
  const result = await run(sshArgv(host, REMOTE_SCRIPT_COMMAND), remoteListScript(absPath));
  const body = extractFramed(result.stdout);
  if (body === null) {
    throw sshFailure(host, result, "list folders on");
  }
  return parseSshLs(body);
}

/** The remote `$HOME` on an SSH host. Throws SshError when the host cannot be reached. */
export async function readSshHome(host: string, run: SshRunFn): Promise<string> {
  const result = await run(sshArgv(host, REMOTE_SCRIPT_COMMAND), REMOTE_HOME_SCRIPT);
  const body = extractFramed(result.stdout);
  if (body === null) {
    throw sshFailure(host, result, "reach");
  }
  const home = body.trim();
  if (!home.startsWith("/")) {
    throw new SshError(502, `Could not read the home folder on "${host}" over SSH.`);
  }
  return home;
}

/**
 * The stored project root for a session Muse reports during discovery.
 * A remote host reports a bare absolute path; when the discovery ran for an
 * SSH project, that path belongs to the remote host and is re-keyed onto it
 * instead of becoming a bogus local project. Anything else passes through,
 * preserving the local `reported ?? cwd ?? ""` behavior.
 */
export function discoveredProjectRoot(cwd: string | undefined, reported: string | null | undefined): string {
  if (cwd) {
    const parsed = parseSshProject(cwd);
    if (parsed && reported && reported.startsWith("/")) {
      return `ssh://${parsed.host}${reported}`;
    }
  }
  return reported ?? cwd ?? "";
}

/** The full picker listing for a normalized `ssh://host/abs/path` directory. */
export function sshDirectoryListing(host: string, absPath: string, listed: { exists: boolean; entries: { name: string }[] }): DirectoryListing {
  return {
    directory: `ssh://${host}${absPath}`,
    parent: absPath === "/" ? null : `ssh://${host}${posix.dirname(absPath) === "/" ? "/" : posix.dirname(absPath)}`,
    separator: "/",
    exists: listed.exists,
    entries: listed.entries,
  };
}
