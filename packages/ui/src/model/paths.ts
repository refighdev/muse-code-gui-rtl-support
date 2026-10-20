/**
 * Path helpers for the add-project picker. They work on the text the user typed, so they
 * understand Windows paths, WSL paths and `~` alike; the server resolves what the text means.
 */

export interface BrowsePath {
  /** Everything up to and including the last separator: the folder being listed. Empty when there is none. */
  directory: string;
  /** The text after the last separator, which filters that folder's subfolders by prefix. */
  leaf: string;
  /** The separator style the user is typing with. */
  separator: "/" | "\\";
}

export function splitBrowsePath(input: string): BrowsePath {
  const index = Math.max(input.lastIndexOf("/"), input.lastIndexOf("\\"));
  if (index < 0) {
    return { directory: "", leaf: input, separator: "/" };
  }
  return { directory: input.slice(0, index + 1), leaf: input.slice(index + 1), separator: input[index] === "\\" ? "\\" : "/" };
}

/** Whether the text is a full path the server can list: `~/`, `/`, `C:\`, a network share, or `ssh://host/`. */
export function isFullPath(input: string): boolean {
  return /^(~[\\/]|\/|ssh:\/\/|[A-Za-z]:[\\/]|\\\\)/.test(input);
}

/** Whether a path names a folder on an SSH host. */
export function isSshPath(path: string): boolean {
  return path.startsWith("ssh://");
}

/**
 * An SSH host as the picker accepts it: `hostname` or `user@hostname`, with
 * the host part lowercased. Null when invalid. Mirrors `validateSshHost` in
 * the server's ssh module; keep the two in sync.
 */
export function parseSshHost(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 255) {
    return null;
  }
  const match = /^(?:([A-Za-z0-9_][A-Za-z0-9_.-]*)@)?([A-Za-z0-9_.-]+)$/.exec(value);
  if (!match) {
    return null;
  }
  const host = (match[2] as string).toLowerCase();
  if (/^[.-]|[.-]$/.test(host) || host.includes("..")) {
    return null;
  }
  return match[1] ? `${match[1]}@${host}` : host;
}

export function withTrailingSeparator(path: string, separator: string): string {
  return /[\\/]$/.test(path) ? path : `${path}${separator}`;
}

/** The folder that holds `path`, ending in a separator: `D:\Projects\app` gives `D:\Projects\`. */
export function parentFolder(path: string): string | null {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(0, index + 1) : null;
}

/** Whether two paths name the same folder, ignoring separator style, trailing separators and drive-path case. */
export function sameFolder(a: string, b: string): boolean {
  const canonical = (path: string) => {
    const unified = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[A-Za-z]:/.test(unified) ? unified.toLowerCase() : unified;
  };
  return canonical(a) === canonical(b);
}

/** A clone URL from what was typed: an HTTPS or SSH Git URL, or GitHub `owner/repo` shorthand. */
export function cloneUrl(input: string): string | null {
  const value = input.trim();
  const shorthand = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(value);
  if (shorthand) {
    return `https://github.com/${shorthand[1]}/${shorthand[2]}.git`;
  }
  if (/^(https?:\/\/|ssh:\/\/|git:\/\/)\S+$/.test(value) || /^git@[^\s:]+:\S+$/.test(value)) {
    return value;
  }
  return null;
}

/** The folder a clone lands in: the URL's last segment without `.git`. */
export function repoName(url: string): string {
  const cleaned = url.trim().replace(/[\\/]+$/, "").replace(/\.git$/, "");
  const parts = cleaned.split(/[\\/:]/);
  return parts[parts.length - 1] || "repository";
}
