import { useEffect, useState } from "react";

/**
 * Talking to a host page that frames Muse Code GUI, such as an editor extension's webview. The host
 * sends its theme (light or dark) and its own colors and font, so Muse Code GUI matches the editor
 * around it; Muse Code GUI can ask the host to run a command it can't, like opening a folder.
 */

/** Editor theme colors the host forwards, keyed by the name after `--vscode-`. */
export type HostVars = Partial<Record<string, string>>;

/** Which Muse Code GUI token each editor color stands in for, first match wins. */
const TOKEN_SOURCES: Record<string, string[]> = {
  "--bg": ["surface"],
  "--bg-sidebar": ["surface"],
  "--bg-raised": ["editorHoverWidget-background", "editorWidget-background", "menu-background", "dropdown-background", "quickInput-background"],
  "--bg-sunken": ["input-background"],
  "--bg-hover": ["list-hoverBackground", "toolbar-hoverBackground"],
  "--bg-active": ["list-inactiveSelectionBackground", "list-hoverBackground"],
  "--border": ["widget-border", "panel-border", "sideBarSectionHeader-border", "editorGroup-border"],
  "--border-strong": ["input-border", "contrastBorder", "widget-border", "panel-border"],
  "--fg": ["sideBar-foreground", "foreground"],
  "--fg-muted": ["descriptionForeground"],
  "--fg-subtle": ["disabledForeground", "descriptionForeground"],
  "--accent": ["button-background", "focusBorder"],
  "--accent-hover": ["button-hoverBackground", "button-background"],
  "--accent-fg": ["button-foreground"],
  "--accent-text": ["textLink-foreground"],
  "--scrollbar": ["scrollbarSlider-background"],
};

/** Surfaces other content sits on or floats over (popovers, cards), which must stay opaque. */
const OPAQUE = new Set(["--bg", "--bg-sidebar", "--bg-raised"]);

/** Whether a CSS color is see-through: #rgba / #rrggbbaa below full alpha, or rgba()/hsla() below 1. */
export function isTranslucent(color: string): boolean {
  const value = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    const alpha = (hex[1] as string).length === 4 ? (hex[1] as string)[3] : (hex[1] as string).slice(6);
    return alpha !== "f" && alpha !== "ff";
  }
  const fn = /^(?:rgba?|hsla?)\((.*)\)$/.exec(value);
  if (fn) {
    const parts = (fn[1] as string).split(/[\s,/]+/).filter(Boolean);
    if (parts.length === 4) {
      const alpha = parts[3] as string;
      const n = alpha.endsWith("%") ? Number.parseFloat(alpha) / 100 : Number.parseFloat(alpha);
      return Number.isFinite(n) && n < 1;
    }
  }
  return value === "transparent";
}

/** A CSS custom property name the stylesheet may declare. */
const TOKEN_NAME = /^--[a-z0-9-]+$/;
/** A host color name, the part after `--vscode-`. */
const HOST_VAR_NAME = /^[A-Za-z0-9-]+$/;
/** What a host value may never contain: a url or expression, or anything that ends the declaration or rule. */
// eslint-disable-next-line no-control-regex
const UNSAFE_VALUE = /url\(|image-set\(|expression|javascript:|@import|[;{}<>\\]|\/\*|\*\/|!\s*important|[\u0000-\u001f\u007f]/i;
const MAX_VALUE_LENGTH = 300;

/** The value trimmed if it is a plain CSS value a host may set, or null if it could inject CSS. */
export function safeCssValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_VALUE_LENGTH || UNSAFE_VALUE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** The host's variables with unusable names and unsafe values dropped. */
export function sanitizeHostVars(vars: unknown): HostVars {
  const clean: HostVars = {};
  if (!vars || typeof vars !== "object") {
    return clean;
  }
  for (const [name, value] of Object.entries(vars)) {
    const safe = safeCssValue(value);
    if (HOST_VAR_NAME.test(name) && safe !== null) {
      clean[name] = safe;
    }
  }
  return clean;
}

/** The stylesheet that maps editor colors onto Muse Code GUI's tokens, or "" to use Muse Code GUI's own. */
export function hostStylesheet(input: HostVars): string {
  const vars = sanitizeHostVars(input);
  const rules: string[] = [];
  for (const [token, sources] of Object.entries(TOKEN_SOURCES)) {
    if (!TOKEN_NAME.test(token)) {
      continue;
    }
    const value = sources
      .map((name) => vars[name])
      .find((v) => typeof v === "string" && v.trim() !== "" && !(OPAQUE.has(token) && isTranslucent(v)));
    if (value) {
      rules.push(`${token}: ${value.trim()} !important;`);
    }
  }
  const font = vars["font-family"]?.trim();
  if (font) {
    rules.push(`--font-sans: ${font} !important;`);
  }
  const size = Number.parseFloat(vars["font-size"] ?? "");
  // Muse Code GUI's body text is text-sm (0.875rem); scale the root so it lands on the editor's size.
  const root = Number.isFinite(size) && size >= 10 && size <= 20 ? ` font-size: ${Math.round((size / 0.875) * 100) / 100}px !important;` : "";
  if (rules.length === 0 && !root) {
    return "";
  }
  return `html:root { ${rules.join(" ")}${root} }`;
}

function applyHostStyle(vars: HostVars): void {
  let el = document.getElementById("musegui-host-style") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "musegui-host-style";
    document.head.appendChild(el);
  }
  el.textContent = hostStylesheet(vars);
}

function framed(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

/**
 * The origin of the page framing Muse Code GUI, from the browser's own record of the frame chain (the
 * nearest ancestor first) or, where that is missing, the referrer. Null when neither names a real
 * origin, such as an opaque or sandboxed host; Muse Code GUI then neither sends to nor listens to it.
 */
export function resolveHostOrigin(ancestorOrigins: readonly string[] | undefined, referrer: string): string | null {
  const nearest = ancestorOrigins?.[0];
  if (nearest && nearest !== "null") {
    return nearest;
  }
  if (referrer) {
    try {
      const origin = new URL(referrer).origin;
      return origin === "null" ? null : origin;
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether a message came from the framing page itself: its window, and the origin that framed us. */
export function fromHost(event: { source: unknown; origin: string }, parent: unknown, expectedOrigin: string | null): boolean {
  return expectedOrigin !== null && event.source === parent && event.origin === expectedOrigin;
}

let cachedHostOrigin: string | null | undefined;

function hostOrigin(): string | null {
  if (cachedHostOrigin === undefined) {
    cachedHostOrigin = resolveHostOrigin(window.location.ancestorOrigins as unknown as readonly string[] | undefined, document.referrer);
  }
  return cachedHostOrigin;
}

function isHostEvent(event: MessageEvent): boolean {
  return fromHost(event, window.parent, hostOrigin());
}

let editorHosted = false;

/** Marks the page as framed by an editor, which then handles copying and opening files. */
export function setEditorHosted(hosted: boolean): void {
  editorHosted = hosted;
}

/** Whether an editor frames the page, so nothing needs to point the user at the editor extension. */
export function isEditorHosted(): boolean {
  return editorHosted;
}

/**
 * Copies text. Inside an editor's webview the browser clipboard is blocked for framed pages, so
 * the editor copies it instead; elsewhere this is the ordinary clipboard API.
 */
export function copyText(text: string): Promise<void> {
  if (editorHosted && framed()) {
    postToHost({ type: "musegui-command", command: "copy", args: { text } });
    return Promise.resolve();
  }
  return navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("No clipboard"));
}

type Editable = HTMLInputElement | HTMLTextAreaElement;

function editableTarget(): Editable | null {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) {
    return el;
  }
  if (el instanceof HTMLInputElement && /^(text|search|url|email|password|tel|number)$/.test(el.type)) {
    return el;
  }
  return null;
}

let pasteSeq = 0;
const pastes = new Map<number, (text: string) => void>();

/** Asks the editor for its clipboard text; resolves with "" if it doesn't answer. */
function readHostClipboard(): Promise<string> {
  const id = ++pasteSeq;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pastes.delete(id);
      resolve("");
    }, 2000);
    pastes.set(id, (text) => {
      window.clearTimeout(timer);
      resolve(text);
    });
    postToHost({ type: "musegui-command", command: "paste", args: { id } });
  });
}

