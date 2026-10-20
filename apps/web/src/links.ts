import { invoke } from "@tauri-apps/api/core";

/** A web or mail link that belongs outside Muse Code GUI: not the local server this page came from. */
export function externalHref(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") {
    return url.href;
  }
  if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin) {
    return url.href;
  }
  return null;
}

/**
 * In the desktop app, a plain click on a `target="_blank"` link never reaches the shell's new-window handler on
 * macOS, so nothing opens. Clicks on outside links go straight to the default browser instead.
 */
export function bindDesktopLinks(): void {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }
  document.addEventListener(
    "click",
    (event) => {
      if (event.button !== 0 || event.defaultPrevented) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      const href = anchor?.getAttribute("href");
      const target = href ? externalHref(href, window.location.origin) : null;
      if (!target) {
        return;
      }
      event.preventDefault();
      void invoke("plugin:opener|open_url", { url: target }).catch(() => undefined);
    },
    true,
  );
}
