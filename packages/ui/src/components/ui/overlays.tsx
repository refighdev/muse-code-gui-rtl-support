import { Dialog as RDialog, DropdownMenu, Tooltip as RTooltip } from "radix-ui";
import { CheckIcon, XIcon } from "./icons.js";
import type { ReactElement, ReactNode } from "react";
import { Shortcut, cn } from "./primitives.js";

/**
 * Radix defaults to `sticky="partial"` with `limitShift`, which keeps a menu glued to its
 * trigger and lets it paint off-screen. Desktop WKWebView then clips it; `always` drops the
 * limiter so shift can push the whole surface back into the window.
 */
export const FLOATING = {
  collisionPadding: 12,
  sticky: "always" as const,
};

export function TooltipProvider(props: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={450} skipDelayDuration={250}>
      {props.children}
    </RTooltip.Provider>
  );
}

/** A label tooltip for icon buttons and truncated text. The trigger keeps its own accessible name. */
export function Tip(props: {
  label: ReactNode;
  shortcut?: string[];
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  children: ReactElement;
}) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{props.children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={props.side ?? "bottom"}
          align={props.align ?? "center"}
          sideOffset={6}
          {...FLOATING}
          className="pop z-[var(--z-tooltip)] flex max-w-[min(360px,calc(100dvw-24px))] items-center gap-2 rounded-md bg-inverse px-2 py-1 text-xs font-medium text-inverse-fg"
        >
          {props.label}
          {props.shortcut ? <Shortcut keys={props.shortcut} className="opacity-80 [&_kbd]:border-transparent [&_kbd]:bg-white/15 [&_kbd]:text-inverse-fg" /> : null}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuRadioGroup = DropdownMenu.RadioGroup;

/**
 * A menu of choices opens on the one in use, as a native popup does, so a screen reader starts from the
 * current value instead of the top of the list. After a frame, once Radix has placed its own focus.
 */
function focusChecked(node: HTMLDivElement | null) {
  if (!node) {
    return;
  }
  window.requestAnimationFrame(() => {
    const checked = node.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    if (checked && node.contains(document.activeElement)) {
      checked.focus();
    }
  });
}

export function MenuContent(props: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  sideOffset?: number;
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        ref={focusChecked}
        align={props.align ?? "start"}
        side={props.side ?? "bottom"}
        sideOffset={props.sideOffset ?? 6}
        {...FLOATING}
        className={cn(
          // Never taller than the room Radix measured on the side it opened, so long menus scroll instead of clipping.
          "pop z-[var(--z-dropdown)] max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-[min(360px,calc(100dvw-24px))] min-w-[208px] overflow-y-auto rounded-xl bg-raised p-1 text-sm text-fg shadow-pop outline-none",
          props.className,
        )}
      >
        {props.children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

const ITEM =
  "relative flex min-h-8 cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none select-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40";

export function MenuItem(props: {
  icon?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <DropdownMenu.Item
      disabled={props.disabled}
      onSelect={props.onSelect}
      className={cn(ITEM, props.tone === "danger" && "text-danger-text")}
    >
      {props.icon ? (
        <span className={cn("flex size-4 shrink-0 items-center justify-center", props.tone === "danger" ? "text-danger-text" : "text-muted")}>
          {props.icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{props.children}</span>
      {props.hint ? <span className="shrink-0 text-xs text-subtle">{props.hint}</span> : null}
    </DropdownMenu.Item>
  );
}

/** A selectable option with an optional second line; shows a check when chosen. */
export function MenuOption(props: {
  value: string;
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.RadioItem
      value={props.value}
      disabled={props.disabled}
      className={cn(ITEM, "items-start py-2")}
    >
      {props.icon ? <span className="mt-px flex size-4 shrink-0 items-center justify-center text-muted">{props.icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{props.label}</span>
          {props.badge}
        </span>
        {props.description ? (
          <span className="mt-0.5 block text-xs leading-snug text-pretty text-muted [overflow-wrap:anywhere]">{props.description}</span>
        ) : null}
      </span>
      <DropdownMenu.ItemIndicator className="mt-0.5 shrink-0 text-accent-text">
        <CheckIcon size={14} aria-hidden="true" />
        {/* VoiceOver does not always say "checked" for a menu radio, so the choice in use says so in words. */}
        <span className="sr-only">, selected</span>
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}

/** A menu item that turns a setting on or off, checked while on. The menu stays open to show the change. */
export function MenuCheck(props: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; description?: ReactNode }) {
  return (
    <DropdownMenu.CheckboxItem
      checked={props.checked}
      onCheckedChange={(checked) => props.onChange(checked === true)}
      onSelect={(event) => event.preventDefault()}
      className={cn(ITEM, "items-start py-2")}
    >
      <span className="min-w-0 flex-1">
        <span className="block">{props.children}</span>
        {props.description ? <span className="mt-0.5 block text-xs leading-snug text-muted">{props.description}</span> : null}
      </span>
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <DropdownMenu.ItemIndicator className="text-accent-text">
          <CheckIcon size={14} />
        </DropdownMenu.ItemIndicator>
      </span>
    </DropdownMenu.CheckboxItem>
  );
}

export function MenuLabel(props: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2 pt-1.5 pb-1 text-xs font-medium text-subtle">{props.children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="mx-1 my-1 h-px bg-line" />;
}

/**
 * A panel off the right edge, for detail that would swamp a transcript row. Same dialog underneath
 * as `Modal`: focus is trapped, Escape closes, and the page behind it stays where it was.
 */
export function Sheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay-fade fixed inset-0 z-[var(--z-overlay)] bg-[oklch(0.1_0.01_255/0.45)]" />
        <RDialog.Content
          className={cn(
            "sheet-in fixed inset-y-0 right-0 z-[var(--z-modal)] flex w-[min(560px,100vw)] flex-col bg-raised text-fg shadow-pop outline-none",
            props.className,
          )}
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <RDialog.Title className="text-base font-semibold tracking-[-0.01em]">{props.title}</RDialog.Title>
              {props.description ? (
                <RDialog.Description className="mt-0.5 text-xs text-pretty text-muted">{props.description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{props.title}</RDialog.Description>
              )}
            </div>
            <RDialog.Close
              aria-label="Close"
              className="-m-1 shrink-0 rounded-lg p-1 text-subtle transition-colors duration-100 hover:bg-hover hover:text-fg"
            >
              <XIcon size={16} />
            </RDialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{props.children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Modal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  hideTitle?: boolean;
  /** No inner padding, for full-bleed content like the command palette. */
  bare?: boolean;
}) {
  return (
    <RDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay-fade fixed inset-0 z-[var(--z-overlay)] bg-[oklch(0.1_0.01_255/0.45)]" />
        <RDialog.Content
          onOpenAutoFocus={(event) => {
            const demo = (event.target as HTMLElement | null)?.closest?.(".musegui-app");
            if (demo && !demo.contains(document.activeElement)) event.preventDefault();
          }}
          onFocusOutside={(event) => {
            const demo = (event.currentTarget as HTMLElement).closest(".musegui-app");
            if (!demo) return;
            const next = event.target as Node | null;
            if (next && !demo.contains(next)) event.preventDefault();
          }}
          className={cn(
            "modal-pop fixed left-1/2 z-[var(--z-modal)] -translate-x-1/2 rounded-2xl bg-raised text-fg shadow-pop outline-none",
            props.bare ? "p-0" : "p-5",
            props.className ?? "top-[14vh] w-[min(520px,calc(100%-32px))]",
          )}
        >
          <RDialog.Title className={cn("text-lg font-semibold tracking-[-0.01em]", props.hideTitle && "sr-only")}>
            {props.title}
          </RDialog.Title>
          {props.description ? (
            <RDialog.Description className="mt-1 text-sm text-muted">{props.description}</RDialog.Description>
          ) : (
            <RDialog.Description className="sr-only">{props.title}</RDialog.Description>
          )}
          {props.children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
