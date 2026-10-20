import { CHANGELOG, type ChangelogEntry } from "./changelog.generated.js";

export { CHANGELOG, type ChangelogEntry };

/** A semantic version as three numbers, or null when it is not one. */
function parts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when `a` is older than `b`, zero when they match, positive when it is newer. */
export function compareVersions(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  if (!left || !right) {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) {
      return left[i] - right[i];
    }
  }
  return 0;
}

/**
 * The entries to show after an update: everything newer than the version last seen, up to and
 * including the one now running. Someone who skipped two releases reads both, in one place.
 *
 * Nothing is returned when the version last seen is unknown, which is a first run rather than an
 * update, or when it is not older than the running version, which covers a downgrade and the
 * ordinary case of nothing having changed.
 */
export function newEntries(
  seen: string | null,
  current: string | null,
  entries: readonly ChangelogEntry[] = CHANGELOG,
): ChangelogEntry[] {
  if (!seen || !current || compareVersions(seen, current) >= 0) {
    return [];
  }
  return entries.filter(
    (entry) => compareVersions(entry.version, seen) > 0 && compareVersions(entry.version, current) <= 0,
  );
}

/** Where the full notes live; the in-app card only carries a few lines of them. */
export const CHANGELOG_URL = "https://github.com/refighdev/muse-code-gui-rtl-support/releases";

/**
 * The version running now. A desktop shell that can update itself reports its own, and until it
 * has, there is nothing to compare. Every other host (the browser, the editor extension) runs the
 * interface it was built with, and the newest built-in entry is that version: the changelog test
 * keeps the two in step.
 */
export function runningVersion(
  updates: { currentVersion: string | null } | null | undefined,
  entries: readonly ChangelogEntry[] = CHANGELOG,
): string | null {
  if (updates) {
    return updates.currentVersion;
  }
  return entries[0]?.version ?? null;
}

/** Sections in the order their items are worth reading; anything unlisted comes last. */
const SECTION_ORDER = ["new", "added", "changed", "fixed"];

const MAX_HIGHLIGHT = 96;

/** Markdown down to the words a reader sees: link text kept, emphasis and code marks dropped. */
function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The headline of one changelog item: its bold lead when it has one, else its first sentence. */
function headline(item: string): string {
  const bold = /^\*\*(.+?)\*\*/.exec(item);
  const lead = bold ? bold[1] : (plainText(item).split(/(?<=[.!?])\s/)[0] ?? "");
  let text = plainText(lead).replace(/[\s.,:;]+$/, "");
  if (text.length > MAX_HIGHLIGHT) {
    const cut = text.slice(0, MAX_HIGHLIGHT);
    text = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1))}…`;
  }
  return text;
}

/**
 * A few lines worth reading from the given entries, for a card too small for the whole notes.
 *
 * New things come before changes and changes before fixes, newest release first within each, so
 * someone who skipped three releases sees the biggest news rather than the latest fix. An entry
 * written as a paragraph instead of a list gives its first sentence.
 */
export function highlights(entries: readonly ChangelogEntry[], max = 4): string[] {
  const found: { rank: number; order: number; text: string }[] = [];
  entries.forEach((entry, index) => {
    let section = "";
    let listed = false;
    for (const line of entry.body.split("\n")) {
      const heading = /^#{2,4}\s+(.+)$/.exec(line);
      if (heading) {
        section = heading[1].trim().toLowerCase();
        continue;
      }
      if (line.startsWith("- ")) {
        listed = true;
        const rank = SECTION_ORDER.indexOf(section);
        found.push({ rank: rank === -1 ? SECTION_ORDER.length : rank, order: index, text: headline(line.slice(2)) });
      }
    }
    if (!listed) {
      const paragraph = entry.body.split("\n").find((line) => line.trim() && !line.startsWith("#"));
      if (paragraph) {
        found.push({ rank: SECTION_ORDER.length, order: index, text: headline(paragraph) });
      }
    }
  });
  const seen = new Set<string>();
  return found
    .filter((item) => item.text.length > 0)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((item) => item.text)
    .filter((text) => (seen.has(text) ? false : (seen.add(text), true)))
    .slice(0, max);
}
