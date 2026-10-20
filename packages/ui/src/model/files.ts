/** A line or range an agent pointed at, like `app.ts:4` or `app.ts:4-9`. */
export interface LineRange {
  start: number;
  end: number;
}

export interface FileTarget {
  /** Relative to the project when it was inside it; otherwise as written, and the server decides. */
  path: string;
  line: LineRange | null;
}

const LINE_SUFFIX = /:(\d+)(?:[-:](\d+))?$/;
const HASH_LINE = /#L(\d+)(?:-L?(\d+))?$/;

function lineOf(start: string | undefined, end: string | undefined): LineRange | null {
  const from = start ? Number(start) : Number.NaN;
  if (!Number.isInteger(from) || from < 1) {
    return null;
  }
  const to = end ? Number(end) : from;
  return { start: from, end: Number.isInteger(to) && to >= from ? to : from };
}

/** Forward slashes, no trailing slash, so a Windows path and its `/mnt` twin compare the same way. */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** `abs` relative to `cwd` when it sits inside it, else null. Case-insensitive for Windows drive paths. */
export function relativeToProject(cwd: string, abs: string): string | null {
  const root = normalize(cwd);
  const path = normalize(abs);
  const windows = /^[A-Za-z]:\//.test(root);
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(path, root)) {
    return "";
  }
  const prefix = `${root}/`;
  return same(path.slice(0, prefix.length), prefix) ? path.slice(prefix.length) : null;
}

/**
 * What a link or path in a reply points at in the project, or null when it is not a file at all: web links, mail,
 * in-page anchors. Relative paths resolve against `baseDir`, the folder of the file the link sits in, if any.
 */
export function fileTarget(raw: string | null | undefined, cwd: string, baseDir = ""): FileTarget | null {
  if (!raw) {
    return null;
  }
  let value = raw.trim();
  if (!value || value.startsWith("#") || /^(?:https?|mailto|tel|data|javascript|vscode|cursor):/i.test(value)) {
    return null;
  }
  value = value.replace(/^file:\/\//i, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    /* a stray % stays as written */
  }
  let line: LineRange | null = null;
  const hash = HASH_LINE.exec(value);
  if (hash) {
    line = lineOf(hash[1], hash[2]);
    value = value.slice(0, hash.index);
  } else {
    const suffix = LINE_SUFFIX.exec(value);
    // `C:` alone is a drive, not a line: only strip a suffix that follows something path-like.
    if (suffix && suffix.index > 1) {
      line = lineOf(suffix[1], suffix[2]);
      value = value.slice(0, suffix.index);
    }
  }
  value = value.replace(/[?#].*$/, "");
  if (!value) {
    return null;
  }
  const absolute = value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
  if (absolute) {
    const inside = relativeToProject(cwd, value);
    return { path: inside ?? normalize(value), line };
  }
  const parts: string[] = normalize(baseDir) ? normalize(baseDir).split("/") : [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return { path: parts.join("/"), line };
}

/**
 * Inline code that names a file, like `src/app.ts`, `app.js:4-5` or `README.md`. Deliberately narrow: a word with a
 * short extension, or a path with a slash and an extension. Commands, identifiers and URLs stay plain code.
 */
export function looksLikeFilePath(text: string): boolean {
  const value = text.trim();
  if (value.length < 3 || value.length > 240 || /\s/.test(value) || /^[a-z]+:\/\//i.test(value)) {
    return false;
  }
  const bare = value.replace(LINE_SUFFIX, "");
  // A dotfile like `.env` or `.gitignore` is a file whatever it ends in.
  if (/^\.[A-Za-z0-9_-]+$/.test(bare)) {
    return true;
  }
  // `a.b()` and `obj.prop` are code; a file extension is letters and digits only, and short.
  if (!/\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(bare) || /[()<>{}=;,"'`$]/.test(bare)) {
    return false;
  }
  const ext = bare.slice(bare.lastIndexOf(".") + 1).toLowerCase();
  // Dotted identifiers like `process.env` or `this.state` end in words no project names a file with.
  return bare.includes("/") || KNOWN_EXTENSIONS.has(ext);
}

const KNOWN_EXTENSIONS = new Set(
  "md mdx markdown txt json jsonc yaml yml toml ini lock ts tsx js jsx mjs cjs py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh fish ps1 sql html htm css scss less vue svelte astro xml svg png jpg jpeg gif webp avif ico mp4 webm mov mp3 wav pdf csv tsv log liquid graphql gql proto dockerfile makefile gradle lua dart ex exs erl zig nim r jl scala clj tf hcl".split(" "),
);

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx|mdown)$/i.test(path);
}

/** The folder a project-relative path sits in; "" for the root. */
export function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function basenameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

/** Where an unsaved edit or a file's version is kept: one project and one path. */
export function fileKey(cwd: string, path: string): string {
  return `${cwd}\n${path}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
