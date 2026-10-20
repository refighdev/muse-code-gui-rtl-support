import { ChatCircleDotsIcon, EyeIcon, ShieldWarningIcon, WarningCircleIcon } from "./icons.js";
import type { ThreadStatus } from "../../model/status.js";
import { Spinner, cn } from "./primitives.js";

/** The one-glance status mark for a thread. Always paired with text elsewhere; never color alone. */
export function StatusGlyph(props: { status: ThreadStatus; className?: string }) {
  switch (props.status) {
    case "running":
      return <Spinner size={12} className={cn("text-accent-text", props.className)} />;
    case "approval":
      return <ShieldWarningIcon size={14} className={cn("attention-pulse text-warn", props.className)} aria-hidden="true" />;
    case "input":
      return (
        <ChatCircleDotsIcon size={14} className={cn("attention-pulse text-warn", props.className)} aria-hidden="true" />
      );
    case "failed":
      return <WarningCircleIcon size={14} className={cn("text-danger", props.className)} aria-hidden="true" />;
    case "watching":
      return <EyeIcon size={13} className={cn("text-accent-text", props.className)} aria-hidden="true" />;
    case "unread":
      return <span className={cn("block size-[7px] rounded-full bg-accent", props.className)} aria-hidden="true" />;
    default:
      return null;
  }
}
