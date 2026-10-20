import { mkdir, readdir } from "node:fs/promises";
import { posix, win32 } from "node:path";

/** How typed paths map onto this machine: where `~` points, the OS, and the WSL distro that owns Linux paths on Windows. */
export interface PathContext {
  platform: string;
  home: string;
  distro: string | null;
}

export interface ResolvedPath {
  /** The path this machine's filesystem opens. */
  local: string;
  /** The absolute path in the style the user works in: a Windows path, or a Linux path under WSL. */
  display: string;
  flavor: "windows" | "posix";
}

export interface DirectoryListing {
  /** The folder listed, as an absolute path in the user's style. */
  directory: string;
  parent: string | null;
  separator: "/" | "\\";
  exists: boolean;
  /** Subfolders only, sorted by name. */
  entries: { name: string }[];
}

/** A typed path that cannot be used here; the message says why. */
export class PathError extends Error {}

function trimTrailing(path: string): string {
  return path === "/" ? path : path.replace(/\/+$/, "");
}

export function resolveUserPath(input: string, ctx: PathContext): ResolvedPath {
  let value = input.trim();
  if (!value) {
    throw new PathError("Type a folder path.");
  }
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    value = ctx.home + value.slice(1);
  }
  if (ctx.platform === "win32") {
    if (/^[A-Za-z]:([\\/]|$)/.test(value) || value.startsWith("\\\\")) {
      const local = win32.resolve(/^[A-Za-z]:$/.test(value) ? `${value}\\` : value);
      return { local, display: local, flavor: "windows" };
    }
    if (value.startsWith("/")) {
      const display = trimTrailing(posix.normalize(value));
      const mount = /^\/mnt\/([A-Za-z])(\/.*)?$/.exec(display);
      if (mount) {
        const drive = (mount[1] as string).toUpperCase();
        return { local: win32.resolve(`${drive}:\\${(mount[2] ?? "").replace(/\//g, "\\")}`), display, flavor: "posix" };
      }
      if (!ctx.distro) {
        throw new PathError("Linux paths need WSL. Start WSL, or use a Windows path.");
      }
      return { local: `\\\\wsl.localhost\\${ctx.distro}${display.replace(/\//g, "\\")}`, display, flavor: "posix" };
    }
    throw new PathError("Use a full path, like D:\\Projects or ~/code.");
  }
  if (!value.startsWith("/")) {
    throw new PathError("Use a full path, like ~/code or /srv/app.");
  }
  const local = posix.resolve(value);
  return { local, display: local, flavor: "posix" };
}

/** The subfolders of a folder, for the add-project picker. A folder it may not read lists as empty. */
export async function listDirectory(input: string, ctx: PathContext): Promise<DirectoryListing> {
  const resolved = resolveUserPath(input, ctx);
  const path = resolved.flavor === "windows" ? win32 : posix;
  const parent = path.dirname(resolved.display);
  const base = {
    directory: resolved.display,
    parent: parent === resolved.display ? null : parent,
    separator: resolved.flavor === "windows" ? ("\\" as const) : ("/" as const),
  };
  try {
    const dirents = await readdir(resolved.local, { withFileTypes: true });
    const entries = dirents
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
    return { ...base, exists: true, entries };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return { ...base, exists: true, entries: [] };
    }
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { ...base, exists: false, entries: [] };
    }
    throw error;
  }
}

export async function createDirectory(input: string, ctx: PathContext): Promise<ResolvedPath> {
  const resolved = resolveUserPath(input, ctx);
  await mkdir(resolved.local, { recursive: true });
  return resolved;
}
