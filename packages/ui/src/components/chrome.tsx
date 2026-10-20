import { SidebarSimpleIcon } from "./ui/icons.js";
import type { ReactNode } from "react";
import { useApp, useController } from "../app/context.js";
import { usePanel } from "../app/panel.js";
import { CaptionSpacer, useOverlayDragProps, useTitlebarOverlay } from "../app/frame.js";
import { Tip } from "./ui/overlays.js";
import { IconButton, MOD, cn } from "./ui/primitives.js";

export function SidebarToggle() {
  const controller = useController();
  const collapsed = useApp((s) => s.prefs.sidebarCollapsed);
  const panel = usePanel();
  if (!collapsed || panel) {
    return null;
  }
  return (
    <Tip label="Show sidebar" shortcut={[MOD, "B"]}>
      <IconButton label="Show sidebar" onClick={() => controller.toggleSidebar()}>
        <SidebarSimpleIcon size={16} />
      </IconButton>
    </Tip>
  );
}

/** The 48px bar every main view starts with, so switching views never shifts content. */
export function TopBar(props: { children?: ReactNode; className?: string }) {
  const drag = useOverlayDragProps();
  return (
    <header data-drag-region {...drag} className={cn("flex h-12 shrink-0 items-center gap-2 px-3", props.className)}>
      <TrafficLightSpacer />
      <SidebarToggle />
      {props.children}
      <CaptionSpacer />
    </header>
  );
}

/**
 * Clears the macOS traffic lights once the sidebar is hidden and they sit over the main view.
 * The shell pins them 20px from the left edge, three 12px lights with 8px gaps, so 68px after
 * the header's own 12px padding leaves an 8px breather.
 */
export function TrafficLightSpacer() {
  const overlay = useTitlebarOverlay();
  const collapsed = useApp((s) => s.prefs.sidebarCollapsed);
  if (!overlay || !collapsed) {
    return null;
  }
  return <span aria-hidden="true" className="w-[68px] shrink-0" />;
}
