import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Notifier, NotifyPermission } from "@musegui/ui";

function asPermission(value: string): NotifyPermission {
  return value === "granted" || value === "denied" ? value : "default";
}

/**
 * Notifications through the browser's own API. Every engine that matters supports it, and each is
 * particular about it: permission is only granted from a real press, and Safari additionally wants a
 * secure context. Nothing here ever asks by itself for that reason.
 */
function browserNotifier(): Notifier | undefined {
  if (typeof Notification === "undefined") {
    return undefined;
  }
  const read = (): NotifyPermission => asPermission(Notification.permission);
  return {
    permission: async () => read(),
    async request() {
      // Every browser refuses a second ask, and the answer is already known by then anyway.
      if (read() !== "default") {
        return read();
      }
      try {
        return asPermission(await Notification.requestPermission());
      } catch {
        return "denied";
      }
    },
    async show({ title, body, tag }) {
      // `tag` replaces an earlier notice about the same thread instead of stacking another one up.
      new Notification(title, { body, tag });
    },
  };
}

/**
 * The desktop shell's, through Tauri's notification plugin. A webview does not reliably carry the
 * browser API, so on the desktop this is the one that actually reaches the OS.
 */
function desktopNotifier(): Notifier {
  return {
    async permission() {
      try {
        return (await isPermissionGranted()) ? "granted" : "default";
      } catch {
        return "denied";
      }
    },
    async request() {
      try {
        return asPermission(await requestPermission());
      } catch {
        return "denied";
      }
    },
    async show({ title, body }) {
      // The plugin has no notion of replacing an earlier notice, so the manager's own repeat window
      // is the only thing keeping one thread from stacking up.
      sendNotification({ title, body });
    },
  };
}

/** Whichever of the two this shell actually has. */
export function appNotifier(): Notifier | undefined {
  return "__TAURI_INTERNALS__" in window ? desktopNotifier() : browserNotifier();
}