/** Types text at the caret the way a paste would, so React sees an ordinary input event. */
function insertText(el: Editable, text: string): void {
  el.focus();
  if (!document.execCommand("insertText", false, text)) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.setRangeText(text, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/**
 * Inside an editor's webview the editor handles Cmd+C/X/V/A itself and never reaches a framed
 * page, so neither copying a selection nor pasting into the composer works. With an editor host,
 * Muse Code GUI takes those four keys and goes through the editor's clipboard instead.
 */
export function installEditorClipboard(isMac: boolean): () => void {
  const onKey = (event: KeyboardEvent) => {
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (!mod || event.altKey || event.shiftKey) {
      return;
    }
    const key = event.key.toLowerCase();
    const field = editableTarget();
    if (key === "c" || key === "x") {
      const text = field
        ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
        : (window.getSelection()?.toString() ?? "");
      if (!text) {
        return;
      }
      event.preventDefault();
      void copyText(text);
      if (key === "x" && field) {
        insertText(field, "");
      }
    } else if (key === "v" && field) {
      event.preventDefault();
      void readHostClipboard().then((text) => {
        if (text) {
          insertText(field, text);
        }
      });
    } else if (key === "a" && field) {
      event.preventDefault();
      field.select();
    }
  };
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; id?: unknown; text?: unknown } | null;
    if (isHostEvent(event) && data?.type === "musegui-paste" && typeof data.id === "number") {
      pastes.get(data.id)?.(typeof data.text === "string" ? data.text : "");
      pastes.delete(data.id);
    }
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("message", onMessage);
  };
}

/** Sends a message to the page framing Muse Code GUI, when there is one. */
export function postToHost(message: { type: string; [key: string]: unknown }): void {
  // Pinned to the framing page's origin, so a page that navigates the host away can't read these.
  const target = framed() ? hostOrigin() : null;
  if (target) {
    window.parent.postMessage(message, target);
  }
}

/**
 * The host's color scheme, starting from the one in the URL and following the host's messages.
 * Also applies the host's colors and font as they arrive. Null when nothing hosts Muse Code GUI.
 */
export function useHostTheme(initial: "light" | "dark" | undefined): "light" | "dark" | null {
  const [theme, setTheme] = useState<"light" | "dark" | null>(initial ?? null);
  useEffect(() => {
    if (!initial || !framed()) {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (!isHostEvent(event)) {
        return;
      }
      const data = event.data as { type?: unknown; theme?: unknown; kind?: unknown; vars?: unknown } | null;
      if (data?.type === "musegui-theme" && (data.theme === "light" || data.theme === "dark")) {
        setTheme(data.theme);
      } else if (data?.type === "musegui-host-style") {
        if (data.kind === "light" || data.kind === "dark") {
          setTheme(data.kind);
        }
        if (data.vars && typeof data.vars === "object") {
          applyHostStyle(data.vars as HostVars);
        }
      }
    };
    window.addEventListener("message", onMessage);
    // The frame loads before this listener exists; ask for the host's colors now that it does.
    postToHost({ type: "musegui-host-ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [initial]);
  return theme;
}
