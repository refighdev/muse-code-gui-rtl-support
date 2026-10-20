import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, lstat, open, readdir, readFile, realpath, rename, stat, writeFile, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

/** A failure the HTTP layer turns into a status; `kind` lets the UI tell "changed on disk" apart from the rest. */
export class FileError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly kind: string | null = null,
  ) {
    super(message);
  }
}

export type FileKind = "text" | "markdown" | "image" | "video" | "audio" | "pdf" | "binary";

export interface FileEntry {
  name: string;
  /** Relative to the project root, with forward slashes. */
  path: string;
  kind: "dir" | "file";
  size: number;
  mtimeMs: number;
}

export interface FileListing {
  path: string;
  entries: FileEntry[];
  /** The folder held more entries than a listing returns. */
  truncated: boolean;
}

export interface FileRead {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
  kind: FileKind;
  mediaType: string;
  /** Present for text and markdown. */
  content?: string;
  /** Text too large to send whole; `content` is its start. */
  truncated: boolean;
}

/** More than a person scrolls through in a tree; a folder past this is almost always generated. */
const MAX_ENTRIES = 5000;
/** Text sent to the viewer at once. A bigger file shows its start and says so. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** What an edit may write back. */
const MAX_WRITE_BYTES = 5 * 1024 * 1024;
/** Folders a filename search never walks into: they are large, generated, and not what anyone means. */
const SEARCH_SKIP = new Set([".git", "node_modules", ".next", "dist", "build", "target", ".venv", "venv", "__pycache__", ".turbo", ".cache"]);

const IMAGE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};
const VIDEO: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".ogv": "video/ogg",
};
const AUDIO: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
};
const MARKDOWN = new Set([".md", ".markdown", ".mdx", ".mdown"]);

/** What a file is, from its extension first and then from whether its first bytes look like text. */
export function classifyFile(name: string, head: Uint8Array): { kind: FileKind; mediaType: string } {
  const ext = extname(name).toLowerCase();
  if (IMAGE[ext]) {
    return { kind: "image", mediaType: IMAGE[ext] };
  }
  if (VIDEO[ext]) {
    return { kind: "video", mediaType: VIDEO[ext] };
  }
  if (AUDIO[ext]) {
    return { kind: "audio", mediaType: AUDIO[ext] };
  }
  if (ext === ".pdf") {
    return { kind: "pdf", mediaType: "application/pdf" };
  }
  if (MARKDOWN.has(ext)) {
    return { kind: "markdown", mediaType: "text/markdown" };
  }
  // A NUL byte in the first chunk is the classic tell of a binary file.
  return head.includes(0) ? { kind: "binary", mediaType: "application/octet-stream" } : { kind: "text", mediaType: "text/plain" };
}

