// via beUI AnimatedToastStack (beui.dev), MIT (c) 2026 Saurabh Chauhan.
// Adapted: driven by the Muse Code GUI store, project tokens, no backdrop blur, chronological stack.
import { CheckIcon, InfoIcon, WarningCircleIcon, XIcon } from "./icons.js";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import type { ReactNode } from "react";
import { useApp, useController } from "../../app/context.js";
import type { Toast } from "../../model/store.js";
import { cn } from "./primitives.js";

const STACK_SPRING: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.75 };
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

const TONE: Record<Toast["tone"], { icon: JSX.Element; className: string }> = {
  error: { icon: <WarningCircleIcon size={14} />, className: "bg-danger-soft text-danger-text" },
  success: { icon: <CheckIcon size={14} />, className: "bg-[color-mix(in_oklch,var(--ok)_16%,transparent)] text-ok-text" },
  info: { icon: <InfoIcon size={14} />, className: "bg-active text-muted" },
};

/** `leading` sits at the top of the stack, above every toast: a card that outlives them, like What's new. */
export function Toasts(props: { leading?: ReactNode }) {
  const controller = useController();
  const toasts = useApp((s) => s.toasts);
  const reduce = useReducedMotion();
  return (
    <ol
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-4 bottom-4 z-[var(--z-toast)] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2"
    >
      {props.leading}
      <AnimatePresence initial={false} mode="popLayout">
        {toasts.map((toast) => (
          <motion.li
            key={toast.id}
            layout
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.96, filter: "blur(10px)" }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, x: 32, scale: 0.96, filter: "blur(8px)", transition: { duration: 0.18, ease: EASE_OUT } }
            }
            transition={STACK_SPRING}
            drag={reduce ? false : "x"}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={(_, info) => {
              if (Math.abs(info.offset.x) > 72 || Math.abs(info.velocity.x) > 520) {
                controller.dismissToast(toast.id);
              }
            }}
            className="pointer-events-auto relative"
          >
            <div
              role={toast.tone === "error" ? "alert" : "status"}
              className="flex items-start gap-3 rounded-2xl bg-raised p-3 shadow-pop"
            >
              <span className={cn("mt-px inline-flex size-7 shrink-0 items-center justify-center rounded-full", TONE[toast.tone].className)}>
                {TONE[toast.tone].icon}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm leading-5 font-medium text-fg">{toast.title}</p>
                {toast.detail ? <p className="mt-0.5 line-clamp-3 text-xs leading-4 break-words text-muted">{toast.detail}</p> : null}
                {toast.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.run();
                      controller.dismissToast(toast.id);
                    }}
                    className="mt-2 inline-flex h-7 items-center rounded-full bg-active px-3 text-xs font-medium text-fg transition-colors hover:bg-hover"
                  >
                    {toast.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => controller.dismissToast(toast.id)}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-subtle transition-colors hover:bg-hover hover:text-fg"
              >
                <XIcon size={14} />
              </button>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
