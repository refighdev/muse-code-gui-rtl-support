import { useEffect, useState } from "react";

type Listener = (text: string) => void;
const listeners = new Set<Listener>();

/**
 * Says `text` through the app's one polite live region. Use it for changes a screen reader user would
 * want to hear without looking: a turn starting or ending, Muse asking for something, a plan step done.
 * Never for anything that ticks.
 */
export function announce(text: string): void {
  for (const listener of listeners) {
    listener(text);
  }
}

/** Sentences that arrive this close together are read as one announcement, so a burst is said once. */
const GATHER_MS = 600;

export function LiveAnnouncer() {
  const [text, setText] = useState("");
  useEffect(() => {
    let pending: string[] = [];
    let gather: number | null = null;
    let reveal: number | null = null;
    const flush = () => {
      gather = null;
      const next = pending.join(". ");
      pending = [];
      // Emptied first, so the same words said twice in a row still count as a change.
      setText("");
      reveal = window.setTimeout(() => setText(next), 50);
    };
    const listener = (message: string) => {
      if (!pending.includes(message)) {
        pending.push(message);
      }
      gather ??= window.setTimeout(flush, GATHER_MS);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (gather !== null) {
        window.clearTimeout(gather);
      }
      if (reveal !== null) {
        window.clearTimeout(reveal);
      }
    };
  }, []);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}

/** Marks the element focus falls back to inside a thread: its composer. */
export const FOCUS_HOME = "data-focus-home";
/** Marks a thread's root, so focus lost inside it stays inside it. */
export const FOCUS_SCOPE = "data-focus-scope";

/** Removed from the page, or inside a part of it that was hidden. */
function gone(el: HTMLElement): boolean {
  return !el.isConnected || el.closest("[hidden],[inert]") !== null;
}

function focusable(el: HTMLElement | null): el is HTMLElement {
  return Boolean(el && !gone(el) && !(el as HTMLButtonElement).disabled && el.getAttribute("aria-hidden") !== "true");
}

/**
 * Where focus goes when the element holding it disappears: an approval answered, a question sent, a Stop
 * button gone with the turn it stopped. The browser drops focus to the top of the page, which leaves a
 * screen reader user outside the thread. Instead it lands on the thread's composer, or on the nearest part
 * of the page that is still there.
 */
function fallbackFor(path: HTMLElement[]): HTMLElement | null {
  for (const el of path) {
    if (gone(el)) {
      continue;
    }
    const scope = el.closest<HTMLElement>(`[${FOCUS_SCOPE}]`);
    const home = scope?.querySelector<HTMLElement>(`[${FOCUS_HOME}]`) ?? null;
    if (focusable(home)) {
      return home;
    }
    if (scope && focusable(scope)) {
      return scope;
    }
    const main = el.closest<HTMLElement>("main");
    const mainHome = main?.querySelector<HTMLElement>(`[${FOCUS_HOME}]`) ?? null;
    if (focusable(mainHome)) {
      return mainHome;
    }
    return null;
  }
  return null;
}

export function FocusKeeper() {
  useEffect(() => {
    // The focused element and its ancestors, recorded while they are still attached: once removed, a node
    // can no longer say where in the page it was.
    let path: HTMLElement[] = [];
    let pending: number | null = null;
    const onFocusIn = (event: FocusEvent) => {
      const next: HTMLElement[] = [];
      for (let el = event.target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        next.push(el);
      }
      path = next;
    };
    const check = () => {
      pending = null;
      const lost = document.activeElement === null || document.activeElement === document.body;
      if (!lost || !path[0] || !gone(path[0])) {
        return;
      }
      fallbackFor(path)?.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(() => {
      // After a tick, so a menu or dialog putting focus back on its own trigger goes first.
      if (pending === null && path[0] && gone(path[0])) {
        pending = window.setTimeout(check, 0);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "inert"] });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocusIn);
      if (pending !== null) {
        window.clearTimeout(pending);
      }
    };
  }, []);
  return null;
}
