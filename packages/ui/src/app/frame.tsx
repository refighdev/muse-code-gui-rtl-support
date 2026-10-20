import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "../components/ui/primitives.js";

/** Window chrome a desktop shell hands to the UI when the UI draws the title bar itself. */
export interface WindowFrame {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  startDragging(): void;
  isMaximized(): Promise<boolean>;
  /** Calls back after every resize, and returns an unsubscribe. */
  onResized(callback: () => void): () => void;
}

const FrameContext = createContext<WindowFrame | null>(null);

/** True when the shell overlays macOS traffic lights on the UI instead of a title bar. */
const OverlayContext = createContext(false);

// Presses on these never move the window, even inside a drag region.
const INTERACTIVE =
  'button, a, input, textarea, select, label, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [contenteditable="true"], [data-no-drag]';

export function FrameProvider(props: { frame: WindowFrame | undefined; overlay?: boolean; children: ReactNode }) {
  const frame = props.frame ?? null;
  useEffect(() => {
    if (!frame) {
      return;
    }
    // Any `data-drag-region` surface moves the window, and a double press toggles maximize, like a native title bar.
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (event.button !== 0 || !(target instanceof Element)) {
        return;
      }
      if (!target.closest("[data-drag-region]") || target.closest(INTERACTIVE)) {
        return;
      }
      event.preventDefault();
      if (event.detail === 2) {
        frame.toggleMaximize();
      } else {
        frame.startDragging();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [frame]);
  return (
    <FrameContext.Provider value={frame}>
      <OverlayContext.Provider value={props.overlay ?? false}>{props.children}</OverlayContext.Provider>
    </FrameContext.Provider>
  );
}

export function useFrame(): WindowFrame | null {
  return useContext(FrameContext);
}

export function useTitlebarOverlay(): boolean {
  return useContext(OverlayContext);
}

/**
 * Native drag-region props on macOS overlay windows, empty elsewhere: the Windows shell drags
 * through its own handler, and firing both would double-toggle maximize. `deep` drags from
 * anywhere in the subtree except clickable elements, `self` only from the element itself,
 * and `off` opts one element out so e.g. double-click to rename keeps working.
 */
export function useOverlayDragProps(mode: "deep" | "self" | "off" = "deep"): { "data-tauri-drag-region"?: string } {
  if (!useTitlebarOverlay()) {
    return {};
  }
  return { "data-tauri-drag-region": mode === "deep" ? "deep" : mode === "self" ? "true" : "false" };
}

/** Reserves the caption buttons' width at the end of a `px-3` header, so its own actions never sit under them. */
export function CaptionSpacer() {
  return useFrame() ? <span aria-hidden="true" className="-mr-3 ml-auto w-[138px] shrink-0 self-stretch" /> : null;
}

/** A drag strip for full-window screens that have no header. */
export function FrameStrip() {
  const frame = useFrame();
  const overlay = useTitlebarOverlay();
  const drag = useOverlayDragProps("self");
  if (!frame && !overlay) {
    return null;
  }
  return (
    <div data-drag-region {...drag} aria-hidden="true" className="fixed inset-x-0 top-0 z-[var(--z-sticky)] h-12" />
  );
}

/** Minimize, maximize and close, drawn to match Windows 11 caption buttons. */
export function WindowControls() {
  const frame = useFrame();
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    if (!frame) {
      return;
    }
    let alive = true;
    const sync = () => {
      frame.isMaximized().then(
        (value) => {
          if (alive) {
            setMaximized(value);
          }
        },
        () => undefined,
      );
    };
    sync();
    const unsubscribe = frame.onResized(sync);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [frame]);
  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  if (!frame) {
    return null;
  }
  return (
    <div
      role="group"
      aria-label="Window"
      // Stays clickable while a dialog has disabled pointer events on the page, like native caption buttons.
      className={cn(
        "pointer-events-auto fixed top-0 right-0 z-[var(--z-titlebar)] flex h-12 transition-colors duration-100",
        focused ? "text-fg" : "text-subtle",
      )}
    >
      <CaptionButton label="Minimize" glyph={"\uE921"} onClick={() => frame.minimize()} />
      <CaptionButton
        label={maximized ? "Restore" : "Maximize"}
        glyph={maximized ? "\uE923" : "\uE922"}
        onClick={() => frame.toggleMaximize()}
      />
      <CaptionButton label="Close" glyph={"\uE8BB"} onClick={() => frame.close()} close />
    </div>
  );
}

function CaptionButton(props: { label: string; glyph: string; onClick: () => void; close?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={cn(
        "flex h-full w-[46px] items-center justify-center font-caption text-[10px] leading-none transition-colors duration-100 select-none",
        props.close ? "hover:bg-caption-close hover:text-white active:bg-caption-close/90" : "hover:bg-hover active:bg-active",
      )}
    >
      <span aria-hidden="true">{props.glyph}</span>
    </button>
  );
}
