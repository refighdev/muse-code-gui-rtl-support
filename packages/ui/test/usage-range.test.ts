import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calendarDaysUtc, fillUsageDays, rangeLabel } from "../src/model/usage-range.js";

describe("usage range", () => {
  it("names a one-day window as 24 hours", () => {
    assert.equal(rangeLabel(1), "24 hours");
    assert.equal(rangeLabel(7), "7 days");
  });

  it("lists every UTC day in the window, so 7d and 90d are different lengths", () => {
    const until = new Date("2026-09-15T18:00:00.000Z");
    const week = calendarDaysUtc("2026-09-09T18:00:00.000Z", until);
    const quarter = calendarDaysUtc("2026-06-18T18:00:00.000Z", until);
    assert.equal(week[0], "2026-09-09");
    assert.equal(week.at(-1), "2026-09-15");
    assert.equal(week.length, 7);
    assert.ok(quarter.length >= 89 && quarter.length <= 91);
  });

  it("keeps days with no calls so the chart still spans the selected range", () => {
    const until = new Date("2026-09-15T12:00:00.000Z");
    const filled = fillUsageDays(
      [{ day: "2026-09-14", cost: 3.68 }],
      { since: "2026-09-09T12:00:00.000Z", days: 7 },
      (day) => ({ day, cost: 0 }),
      until,
    );
    assert.equal(filled.length, 7);
    assert.equal(filled.find((row) => row.day === "2026-09-14")?.cost, 3.68);
    assert.equal(filled.filter((row) => row.cost === 0).length, 6);
  });
});
