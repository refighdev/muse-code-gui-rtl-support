import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { AppUpdater } from "@musegui/ui";

// The plugin waits forever by default, and a stalled download would hold every later update action behind it.
const CHECK_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

/** The desktop shell's updater, through Tauri's updater plugin; undefined in a browser. */
export function desktopUpdater(): AppUpdater | undefined {
  if (!("__TAURI_INTERNALS__" in window)) {
    return undefined;
  }
  let pending: Update | null = null;
  return {
    currentVersion: () => getVersion(),
    async check() {
      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      if (pending && pending !== update) {
        pending.close().catch(() => undefined);
      }
      pending = update;
      return update ? { version: update.version, notes: update.body?.trim() || null, date: update.date ?? null } : null;
    },
    async download(onProgress) {
      if (!pending) {
        throw new Error("There is no update to download.");
      }
      let total: number | null = null;
      let received = 0;
      await pending.download(
        (event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? null;
            onProgress(total ? 0 : null);
          } else if (event.event === "Progress") {
            received += event.data.chunkLength;
            onProgress(total ? Math.min(1, received / total) : null);
          } else {
            onProgress(1);
          }
        },
        { timeout: DOWNLOAD_TIMEOUT_MS },
      );
    },
    async install({ restart }) {
      if (!pending) {
        throw new Error("There is no downloaded update to install.");
      }
      await pending.install({ restartAfterInstall: restart });
    },
    relaunch: () => relaunch(),
    onClose(handler) {
      // The window waits for the handler, then closes; installing on Windows quits the app first.
      const unlisten = getCurrentWindow().onCloseRequested(async () => {
        await handler();
      });
      unlisten.catch((error: unknown) => console.error("Muse Code GUI: close listener failed", error));
      return () => {
        unlisten.then(
          (stop) => stop(),
          () => undefined,
        );
      };
    },
  };
}
