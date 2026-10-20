import { useEffect, useRef } from "react";
import { cn } from "./primitives.js";

const PITCH = 4;
const SIZE = 2;

/** A stable 0..1 value per cell and tick, so every pixel keeps its own rhythm. */
function hash(col: number, row: number, tick = 0): number {
  const s = Math.sin(col * 127.1 + row * 311.7 + tick * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A field of pixels in the current text color that drift toward the right edge and thicken
 * as they go, like the Claude desktop "Ultracode" effort fill. Draws one still frame under
 * reduced motion.
 */
export function PixelFlow(props: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let color = "";
    let frame = 0;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      color = getComputedStyle(canvas).color;
    };
    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      const cols = Math.floor(width / PITCH);
      const rows = Math.floor(height / PITCH);
      const top = Math.floor((height - rows * PITCH) / 2);
      const t = time / 1000;
      for (let c = 0; c < cols; c++) {
        const x = cols > 1 ? c / (cols - 1) : 1;
        // Sparse at the slow end, dense by the thumb.
        const ramp = 0.12 + 0.88 * x ** 1.5;
        // A brighter band travelling toward the thumb raises the odds a pixel is lit.
        const flow = 0.5 + 0.5 * Math.sin(x * 8 - t * 1.33);
        const chance = Math.min(1, 0.05 + ramp * (0.45 + 0.55 * flow));
        // Fully visible at the thumb, gone at the slow end.
        const fade = x * x * (3 - 2 * x);
        for (let r = 0; r < rows; r++) {
          const seed = hash(c, r);
          // Each pixel re-rolls on its own clock, roughly two to four times a second: the flicker.
          const tick = Math.floor(t * ((5 + seed * 7) / 3) + seed * 50);
          const lit = hash(c, r, tick) < chance;
          ctx.globalAlpha = fade * (lit ? 0.35 + 0.65 * ramp : 0.06 + 0.08 * ramp);
          ctx.fillRect(c * PITCH + 1, top + r * PITCH + 1, SIZE, SIZE);
        }
      }
      ctx.globalAlpha = 1;
      if (!reduce) {
        frame = requestAnimationFrame(draw);
      }
    };
    measure();
    const resize = new ResizeObserver(() => {
      measure();
      if (reduce) {
        draw(0);
      }
    });
    resize.observe(canvas);
    // Theme switches change the text color the pixels are drawn in.
    const theme = new MutationObserver(() => {
      color = getComputedStyle(canvas).color;
      if (reduce) {
        draw(0);
      }
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      theme.disconnect();
    };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className={cn("pointer-events-none block size-full", props.className)} />;
}
