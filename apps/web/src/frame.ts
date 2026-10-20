import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { WindowFrame } from "@musegui/ui";

declare global {
  interface Window {
    /** Set by the desktop shell before the page loads when the window has no native title bar. */
    __MUSEGUI_FRAME__?: string;
    /** Set by the desktop shell before the page loads when macOS traffic lights float over the UI. */
    __MUSEGUI_TITLEBAR__?: string;
  }
  interface WindowEventMap {
    "musegui-zoom": CustomEvent<number>;
    "musegui-zoom-step": CustomEvent<"in" | "out" | "reset">;
    "musegui-menu": CustomEvent<"new-thread" | "settings">;
  }
}

/** True on macOS, where the desktop shell overlays the traffic lights on the sidebar. */
export function titlebarOverlay(): boolean {
  return window.__MUSEGUI_TITLEBAR__ === "overlay";
}

/**
 * Desktop zoom must go through the webview, not CSS `zoom` on <html>: WKWebView then mis-places
 * every Radix `position: fixed` menu. No-op in a browser. Call once at startup.
 */
export function bindDesktopZoom(): void {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }
  const apply = (zoom: number) => {
    getCurrentWebview()
      .setZoom(zoom)
      .catch((error: unknown) => console.error("Muse Code GUI: webview zoom failed", error));
  };
  window.addEventListener("musegui-zoom", (event) => apply(event.detail));
  void listen<"in" | "out" | "reset">("musegui://zoom", (event) => {
    window.dispatchEvent(new CustomEvent("musegui-zoom-step", { detail: event.payload }));
  }).catch((error: unknown) => console.error("Muse Code GUI: zoom menu listen failed", error));
  // New Thread (Cmd+N) and Settings (Cmd+,) in the native menu bar, where macOS users and VoiceOver look for them.
  void listen<"new-thread" | "settings">("musegui://menu", (event) => {
    window.dispatchEvent(new CustomEvent("musegui-menu", { detail: event.payload }));
  }).catch((error: unknown) => console.error("Muse Code GUI: menu listen failed", error));
}

/** Window controls for the desktop shell's frameless window; undefined in a browser. */
export function desktopFrame(): WindowFrame | undefined {
  if (window.__MUSEGUI_FRAME__ !== "custom") {
    return undefined;
  }
  const win = getCurrentWindow();
  const run = (action: Promise<unknown>) => {
    action.catch((error: unknown) => console.error("Muse Code GUI: window control failed", error));
  };
  return {
    minimize: () => run(win.minimize()),
    toggleMaximize: () => run(win.toggleMaximize()),
    close: () => run(win.close()),
    startDragging: () => run(win.startDragging()),
    isMaximized: () => win.isMaximized(),
    onResized: (callback) => {
      const pending = win.onResized(() => callback());
      pending.catch((error: unknown) => console.error("Muse Code GUI: resize listener failed", error));
      return () => {
        pending.then(
          (unlisten) => unlisten(),
          () => undefined,
        );
      };
    },
  };
}
