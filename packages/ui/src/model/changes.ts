/**
 * Which of a thread's file changes the user has settled. A kept or undone file stays out of the "files changed" card
 * until the thread edits it again: each entry is `<sessionId>|<changes seen>|<path>`, and later changes show it again, and only those are listed, so the card never replays what was settled.
 */
const SEP = "|";
const KEEP_LIMIT = 500;

export function settledEntry(sessionId: string, count: number, path: string): string {
  return [sessionId, String(count), path].join(SEP);
}

/** How many of a file's changes in this thread are settled; 0 when none. */
export function settledCount(entries: readonly string[], sessionId: string, path: string): number {
  let count = 0;
  for (const entry of entries) {
    const first = entry.indexOf(SEP);
    const second = entry.indexOf(SEP, first + 1);
    if (first < 0 || second < 0 || entry.slice(0, first) !== sessionId || entry.slice(second + 1) !== path) {
      continue;
    }
    count = Math.max(count, Number(entry.slice(first + 1, second)) || 0);
  }
  return count;
}

/** `entries` plus these settled files, replacing older entries for the same file; the oldest go past a few hundred. */
export function withSettled(
  entries: readonly string[],
  sessionId: string,
  files: readonly { path: string; count: number }[],
): string[] {
  const paths = new Set(files.map((file) => file.path));
  const kept = entries.filter((entry) => {
    const first = entry.indexOf(SEP);
    const second = entry.indexOf(SEP, first + 1);
    return !(first >= 0 && second >= 0 && entry.slice(0, first) === sessionId && paths.has(entry.slice(second + 1)));
  });
  return [...kept, ...files.map((file) => settledEntry(sessionId, file.count, file.path))].slice(-KEEP_LIMIT);
}
