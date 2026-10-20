/*
 * Components adapted from open-source registries. Each keeps a note naming its source so it
 * can be re-fetched; all three sources are MIT licensed.
 *
 *   Collapse, PixelLoader, RollingDigits  via Beautiful UI (beautifului.dev), MIT (c) 2026 Shane Levine
 *   SwapIcon                              via beUI ActionSwapIcon (beui.dev), MIT (c) 2026 Saurabh Chauhan
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./primitives.js";

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/**
 * Height-animated disclosure body using the 0fr to 1fr grid-rows trick, so nothing is
 * measured. Children mount on first open and stay mounted so closing can animate.
 * via Beautiful UI ThinkingState / ToolChips expand grammar. Adapted: lazy mount, inert when closed.
 */
export function Collapse(props: { open: boolean; children: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(props.open);
  useEffect(() => {
    if (props.open) {
      setMounted(true);
    }
  }, [props.open]);
  const inert = props.open ? {} : ({ inert: "" } as Record<string, string>);
  return (
    <div
      className={cn("grid transition-[grid-template-rows,opacity] duration-[260ms] ease-out", props.className)}
      style={{ gridTemplateRows: props.open ? "1fr" : "0fr", opacity: props.open ? 1 : 0 }}
      aria-hidden={props.open ? undefined : true}
      {...inert}
    >
      <div className="min-h-0 overflow-hidden">{mounted ? props.children : null}</div>
    </div>
  );
}

const DRIVE_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3);
  const col = i % 3;
  return (col + Math.abs(row - 1)) * 90;
});

/**
 * A 3x3 pixel grid with a chevron wavefront driving right: the live "Muse is working" mark.
 * via Beautiful UI LoadingState ("Drive"). Adapted: currentColor, CSS-only, reduced motion dims.
 */
export function PixelLoader(props: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("pixel-loader grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]", props.className)}>
      {DRIVE_DELAYS.map((delay, index) => (
        <span key={index} className="size-[4px] rounded-[1px] bg-current" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

const ROLL_MS = 360;

/**
 * Odometer digits: each changed character rolls up (or down when the number falls).
 * via Beautiful UI ApprovalCard RollingDigits. Adapted: typed, timings to the motion scale.
 */
export function RollingDigits(props: { value: string; className?: string }) {
  const previous = useRef(props.value);
  const [from, setFrom] = useState(props.value);
  const [to, setTo] = useState(props.value);
  const [rolling, setRolling] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [direction, setDirection] = useState<"up" | "down">("up");

  useEffect(() => {
    if (previous.current === props.value) {
      return;
    }
    const old = previous.current;
    previous.current = props.value;
    const a = Number.parseInt(old, 10);
    const b = Number.parseInt(props.value, 10);
    setDirection(Number.isFinite(a) && Number.isFinite(b) && b < a ? "down" : "up");
    setFrom(old);
    setTo(props.value);
    setRolling(true);
    setShifted(false);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShifted(true));
    });
    const done = window.setTimeout(() => {
      setRolling(false);
      setFrom(props.value);
      setShifted(false);
    }, ROLL_MS);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.clearTimeout(done);
    };
  }, [props.value]);

  const chars = rolling ? to : from;
  return (
    <span className={cn("inline-flex tabular-nums", props.className)}>
      {/* A label on a plain span is not read; the digits themselves are hidden while they roll. */}
      <span className="sr-only">{props.value}</span>
      {Array.from({ length: chars.length }, (_, i) => {
        const o = from[i] ?? "";
        const n = chars[i] ?? "";
        if (!rolling || o === n) {
          return (
            <span key={`${i}-${n}`} aria-hidden="true" className="whitespace-pre">
              {n}
            </span>
          );
        }
        const top = direction === "down" ? n : o;
        const bottom = direction === "down" ? o : n;
        const rest = direction === "down" ? "0" : "-1em";
        const start = direction === "down" ? "-1em" : "0";
        return (
          <span
            key={`${i}-${o}-${n}-${direction}`}
            aria-hidden="true"
            className="relative inline-block overflow-hidden whitespace-pre"
            style={{ height: "1em", lineHeight: "1em", verticalAlign: "-0.05em" }}
          >
            <span
              className="flex flex-col"
              style={{ transition: "transform 320ms cubic-bezier(0.4, 0, 0.2, 1)", transform: `translateY(${shifted ? rest : start})` }}
            >
              <span style={{ height: "1em", lineHeight: "1em" }}>{top}</span>
              <span style={{ height: "1em", lineHeight: "1em" }}>{bottom}</span>
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Cross-swaps two icons through a short blur so the eye reads one morphing glyph, not two.
 * via beUI ActionSwapIcon ("blur"). Adapted: single variant, project easing, 180ms.
 */
export function SwapIcon(props: { value: string; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center", props.className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={props.value}
          aria-hidden="true"
          initial={reduce ? false : { opacity: 0, scale: 0.4, filter: "blur(6px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, filter: "blur(6px)" }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          className="col-start-1 row-start-1 inline-flex items-center justify-center"
        >
          {props.children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