/** Forward slashes, no leading `./` or `/`. */
function toRelative(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

/**
 * Resolves a path the UI asked for inside a project and refuses anything that lands outside it, including through
 * a symlink. `requested` is relative to the project, or absolute in the project's own style (`displayRoot`), which is
 * how an agent's message names files.
 */
export async function resolveInRoot(
  root: string,
  requested: string,
  displayRoot: string,
  options: { mustExist?: boolean } = {},
): Promise<{ abs: string; rel: string }> {
  let value = requested.trim().replace(/\\/g, "/");
  const display = displayRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (display && (value === display || value.startsWith(`${display}/`))) {
    value = value.slice(display.length);
  }
  value = value.replace(/^\/+/, "").replace(/^\.\//, "");
  if (/^[A-Za-z]:\//.test(value) || value.split("/").includes("..")) {
    throw new FileError(403, "That file is outside this project.");
  }
  const realRoot = await realpath(root).catch(() => {
    throw new FileError(404, "This project's folder is not there anymore.");
  });
  const abs = resolve(realRoot, ...value.split("/").filter(Boolean));
  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    if (options.mustExist === false) {
      return { abs, rel: toRelative(realRoot, abs) };
    }
    throw new FileError(404, "That file does not exist.");
  }
  if (real !== realRoot && !real.startsWith(realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`)) {
    throw new FileError(403, "That file is outside this project.");
  }
  return { abs: real, rel: toRelative(realRoot, real) };
}

/** One folder's entries: folders first, then files, each in natural name order. */
export async function listFolder(root: string, displayRoot: string, requested: string): Promise<FileListing> {
  const { abs, rel } = await resolveInRoot(root, requested || ".", displayRoot);
  const info = await stat(abs);
  if (!info.isDirectory()) {
    throw new FileError(400, "That is a file, not a folder.");
  }
  const names = await readdir(abs);
  const entries: FileEntry[] = [];
  for (const name of names.slice(0, MAX_ENTRIES)) {
    const child = join(abs, name);
    // A broken symlink or a file removed mid-listing is left out rather than failing the folder.
    const entry = await stat(child).catch(() => null);
    if (!entry) {
      continue;
    }
    entries.push({
      name,
      path: rel ? `${rel}/${name}` : name,
      kind: entry.isDirectory() ? "dir" : "file",
      size: entry.isDirectory() ? 0 : entry.size,
      mtimeMs: Math.round(entry.mtimeMs),
    });
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  entries.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === "dir" ? -1 : 1));
  return { path: rel, entries, truncated: names.length > MAX_ENTRIES };
}

/** A file's content for the viewer: text comes inline, media is served separately and only described here. */
export async function readProjectFile(root: string, displayRoot: string, requested: string): Promise<FileRead> {
  const { abs, rel } = await resolveInRoot(root, requested, displayRoot);
  const info = await stat(abs);
  if (info.isDirectory()) {
    throw new FileError(400, "That is a folder, not a file.");
  }
  const handle = await open(abs, "r");
  try {
    const headSize = Math.min(info.size, 8192);
    const head = new Uint8Array(headSize);
    await handle.read(head, 0, headSize, 0);
    const { kind, mediaType } = classifyFile(basename(abs), head);
    const base = { path: rel, name: basename(abs), size: info.size, mtimeMs: Math.round(info.mtimeMs), kind, mediaType, truncated: false };
    if (kind !== "text" && kind !== "markdown") {
      return base;
    }
    const length = Math.min(info.size, MAX_TEXT_BYTES);
    const bytes = Buffer.alloc(length);
    await handle.read(bytes, 0, length, 0);
    return { ...base, content: bytes.toString("utf8"), truncated: info.size > MAX_TEXT_BYTES };
  } finally {
    await handle.close();
  }
}

/**
 * Saves an edit. `baseMtimeMs` is when the file was read: if it changed on disk since, nothing is written and the
 * caller hears `fileChanged`, so an agent's edit is never silently overwritten. Written to a sibling file and renamed
 * into place, so a crash mid-write cannot leave half a file.
 */
export async function writeProjectFile(
  root: string,
  displayRoot: string,
  requested: string,
  content: string,
  baseMtimeMs: number | null,
): Promise<{ path: string; size: number; mtimeMs: number }> {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > MAX_WRITE_BYTES) {
    throw new FileError(413, "That file is too large to save from here.");
  }
  const { abs, rel } = await resolveInRoot(root, requested, displayRoot);
  const info = await lstat(abs);
  if (!info.isFile()) {
    throw new FileError(400, "Only a regular file can be saved.");
  }
  if (baseMtimeMs !== null && Math.round(info.mtimeMs) !== baseMtimeMs) {
    throw new FileError(409, "This file changed on disk since you opened it.", "fileChanged");
  }
  const temp = join(abs, `..`, `.${basename(abs)}.musegui-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(temp, bytes, { mode: info.mode & 0o7777 });
    await chmod(temp, info.mode & 0o7777);
    await rename(temp, abs);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  const saved = await stat(abs);
  return { path: rel, size: saved.size, mtimeMs: Math.round(saved.mtimeMs) };
}

const execFileAsync = promisify(execFile);

/** One change to take back: `after` goes back to `before`, or, when `before` is null, the file `after` created goes away. */
export interface RevertStep {
  before: string | null;
  after: string;
  /** For a whole-file write: when the call ran (epoch ms), so a file that already existed then is never deleted. */
  at?: number;
}

/**
 * True only when git positively says the file is neither tracked nor ignored; not a repository, or any doubt, reads
 * as "not new". An ignored file (.env.local, notes) is the user's own, so it never counts.
 */
async function untrackedInGit(root: string, rel: string): Promise<boolean> {
  const git = (args: string[]) => execFileAsync("git", args, { cwd: root, timeout: 10_000 });
  try {
    await git(["check-ignore", "-q", "--", rel]);
    return false;
  } catch (error) {
    if ((error as { code?: unknown }).code !== 1) {
      return false;
    }
  }
  try {
    await git(["--literal-pathspecs", "ls-files", "--error-unmatch", "--", rel]);
    return false;
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: unknown };
    return failure.code === 1 && /did not match/.test(String(failure.stderr ?? ""));
  }
}

/** Where `needle` sits in `content`, tried as written and then with the file's CRLF line endings. Null unless exactly one place. */
function uniqueSpot(content: string, needle: string): { at: number; text: string } | null {
  const forms = content.includes("\r\n") && !needle.includes("\r\n") ? [needle, needle.replace(/\r?\n/g, "\r\n")] : [needle];
  for (const text of forms) {
    if (text === "") {
      continue;
    }
    const first = content.indexOf(text);
    if (first !== -1 && content.indexOf(text, first + text.length) === -1) {
      return { at: first, text };
    }
  }
  return null;
}

/**
 * Takes back what a thread's edit tool calls did to one file. `steps` run latest first. The file is left
 * alone unless every step lands: each swap needs the text it wrote to still be there exactly once, so a
 * file someone edited since is reported as a conflict instead of being guessed at. A file the thread created
 * is deleted only when git confirms it is untracked and it still holds exactly what was written.
 */
export async function revertProjectFile(
  root: string,
  displayRoot: string,
  requested: string,
  steps: RevertStep[],
): Promise<{ path: string; outcome: "reverted" | "deleted" }> {
  if (steps.length === 0) {
    throw new FileError(400, "Nothing to undo.");
  }
  const { abs, rel } = await resolveInRoot(root, requested, displayRoot);
  const info = await lstat(abs).catch((error: unknown) => {
    if ((error as { code?: unknown }).code === "ENOENT") {
      throw new FileError(409, `${rel}: the file is gone, so there is nothing to undo.`, "revertConflict");
    }
    throw error;
  });
  if (!info.isFile()) {
    throw new FileError(400, "Only a regular file can be undone.");
  }
  if (info.size > MAX_WRITE_BYTES) {
    throw new FileError(413, "That file is too large to undo from here.");
  }
  const conflict = (why: string) => new FileError(409, `${rel}: ${why}`, "revertConflict");
  const raw = await readFile(abs);
  let content = raw.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(raw)) {
    throw conflict("the file is not valid UTF-8, so it cannot be edited safely from here.");
  }
  let deletes = false;
  for (const [index, step] of steps.entries()) {
    if (step.before === null) {
      if (index !== steps.length - 1) {
        throw conflict("this thread wrote the whole file more than once, so the original is not recoverable.");
      }
      const written = content === step.after || content === step.after.replace(/\n/g, "\r\n");
      if (!written) {
        throw conflict("the file no longer matches what the thread wrote.");
      }
      const createdByThread = step.at !== undefined && info.birthtimeMs > 0 && info.birthtimeMs >= step.at - 5000;
      if (!createdByThread || !(await untrackedInGit(root, rel))) {
        throw conflict("this thread wrote the whole file, and Muse Code GUI cannot tell it was new here. Restore it with git.");
      }
      deletes = true;
      break;
    }
    const spot = uniqueSpot(content, step.after);
    if (!spot) {
      throw conflict("the text this thread wrote is gone, changed, or appears more than once.");
    }
    const crlf = spot.text !== step.after;
    const restored = crlf ? step.before.replace(/\r?\n/g, "\r\n") : step.before;
    content = `${content.slice(0, spot.at)}${restored}${content.slice(spot.at + spot.text.length)}`;
  }
  if (deletes) {
    await unlink(abs);
    return { path: rel, outcome: "deleted" };
  }
  const now = await lstat(abs);
  if (now.mtimeMs !== info.mtimeMs || now.size !== info.size) {
    throw conflict("the file changed while it was being undone. Nothing was written.");
  }
  const temp = join(abs, "..", `.${basename(abs)}.musegui-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(temp, Buffer.from(content, "utf8"), { mode: info.mode & 0o7777 });
    await chmod(temp, info.mode & 0o7777);
    await rename(temp, abs);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return { path: rel, outcome: "reverted" };
}

/** Files whose path contains every word of `query`, breadth first, skipping heavy generated folders. */
export async function searchProjectFiles(root: string, query: string, limit = 60): Promise<FileEntry[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const realRoot = await realpath(root).catch(() => {
    throw new FileError(404, "This project's folder is not there anymore.");
  });
  const found: FileEntry[] = [];
  const queue: string[] = [realRoot];
  let visited = 0;
  while (queue.length > 0 && found.length < limit && visited < 20_000) {
    const dir = queue.shift() as string;
    const names = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const dirent of names) {
      visited += 1;
      const abs = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (!SEARCH_SKIP.has(dirent.name)) {
          queue.push(abs);
        }
        continue;
      }
      if (!dirent.isFile()) {
        continue;
      }
      const rel = toRelative(realRoot, abs);
      const haystack = rel.toLowerCase();
      if (words.every((word) => haystack.includes(word))) {
        const info = await stat(abs).catch(() => null);
        found.push({ name: dirent.name, path: rel, kind: "file", size: info?.size ?? 0, mtimeMs: Math.round(info?.mtimeMs ?? 0) });
        if (found.length >= limit) {
          break;
        }
      }
    }
  }
  // Closest matches first: a name hit beats a hit somewhere up the path, and shorter paths beat deeper ones.
  const last = words[words.length - 1] as string;
  return found.sort((a, b) => Number(!a.name.toLowerCase().includes(last)) - Number(!b.name.toLowerCase().includes(last)) || a.path.length - b.path.length);
}

/**
 * Serves a project file's bytes for `<img>`, `<video>` and PDF frames, with byte ranges so video can seek. Nothing
 * served here may run as a page on this origin, which holds the daemon's token cookie: HTML goes out as plain text and
 * every response except a PDF carries a sandboxing CSP. A PDF is left unsandboxed because browsers refuse to show one
 * in a sandboxed document, and a PDF viewer does not run the file's script in this origin.
 */
export async function serveProjectFile(req: IncomingMessage, res: ServerResponse, root: string, displayRoot: string, requested: string): Promise<void> {
  const { abs } = await resolveInRoot(root, requested, displayRoot);
  const info = await stat(abs);
  if (!info.isFile()) {
    throw new FileError(400, "That is not a file.");
  }
  const head = new Uint8Array(Math.min(info.size, 8192));
  const handle = await open(abs, "r");
  try {
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }
  const { kind, mediaType } = classifyFile(basename(abs), head);
  const type = kind === "text" || kind === "markdown" ? "text/plain; charset=utf-8" : mediaType;
  const headers: Record<string, string> = {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "content-disposition": "inline",
  };
  if (kind !== "pdf") {
    headers["content-security-policy"] = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers["range"] ?? ""));
  if (range && info.size > 0 && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
    end = Math.min(end, info.size - 1);
    start = Math.min(start, end);
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${info.size}`, "content-length": String(end - start + 1) });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(abs, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, "content-length": String(info.size) });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(abs).pipe(res);
}
