// via Rare UI FolderComponent (rareui.com), MIT (c) 2026 Swami Malode.
// Adapted: themed through Muse Code GUI tokens for light and dark, fixed small scale, reduced motion
// holds the resting pose, and the click hands off to the caller instead of toggling locally.
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

const WIDTH = 321;
const HEIGHT = 270;
const SCALE = 0.56;
const FLAP =
  "M0 25C0 11.1929 11.1929 0 25 0H136.084C143.044 0 149.689 2.90139 154.42 8.00608L178.08 33.5343C182.811 38.639 189.456 41.5404 196.416 41.5404H296C309.807 41.5404 321 52.7333 321 66.5404V216C321 229.807 309.807 241 296 241H25C11.1929 241 0 229.807 0 216V25Z";
const SPRING = { type: "spring" as const, stiffness: 120, damping: 13 };

const CARDS = [
  { rest: { x: 40, y: -10, rotate: 10 }, hover: { x: 40, y: -30, rotate: 14 }, open: { x: 70, y: -160, rotate: 18 }, delay: [0.1, 0.12] },
  { rest: { x: 3, y: -20, rotate: 2 }, hover: { x: 3, y: -35, rotate: -1 }, open: { x: 0, y: -180, rotate: -3 }, delay: [0.05, 0.06] },
  { rest: { x: -40, y: -22, rotate: -5 }, hover: { x: -40, y: -44, rotate: -9 }, open: { x: -65, y: -170, rotate: -14 }, delay: [0, 0] },
];

/** A folder of pages that fans open on hover: the first-run invitation to add a project. */
export function FolderArt(props: { onActivate?: () => void; label: string }) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const pose = reduce ? "rest" : open ? "open" : hovered ? "hover" : "rest";
  return (
    <button
      type="button"
      aria-label={props.label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setOpen(false);
      }}
      onFocus={() => setHovered(true)}
      onBlur={() => {
        setHovered(false);
        setOpen(false);
      }}
      onClick={() => {
        setOpen(true);
        props.onActivate?.();
      }}
      className="relative block rounded-3xl outline-offset-8"
      style={{ width: WIDTH * SCALE, height: HEIGHT * SCALE }}
    >
      <span
        className="absolute top-1/2 left-1/2"
        style={{
          width: WIDTH,
          height: HEIGHT,
          transform: `translate(-50%, -50%) scale(${SCALE})`,
          perspective: 800 * SCALE,
        }}
      >
        <span
          className="absolute inset-0"
          style={{
            borderRadius: 25,
            background: "var(--folder-back)",
            boxShadow: "inset 0 0 6px 2px oklch(1 0 0 / 0.3)",
          }}
        />
        <span className="absolute inset-0 flex items-center justify-center">
          {CARDS.map((card, index) => (
            <motion.span
              key={index}
              className="absolute"
              initial={false}
              animate={card[pose]}
              transition={{ ...SPRING, delay: pose === "open" ? card.delay[0] : pose === "hover" ? card.delay[1] : 0 }}
            >
              <Page />
            </motion.span>
          ))}
        </span>
        <motion.span
          className="absolute left-1/2 top-1/2 mt-4 -translate-x-1/2 -translate-y-1/2"
          style={{ transformOrigin: "bottom center", transformStyle: "preserve-3d", width: 321, height: 241 }}
          initial={false}
          animate={{ rotateX: pose === "open" ? -55 : pose === "hover" ? -45 : -15 }}
          transition={{ type: "spring", stiffness: 120, damping: 14 }}
        >
          <svg className="absolute inset-0" width="321" height="241" viewBox="0 0 321 241" fill="none" aria-hidden="true">
            <path d={FLAP} fill="var(--folder-flap)" />
            <path
              d="M25 0.5H136.084C142.905 0.5 149.417 3.3431 154.054 8.3457L177.713 33.874C182.539 39.0808 189.317 42.04 196.416 42.04H296C309.531 42.04 320.5 53.0092 320.5 66.54V216C320.5 229.531 309.531 240.5 296 240.5H25C11.469 240.5 0.5 229.531 0.5 216V25C0.5 11.469 11.469 0.5 25 0.5Z"
              stroke="var(--folder-edge)"
            />
          </svg>
        </motion.span>
      </span>
    </button>
  );
}

function Page() {
  const bars = [60.99, 75.11, 89.23, 103.35, 117.47, 131.59];
  return (
    <svg width="164" height="214" viewBox="0 0 164 214" fill="none" aria-hidden="true">
      <rect width="163.078" height="213.262" rx="20" fill="var(--folder-page)" />
      <rect x="0.5" y="0.5" width="162.078" height="212.262" rx="19.5" stroke="var(--folder-page-edge)" />
      <rect x="14.12" y="31.21" width="134.84" height="11.89" rx="5.94" fill="var(--folder-line)" />
      {bars.map((y) => (
        <g key={y}>
          <rect x="14.83" y={y} width="64.52" height="5.88" rx="2.94" fill="var(--folder-line)" />
          <rect x="84.43" y={y} width="64.52" height="5.88" rx="2.94" fill="var(--folder-line)" />
        </g>
      ))}
    </svg>
  );
}
