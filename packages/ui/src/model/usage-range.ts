import type { UsageReport } from "../types.js";

export const USAGE_RANGES = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
] as const;

export function rangeLabel(days: number): string {
  return days === 1 ? "24 hours" : `${days} days`;
}

/** UTC calendar days from `since` through today (inclusive), matching the server's rolling window. */
export function calendarDaysUtc(sinceIso: string, until = new Date()): string[] {
  const start = sinceIso.slice(0, 10);
  const end = until.toISOString().slice(0, 10);
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = new Date(Date.parse(`${cursor}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
    if (days.length > 400) {
      break;
    }
  }
  return days;
}

export function fillUsageDays<T extends { day: string }>(
  rows: T[],
  report: Pick<UsageReport, "since" | "days">,
  blank: (day: string) => T,
  until = new Date(),
): T[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return calendarDaysUtc(report.since, until).map((day) => byDay.get(day) ?? blank(day));
}
