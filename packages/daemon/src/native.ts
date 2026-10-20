import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { win32 } from "node:path";

/** Where Muse's launcher and its downloaded binaries live on Windows, and which binary is current. */
export interface NativeMuse {
  /** The real `muse-bin-<version>.exe`, run directly so arguments and stdio pass through untouched. */
  binary: string;
  /** The install folder holding `.muse-version` and the launcher. */
  dir: string;
  version: string | null;
  /** `.muse-launcher.ps1`, which updates Muse; null for a bare `muse.exe` on PATH. */
  launcher: string | null;
}

/** How Muse runs: straight on the OS, as native Windows Muse, or inside WSL. */
export type MuseRuntime = "posix" | "native" | "wsl";

/** Which Windows runtime to use when both could work. `auto` prefers native Muse once it is installed. */
export type RuntimePreference = "auto" | "native" | "wsl";

export interface FileProbe {
  exists(path: string): boolean;
  read(path: string): string | null;
}

const realFiles: FileProbe = {
  exists: (path) => existsSync(path),
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
};

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+-R[0-9]+(\.[0-9]+)?$/;

/** The folder the PowerShell installer (`irm https://dev.meta.ai/install.ps1 | iex`) put Muse in, as its launcher reads it. */
function activeInstall(dir: string, files: FileProbe): NativeMuse | null {
  const version = files.read(win32.join(dir, ".muse-version"))?.trim() ?? "";
  if (!VERSION.test(version)) {
    return null;
  }
  const binary = win32.join(dir, `muse-bin-${version}.exe`);
  if (!files.exists(binary)) {
    return null;
  }
  const launcher = win32.join(dir, ".muse-launcher.ps1");
  return { binary, dir, version, launcher: files.exists(launcher) ? launcher : null };
}

/**
 * Finds native Windows Muse: the installer's folder (`MUSE_INSTALL_DIR`, else `%LOCALAPPDATA%\Programs\muse`), then
 * any install folder or `muse.exe` on PATH. Null when Muse is not installed for Windows itself.
 */
export function findNativeMuse(env: NodeJS.ProcessEnv = process.env, files: FileProbe = realFiles): NativeMuse | null {
  const dirs: string[] = [];
  const configured = env["MUSE_INSTALL_DIR"]?.trim();
  if (configured) {
    dirs.push(configured);
  }
  const local = env["LOCALAPPDATA"]?.trim();
  if (local) {
    dirs.push(win32.join(local, "Programs", "muse"));
  }
  const pathDirs = (env["Path"] ?? env["PATH"] ?? "").split(";").map((d) => d.trim()).filter(Boolean);
  for (const dir of [...dirs, ...pathDirs]) {
    const found = activeInstall(dir, files);
    if (found) {
      return found;
    }
  }
  for (const dir of pathDirs) {
    const binary = win32.join(dir, "muse.exe");
    if (files.exists(binary)) {
      return { binary, dir, version: null, launcher: null };
    }
  }
  return null;
}

/** What the launcher would put in `MUSE_RELEASE_INFO` for the active binary, so Muse sees the same release details. */
export function nativeReleaseInfo(muse: NativeMuse, files: FileProbe = realFiles): string | null {
  if (!muse.version) {
    return null;
  }
  const content = files.read(win32.join(muse.dir, ".muse-release-info.json"));
  if (!content) {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as { version?: unknown };
    return parsed.version === muse.version ? content : null;
  } catch {
    return null;
  }
}

const UPDATE_INTERVAL_S = 3600;

/**
 * Muse Code GUI runs Muse's binary directly, which skips the launcher's hourly update check. This starts that check the
 * way the launcher does, hidden and in the background, when the hour has passed. A new binary is used from the next
 * `muse serve`. Never throws.
 */
export function refreshNativeMuse(muse: NativeMuse, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!muse.launcher || env["MUSE_NO_AUTO_UPDATE"] === "1") {
    return false;
  }
  try {
    const stamp = win32.join(muse.dir, ".muse-update-checked-at");
    const now = Math.floor(Date.now() / 1000);
    const previous = Number.parseInt(realFiles.read(stamp)?.trim() ?? "", 10);
    if (Number.isFinite(previous) && now - previous < UPDATE_INTERVAL_S) {
      return false;
    }
    writeFileSync(stamp, `${now}\n`);
    const powershell = win32.join(env["SystemRoot"] ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = spawn(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", muse.launcher], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      // A PSModulePath inherited from PowerShell 7 hides Windows PowerShell's own modules, and the update needs them.
      env: { ...env, PSModulePath: undefined, MUSE_INTERNAL_UPDATE: "1", MUSE_LOGIN: "0" },
    });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Parses `--runtime` / `MUSEGUI_MUSE_RUNTIME`. Anything unrecognised means `auto`. */
export function parseRuntimePreference(value: string | null | undefined): RuntimePreference {
  const lower = value?.trim().toLowerCase();
  return lower === "native" || lower === "windows" ? "native" : lower === "wsl" ? "wsl" : "auto";
}
