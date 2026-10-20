import { IconContext, type IconProps } from "@phosphor-icons/react";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { MuseGuiController } from "../model/controller.js";
import type { AppState } from "../model/store.js";

const ControllerContext = createContext<MuseGuiController | null>(null);

/**
 * The one icon style for every surface that renders the product: the desktop and web apps, and the
 * live demos on the landing page, which mount these components without MuseGuiApp. Bold is the
 * Phosphor weight whose stroke matches the line icons at the 11 to 16 px sizes the UI uses; a
 * decorative icon can still ask for another weight on its own.
 */
const ICON_DEFAULTS: IconProps = { weight: "bold", size: 24 };

export function ControllerProvider(props: { controller: MuseGuiController; children: ReactNode }) {
  return (
    <ControllerContext.Provider value={props.controller}>
      <IconContext.Provider value={ICON_DEFAULTS}>{props.children}</IconContext.Provider>
    </ControllerContext.Provider>
  );
}

export function useController(): MuseGuiController {
  const controller = useContext(ControllerContext);
  if (!controller) {
    throw new Error("Muse Code GUI: useController outside of <ControllerProvider>.");
  }
  return controller;
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) {
    return false;
  }
  for (const key of ka) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

/** Select a slice of app state; re-renders only when the slice changes under `equal`. */
export function useApp<T>(selector: (state: AppState) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const store = useController().store;
  const selectorRef = useRef(selector);
  const equalRef = useRef(equal);
  selectorRef.current = selector;
  equalRef.current = equal;
  const cache = useRef<{ state: AppState; selector: (state: AppState) => T; value: T } | null>(null);
  const getSnapshot = (): T => {
    const state = store.get();
    const current = cache.current;
    if (current && current.state === state && current.selector === selectorRef.current) {
      return current.value;
    }
    const value = selectorRef.current(state);
    if (current && equalRef.current(current.value, value)) {
      cache.current = { state, selector: selectorRef.current, value: current.value };
      return current.value;
    }
    cache.current = { state, selector: selectorRef.current, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** A clock that re-renders the caller every `intervalMs` while `active`. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}
