import { useMemo, useState } from "react";

/** The parts of a keyboard event the IME check reads. React and DOM key events both fit. */
export interface ImeKeyEvent {
  key: string;
  keyCode: number;
  shiftKey?: boolean;
  nativeEvent: { isComposing: boolean };
}

/** How long after compositionend an Enter still counts as the key that confirmed the candidate. */
const CONFIRM_WINDOW_MS = 100;

/**
 * Tracks IME composition for one input. WKWebView (the macOS app) fires compositionend before the
 * keydown of the Enter that confirmed the candidate, so isComposing is already false by then and
 * a plain check on it sends the message too early. This remembers that the composition just ended.
 */
export class ImeTracker {
  private confirming = false;
  private endedAt = 0;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  compositionStart(): void {
    this.confirming = false;
  }

  compositionEnd(): void {
    this.confirming = true;
    this.endedAt = this.now();
  }

  /** The confirming Enter is done once its keyup arrives. */
  keyUp(key: string): void {
    if (key === "Enter") {
      this.confirming = false;
    }
  }

  /** True when this keydown belongs to the IME, so the input must not act on it. */
  isImeKey(event: ImeKeyEvent): boolean {
    // The live flags only: a remembered "composing" sticks if the input unmounts mid-composition.
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return true;
    }
    // Space or a candidate click can end a composition too; any other key ends the window.
    if (event.key !== "Enter") {
      this.confirming = false;
      return false;
    }
    // Shift+Enter counts too: some IMEs (ATOK) confirm with it. A textarea that ignores the key
    // still gets its native newline, so only the app's own action is held back.
    return this.confirming && this.now() - this.endedAt <= CONFIRM_WINDOW_MS;
  }
}

/**
 * Handlers for an input that acts on Enter. Spread the handlers on the element and call `isImeKey`
 * first in its keydown, so the Enter that commits an IME candidate does not submit.
 */
export function useImeGuard() {
  const [tracker] = useState(() => new ImeTracker());
  return useMemo(
    () => ({
      onCompositionStart: () => tracker.compositionStart(),
      onCompositionEnd: () => tracker.compositionEnd(),
      onKeyUp: (event: { key: string }) => tracker.keyUp(event.key),
      isImeKey: (event: ImeKeyEvent) => tracker.isImeKey(event),
    }),
    [tracker],
  );
}
