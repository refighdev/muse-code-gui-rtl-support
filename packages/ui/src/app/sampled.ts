import { useEffect, useRef, useState } from "react";

/**
 * Reads a fast-changing number once a second while `enabled`, so a live readout (a streaming
 * speed, say) settles on steady values instead of flickering with every chunk.
 */
/**
 * A huge text that keeps changing, sampled no faster than `intervalMs` while `active`, so a
 * stream that would cost a full re-parse per flush renders a few stills a second instead. When
 * the stream ends the live text shows at once; identical snapshots render nothing twice.
 */
export function useSampledText(text: string, active: boolean, intervalMs: number): string {
  const [snapshot, setSnapshot] = useState(text);
  const latest = useRef(text);
  latest.current = text;
  useEffect(() => {
    if (!active) {
      setSnapshot(latest.current);
      return;
    }
    setSnapshot(latest.current);
    const timer = setInterval(() => setSnapshot(latest.current), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return active ? snapshot : text;
}

export function useSampled(read: () => number | null, enabled: boolean): number | null {
  const readRef = useRef(read);
  readRef.current = read;
  const [value, setValue] = useState<number | null>(() => (enabled ? read() : null));
  useEffect(() => {
    if (!enabled) {
      setValue(null);
      return;
    }
    setValue(readRef.current());
    const timer = setInterval(() => setValue(readRef.current()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return value;
}
